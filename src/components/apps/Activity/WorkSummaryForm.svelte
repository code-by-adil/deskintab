<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import WindowSheet from '🍎/components/SystemUI/WindowSheet.svelte';
	import { reviewService } from '🍎/lib/activity/review';
	import type { FileVersion, WorkSession } from '🍎/lib/activity/history';
	import { activityService, type ActivityActor } from '🍎/lib/activity/activity';
	import { workspaceBasename } from '🍎/lib/workspace/path';

	let {
		session,
		initialVersionId,
		versions,
		returnFocus,
		saving = $bindable(false),
		onclose,
		onsaved,
	}: {
		session: WorkSession | null;
		initialVersionId: string | null;
		versions: FileVersion[];
		returnFocus: Element | null;
		saving?: boolean;
		onclose: () => void;
		onsaved: (session: WorkSession) => Promise<void>;
	} = $props();

	// Keep the draft and revision tied to the summary that opened this form.
	const initial = untrack(() => ({ session, initialVersionId }));
	let title = $state(initial.session?.title ?? '');
	let summary = $state(initial.session?.summary ?? '');
	let questionsText = $state(initial.session?.questions.join('\n') ?? '');
	let resultPathsText = $state(initial.session?.results.join('\n') ?? '');
	let versionIds = $state<string[]>(
		initial.session?.versionIds.slice() ??
			(initial.initialVersionId ? [initial.initialVersionId] : []),
	);
	let activityIds = $state(initial.session?.activities.map((item) => item.id) ?? []);
	let includeVersionResults = $state(!initial.session);
	let error = $state('');
	let active = true;
	const activities = [
		...new Map(
			[...(initial.session?.activities ?? []), ...activityService.list(100)].map((item) => [
				item.id,
				item,
			]),
		).values(),
	];
	const inferredPaths = $derived(
		includeVersionResults
			? [
					...new Set(
						versions
							.filter((version) => versionIds.includes(version.id))
							.map((version) => version.path),
					),
				]
			: [],
	);
	const actorLabel = (actor: ActivityActor) =>
		({ human: 'You', agent: 'Agent', terminal: 'Terminal', system: 'Desktop' })[actor];
	const dateLabel = (value: string) =>
		new Date(value).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		});
	const lines = (text: string) => [
		...new Set(
			text
				.split('\n')
				.map((value) => value.trim())
				.filter(Boolean),
		),
	];

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		saving = true;
		error = '';
		try {
			const saved = await reviewService.session(
				{
					id: initial.session?.id,
					expectedRevision: initial.session?.revision,
					title: title.trim(),
					summary,
					status: 'completed',
					questions: lines(questionsText),
					results: [...new Set([...inferredPaths, ...lines(resultPathsText)])],
					versionIds,
					activityIds,
				},
				'human',
			);
			if (active) await onsaved(saved);
		} catch (cause) {
			if (active)
				error = cause instanceof Error ? cause.message : 'Could not save this work summary.';
		} finally {
			if (active) saving = false;
		}
	}

	onDestroy(() => {
		active = false;
	});
</script>

<WindowSheet
	{returnFocus}
	labelledby="summary-form-title"
	busy={saving}
	{onclose}
	--sheet-top="0px"
	--sheet-width="500px"
	--sheet-padding="17px"
	--sheet-backdrop-padding="12px"
>
	<form onsubmit={save}>
		<h2 id="summary-form-title">{initial.session ? 'Edit work summary' : 'New work summary'}</h2>
		<div class="sheet-body">
			<label
				>Title<input
					bind:value={title}
					required
					maxlength="120"
					disabled={saving}
					placeholder="For example, Event budget ready for review"
				/></label
			><label
				>What changed<textarea
					bind:value={summary}
					maxlength="4000"
					rows="3"
					disabled={saving}
					placeholder="Explain the outcome and what deserves a closer look."></textarea></label
			><label
				>Open questions <small>One per line</small><textarea
					bind:value={questionsText}
					rows="2"
					disabled={saving}></textarea></label
			>
			<fieldset>
				<legend>Choose saved changes</legend>
				<div class="checkbox-list">
					{#each versions as version (version.id)}<label
							><input
								type="checkbox"
								value={version.id}
								bind:group={versionIds}
								disabled={saving || (versionIds.length >= 50 && !versionIds.includes(version.id))}
							/><span
								><strong>{workspaceBasename(version.path)}</strong><small
									>{dateLabel(version.createdAt)} · {actorLabel(version.actor)}</small
								></span
							></label
						>{:else}<p class="hint">
							No saved changes yet. You can still link results and activity.
						</p>{/each}
				</div>
			</fieldset>
			<label class="inline-check"
				><input type="checkbox" bind:checked={includeVersionResults} disabled={saving} />Include the
				file paths of selected changes as results</label
			>{#if inferredPaths.length}<div class="inferred-results">
					{#each inferredPaths as path (path)}<code>{path}</code>{/each}
				</div>{/if}<label
				>Other result paths <small>One workspace path per line</small><textarea
					bind:value={resultPathsText}
					rows="2"
					disabled={saving}
					spellcheck="false"
					placeholder="/Documents/Report.odt"></textarea></label
			>
			<details class="activity-picker">
				<summary>Include activity records ({activityIds.length})</summary>
				<div class="checkbox-list">
					{#each activities as entry (entry.id)}<label
							><input
								type="checkbox"
								value={entry.id}
								bind:group={activityIds}
								disabled={saving || (activityIds.length >= 50 && !activityIds.includes(entry.id))}
							/><span><strong>{entry.action}</strong><small>{entry.detail}</small></span></label
						>{/each}
				</div>
			</details>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
		</div>
		<footer>
			<button type="button" disabled={saving} onclick={onclose}>Cancel</button><button
				class="primary"
				type="submit"
				disabled={saving}>{saving ? 'Saving…' : 'Save Summary'}</button
			>
		</footer>
	</form>
</WindowSheet>

<style>
	button {
		min-height: var(--app-control-height);
		color: inherit;
		font: inherit;
		font-size: 12px;
		border-radius: var(--app-control-radius);
		padding: 5px 8px;
		cursor: default;
	}
	button:hover:not(:disabled) {
		background: var(--app-hover);
	}
	button.primary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--app-accent) 85%, var(--app-text));
	}
	button:disabled {
		opacity: 0.45;
	}
	button:focus-visible,
	input:focus-visible,
	textarea:focus-visible,
	summary:focus-visible {
		outline: 2px solid var(--app-focus);
		outline-offset: 2px;
	}
	textarea {
		resize: vertical;
		min-height: 46px;
	}
	.sheet-body > label:not(.inline-check) {
		display: block;
		font-size: 12px;
		margin-bottom: 13px;
	}
	label > small {
		color: var(--app-text-secondary);
		font-size: 10px;
		margin-left: 4px;
	}
	fieldset {
		border: 0;
		margin: 12px 0;
		padding: 0;
	}
	legend {
		font-size: 12px;
		padding: 0;
		margin-bottom: 7px;
	}
	.checkbox-list {
		border: 1px solid var(--app-border);
		background: var(--app-field);
		border-radius: var(--app-control-radius);
		max-height: 160px;
		overflow: auto;
	}
	.sheet-body .checkbox-list label {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin: 0;
		padding: 8px;
		border-bottom: 1px solid var(--app-border);
	}
	.checkbox-list input {
		flex: none;
		margin: 2px 0 0;
		accent-color: var(--app-accent);
	}
	.checkbox-list label > span {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.checkbox-list strong {
		font-size: 11px;
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	.checkbox-list small {
		font-size: 10px;
		color: var(--app-text-secondary);
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.sheet-body .inline-check {
		display: flex;
		gap: 7px;
		align-items: flex-start;
		font-size: 11px;
		line-height: 1.5;
		margin-bottom: 12px;
	}
	.inline-check input {
		margin: 2px 0 0;
		flex: none;
		accent-color: var(--app-accent);
	}
	.inferred-results {
		margin: -4px 0 13px;
	}
	.inferred-results code {
		display: block;
		font-size: 10px;
		color: var(--app-text-secondary);
		line-height: 1.7;
		overflow-wrap: anywhere;
	}
	.activity-picker {
		font-size: 12px;
	}
	.activity-picker summary {
		padding: 6px 0;
	}
	.hint {
		font-size: 11px;
		line-height: 1.5;
		color: var(--app-text-secondary);
	}
	.error {
		font-size: 12px;
		padding: 10px 12px;
		border-radius: var(--app-control-radius);
		line-height: 1.55;
		overflow-wrap: anywhere;
		background: var(--app-danger-bg);
		color: var(--app-danger);
	}
</style>
