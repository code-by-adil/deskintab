<script lang="ts">
	import { onMount } from 'svelte';
	import { reviewService, type VersionReview } from '🍎/lib/activity/review';
	import type { FileVersion, WorkSession } from '🍎/lib/activity/history';
	import type { ActivityActor } from '🍎/lib/activity/activity';
	import WorkSummaryForm from './WorkSummaryForm.svelte';
	import { revealDesktop } from '🍎/lib/desktop/files';
	import { workspaceService } from '🍎/lib/workspace/workspace';
	import { workspaceBasename } from '🍎/lib/workspace/path';
	import { connectReviewContext } from '🍎/lib/workspace/interaction-context';

	type Selection = { kind: 'version' | 'session'; id: string };
	let { initialSelection = null }: { initialSelection?: Selection | null } = $props();
	let versions = $state.raw<FileVersion[]>([]);
	let sessions = $state.raw<WorkSession[]>([]);
	let warnings = $state.raw<string[]>([]);
	let selected = $state<Selection | null>(null);
	let review = $state.raw<VersionReview | null>(null);
	let loading = $state(true);
	let reading = $state(false);
	let busy = $state(false);
	let error = $state('');
	let listError = $state('');
	let restoredPath = $state('');
	let copyDestination = $state('');
	let copySide = $state<'before' | 'after'>('before');
	let confirmReplace = $state(false);
	let summaryTarget = $state.raw<{ session: WorkSession | null } | null>(null);
	let summaryOpener = $state.raw<Element | null>(null);
	let readGeneration = 0;
	let listGeneration = 0;
	let active = true;
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;
	const selectedSession = $derived.by(() => {
		const selection = selected;
		return selection?.kind === 'session'
			? sessions.find((item) => item.id === selection.id)
			: undefined;
	});
	const diffLines = $derived(review?.diff?.lines.slice(0, 500) || []);
	const actorLabel = (actor: ActivityActor) =>
		({ human: 'You', agent: 'Agent', terminal: 'Terminal', system: 'Desktop' })[actor];
	const dateLabel = (value: string) =>
		new Date(value).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		});
	const sizeLabel = (size: number) =>
		size < 1024
			? `${size} B`
			: size < 1024 * 1024
				? `${(size / 1024).toFixed(1)} KB`
				: `${(size / 1024 / 1024).toFixed(1)} MB`;

	async function loadList() {
		const generation = ++listGeneration;
		try {
			const result = await reviewService.list();
			if (!active || generation !== listGeneration) return;
			versions = result.versions;
			sessions = result.sessions;
			warnings = result.warnings;
			listError = '';
		} catch (cause) {
			if (active && generation === listGeneration)
				listError = cause instanceof Error ? cause.message : 'Review history could not be loaded.';
		} finally {
			if (active && generation === listGeneration) loading = false;
		}
	}
	async function loadVersion(id: string, preserveInput = false) {
		const generation = ++readGeneration;
		const keepInputs = preserveInput && review?.version.id === id;
		reading = true;
		if (!preserveInput) {
			review = null;
			confirmReplace = false;
			error = '';
			restoredPath = '';
		}
		try {
			const result = await reviewService.read(id);
			if (
				!active ||
				generation !== readGeneration ||
				selected?.kind !== 'version' ||
				selected.id !== id
			)
				return;
			if (review?.current?.token !== result.current?.token || !result.canRestore)
				confirmReplace = false;
			review = result;
			if (!keepInputs) {
				copyDestination = result.suggestedCopy;
				copySide = result.version.before ? 'before' : 'after';
			}
		} catch (cause) {
			if (active && generation === readGeneration) {
				review = null;
				error = cause instanceof Error ? cause.message : 'This saved version could not be read.';
			}
		} finally {
			if (active && generation === readGeneration) reading = false;
		}
	}
	function scheduleRefresh() {
		clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => {
			void loadList();
			if (selected?.kind === 'version' && !busy) void loadVersion(selected.id, true);
		}, 80);
	}
	function choose(selection: Selection | null) {
		if (busy) return;
		readGeneration++;
		reading = false;
		selected = selection;
		review = null;
		error = '';
		restoredPath = '';
		confirmReplace = false;
		if (selection?.kind === 'version') void loadVersion(selection.id);
	}
	async function reveal(path: string) {
		if (busy) return;
		busy = true;
		error = '';
		try {
			await revealDesktop({ path });
		} catch (cause) {
			if (active)
				error = cause instanceof Error ? cause.message : 'This result could not be opened.';
		} finally {
			if (active) busy = false;
		}
	}
	async function restore(mode: 'replace' | 'copy') {
		const source = review;
		if (
			!source ||
			busy ||
			(mode === 'replace' && (reading || !source.canRestore || !confirmReplace))
		)
			return;
		if (mode === 'copy' && !copyDestination.trim().startsWith('/')) {
			error = 'Enter an absolute workspace path for the copy.';
			return;
		}
		busy = true;
		error = '';
		restoredPath = '';
		try {
			const result = await reviewService.restore(
				{
					versionId: source.version.id,
					mode,
					side: mode === 'replace' ? 'before' : copySide,
					destination: mode === 'copy' ? copyDestination.trim() : undefined,
					expectedCurrentToken: source.current?.token ?? undefined,
				},
				'human',
			);
			if (!active) return;
			restoredPath = result.entry.path;
			confirmReplace = false;
			await loadList();
			if (selected?.kind === 'version' && selected.id === source.version.id)
				await loadVersion(source.version.id, true);
		} catch (cause) {
			if (active)
				error = cause instanceof Error ? cause.message : 'Could not restore this saved version.';
		} finally {
			if (active) busy = false;
		}
	}
	function newSummary(session?: WorkSession) {
		if (busy) return;
		summaryOpener = document.activeElement;
		summaryTarget = { session: session ?? null };
	}
	async function summarySaved(session: WorkSession) {
		summaryTarget = null;
		await loadList();
		if (!active) return;
		busy = false;
		choose({ kind: 'session', id: session.id });
	}
	onMount(() => {
		const disconnectContext = connectReviewContext(() => ({
			selectedVersionId:
				selected?.kind === 'version' && review?.version.id === selected.id ? selected.id : null,
			selectedSessionId: selectedSession?.id ?? null,
			path:
				selected?.kind === 'version' && review?.version.id === selected.id
					? review.version.path
					: null,
			reading: loading || reading,
			busy,
			summaryDraft: summaryTarget
				? { sessionId: summaryTarget.session?.id ?? null, isNew: !summaryTarget.session }
				: null,
		}));
		void loadList();
		if (initialSelection) choose(initialSelection);
		const unsubscribeHistory = reviewService.subscribe(scheduleRefresh);
		const unsubscribeFiles = workspaceService.subscribe(scheduleRefresh);
		return () => {
			active = false;
			disconnectContext();
			readGeneration++;
			listGeneration++;
			clearTimeout(refreshTimer);
			unsubscribeHistory();
			unsubscribeFiles();
		};
	});
</script>

<section class="review-panel" aria-label="Review work">
	<div class="review-content" inert={summaryTarget !== null}>
		<div class="toolbar">
			{#if selected}<button disabled={busy} onclick={() => choose(null)}>‹ All reviews</button
				>{:else}<span>Work summaries &amp; saved changes</span>{/if}
			<div>
				<button
					disabled={busy}
					onclick={() => {
						void loadList();
						if (selected?.kind === 'version') void loadVersion(selected.id, true);
					}}>Refresh</button
				><button disabled={busy} onclick={() => newSummary()}>New Summary…</button>
			</div>
		</div>
		<div class="scroll" aria-busy={loading || reading || busy}>
			{#if listError}<p class="error" role="alert">{listError}</p>{/if}
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			{#if restoredPath}<p class="success" role="status">
					Restored successfully. <button
						class="link"
						disabled={busy}
						onclick={() => reveal(restoredPath)}>Open {workspaceBasename(restoredPath)}</button
					>
				</p>{/if}
			{#if !selected}
				{#if loading}<p class="empty" role="status">Loading saved work…</p>{:else}
					<h2>Work summaries <span>{sessions.length}</span></h2>
					{#each sessions as session (session.id)}<button
							class="record"
							disabled={busy}
							onclick={() => choose({ kind: 'session', id: session.id })}
							><span class="record-main"
								><strong>{session.title}</strong><span class="record-excerpt"
									>{session.summary || 'No summary yet.'}</span
								></span
							><span class="record-meta"
								><time datetime={session.updatedAt}>{dateLabel(session.updatedAt)}</time><span
									>{session.status === 'completed' ? 'Ready for review' : 'In progress'}</span
								></span
							></button
						>{:else}<p class="empty compact">
							Save a summary, link result files, and note any open questions.
						</p>{/each}
					<h2 class="versions-title">Recent file changes <span>{versions.length}</span></h2>
					{#each versions as version (version.id)}<button
							class="record"
							disabled={busy}
							onclick={() => choose({ kind: 'version', id: version.id })}
							><span class="record-main"
								><strong>{workspaceBasename(version.path)}</strong><code>{version.path}</code><span
									class="record-excerpt"
									>{version.status !== 'saved'
										? 'Unconfirmed save'
										: version.before
											? 'Updated file'
											: 'Created file'} · {actorLabel(version.actor)}{!version.recovery
										? ' · No recovery contents'
										: ''}</span
								></span
							><time class="record-meta" datetime={version.createdAt}
								>{dateLabel(version.createdAt)}</time
							></button
						>{:else}<p class="empty compact">
							Future file saves appear here. Older activity entries do not contain recoverable
							versions.
						</p>{/each}
				{/if}
			{:else if selected.kind === 'session'}
				{#if selectedSession}
					<header class="detail-heading">
						<div>
							<h2>{selectedSession.title}</h2>
							<p>
								{selectedSession.status === 'completed' ? 'Ready for review' : 'In progress'} · {actorLabel(
									selectedSession.actor,
								)} · {dateLabel(selectedSession.updatedAt)}
							</p>
						</div>
						<button disabled={busy} onclick={() => newSummary(selectedSession)}
							>Edit Summary…</button
						>
					</header>
					<p class="summary-text">{selectedSession.summary || 'No summary was provided.'}</p>
					<h3>Results</h3>
					{#each selectedSession.results as path (path)}<button
							class="result-path"
							disabled={busy}
							onclick={() => reveal(path)}>{path}</button
						>{:else}<p class="muted">No result files linked.</p>{/each}
					<h3>Changes to review</h3>
					{#each selectedSession.versionIds as id (id)}{@const version = versions.find(
							(item) => item.id === id,
						)}<button
							class="result-path"
							disabled={busy}
							onclick={() => choose({ kind: 'version', id })}
							>{version
								? `${workspaceBasename(version.path)} · ${dateLabel(version.createdAt)}`
								: `Saved change ${id.slice(0, 8)} (may have expired)`}</button
						>{:else}<p class="muted">No saved changes linked.</p>{/each}
					<h3>Open questions</h3>
					{#if selectedSession.questions.length}<ul class="questions">
							{#each [...new Set(selectedSession.questions)] as question (question)}<li>
									{question}
								</li>{/each}
						</ul>{:else}<p class="muted">No open questions recorded.</p>{/if}
					{#if selectedSession.activities.length}<h3>Activity included in this summary</h3>
						<div class="included-activity">
							{#each selectedSession.activities as entry (entry.id)}<article>
									<div>
										<strong>{entry.action}</strong><span
											>{actorLabel(entry.actor)} · {dateLabel(entry.createdAt)}</span
										>
									</div>
									<p>{entry.detail}</p>
									{#if entry.path}<button
											class="link"
											disabled={busy}
											onclick={() => reveal(entry.path!)}>{entry.path}</button
										>{/if}
								</article>{/each}
						</div>{/if}
				{:else if loading}<p class="empty" role="status">Loading work summary…</p>{:else}<p
						class="empty"
					>
						This work summary is no longer available. Return to All reviews or refresh.
					</p>{/if}
			{:else if reading && !review}<p class="empty" role="status">Reading the saved change…</p>
			{:else if review}
				<header class="detail-heading">
					<div>
						<h2>{workspaceBasename(review.version.path)}</h2>
						<button
							class="link file-path"
							disabled={busy}
							onclick={() => reveal(review!.version.path)}>{review.version.path}</button
						>
						<p>{actorLabel(review.version.actor)} · {dateLabel(review.version.createdAt)}</p>
					</div>
				</header>
				<div class="version-meta">
					<span
						>Before: {review.version.before
							? sizeLabel(review.version.before.size)
							: 'No file'}</span
					><span>After: {sizeLabel(review.version.after.size)}</span><span
						>{review.version.status === 'saved' ? 'Save confirmed' : 'Save unconfirmed'}</span
					>
				</div>
				{#if review.semantic}
					<section class="semantic-summary" aria-label="Changes in this save">
						<h3>What changed</h3>
						<ul>
							{#each review.semantic.changes as change (change.id)}
								<li>{change.summary}</li>
							{:else}
								<li>No content changes were summarized. Check the raw file changes below.</li>
							{/each}
						</ul>
						{#if review.semantic.truncated}<p class="hint">
								Showing {review.semantic.changes.length} of {review.semantic.total} changes.
							</p>{/if}
					</section>
				{/if}
				<details class="raw-change" open={!review.semantic}>
					<summary>{review.semantic ? 'Raw file changes' : 'Saved file changes'}</summary>
					{#if review.diff}
						<div class="diff-heading">
							<h3>Saved change</h3>
							<span><i class="removed-mark">− Removed</i><i class="added-mark">+ Added</i></span>
						</div>
						{#if review.diff.mode === 'lines'}<div class="diff-scroll">
								<table class="diff">
									<thead
										><tr
											><th scope="col">Before</th><th scope="col">After</th><th scope="col">Text</th
											></tr
										></thead
									><tbody
										>{#each diffLines as line (`${line.kind}:${line.before}:${line.after}`)}<tr
												class={line.kind}
												><td>{line.before ?? ''}</td><td>{line.after ?? ''}</td><td
													><span
														aria-label={line.kind === 'same'
															? 'Unchanged'
															: line.kind === 'added'
																? 'Added'
																: 'Removed'}
														>{line.kind === 'added'
															? '+'
															: line.kind === 'removed'
																? '−'
																: ' '}</span
													><code>{line.text || ' '}</code></td
												></tr
											>{/each}</tbody
									>
								</table>
							</div>{:else}<div class="excerpts">
								<h4>Before excerpt</h4>
								<pre>{review.diff.before || '(Empty)'}</pre>
								<h4>After excerpt</h4>
								<pre>{review.diff.after || '(Empty)'}</pre>
							</div>{/if}
						{#if review.diff.truncated || review.diff.lines.length > diffLines.length}<p
								class="hint"
							>
								{review.diff.lines.length > diffLines.length
									? 'Showing the first 500 lines.'
									: 'Showing excerpts from the saved file.'} Restoring uses the full saved file.
							</p>{/if}
					{:else}<p class="binary-note">
							{review.version.recovery
								? 'This is a binary or rich document. A line-by-line preview is not available; restore a copy to inspect the saved contents.'
								: review.version.reason || 'No recoverable contents were stored for this change.'}
						</p>{/if}
				</details>
				<section class="restore-section" aria-label="Restore saved contents">
					<h3>Restore</h3>
					<p class="hint">This preview compares the file before and after the selected save.</p>
					{#if review.blocked}<p class="blocked">{review.blocked}</p>{/if}
					<button
						class="standard"
						disabled={busy || reading || !review.canRestore}
						onclick={() => (confirmReplace = !confirmReplace)}>Restore Previous Version…</button
					>
					{#if confirmReplace}<div class="confirmation">
							<p>
								Replace <strong>{workspaceBasename(review.version.path)}</strong> with its previous saved
								contents? The current file is checked again before replacement.
							</p>
							<div>
								<button disabled={busy} onclick={() => (confirmReplace = false)}>Cancel</button
								><button
									class="primary"
									disabled={busy || reading || !review.canRestore}
									onclick={() => restore('replace')}
									>{busy ? 'Restoring…' : 'Restore in Place'}</button
								>
							</div>
						</div>{/if}
					{#if review.version.recovery}<form
							class="copy-form"
							onsubmit={(event) => {
								event.preventDefault();
								void restore('copy');
							}}
						>
							<h4>Restore as a copy</h4>
							<p class="hint">
								Keep the current file untouched and save the chosen snapshot under a new name.
							</p>
							<label
								>Snapshot<select bind:value={copySide} disabled={busy}
									>{#if review.version.before}<option value="before">Before this change</option
										>{/if}<option value="after">After this change</option></select
								></label
							><label
								>New workspace path<input
									bind:value={copyDestination}
									disabled={busy}
									required
									spellcheck="false"
								/></label
							><button class="standard" type="submit" disabled={busy}
								>{busy ? 'Restoring…' : 'Restore as Copy'}</button
							>
						</form>{/if}
				</section>
			{/if}
			<details class="retention">
				<summary
					>About review history{warnings.length
						? ` · ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`
						: ''}</summary
				>
				<p>
					Older versions expire. Some terminal changes and large files have an activity record
					without a recoverable copy.
				</p>
				{#each [...new Set(warnings)] as warning (warning)}<p class="warning">{warning}</p>{/each}
			</details>
		</div>
	</div>
	{#if summaryTarget}
		<WorkSummaryForm
			returnFocus={summaryOpener}
			session={summaryTarget.session}
			initialVersionId={selected?.kind === 'version' ? selected.id : null}
			{versions}
			bind:saving={busy}
			onclose={() => (summaryTarget = null)}
			onsaved={summarySaved}
		/>
	{/if}
</section>

<style>
	.review-panel {
		position: relative;
		min-height: 0;
		flex: 1;
		color: var(--app-text);
		font-family: var(--system-font-family);
	}
	.review-content {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.toolbar {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		padding: 4px 10px;
		min-height: 37px;
		border-bottom: 1px solid var(--app-border);
		background: var(--app-toolbar);
	}
	.toolbar > span {
		font-size: 11px;
		color: var(--app-text-secondary);
	}
	.toolbar > div {
		display: flex;
		gap: 3px;
		margin-left: auto;
	}
	.toolbar button {
		min-height: var(--app-control-height);
	}
	button {
		color: inherit;
		font: inherit;
		font-size: 12px;
		border: 0;
		border-radius: var(--app-control-radius);
		padding: 5px 8px;
		background: transparent;
		cursor: default;
	}
	button:hover:not(:disabled) {
		background: var(--app-hover);
	}
	button:disabled {
		opacity: 0.45;
	}
	button:focus-visible,
	input:focus-visible,
	select:focus-visible,
	summary:focus-visible {
		outline: 2px solid var(--app-focus);
		outline-offset: 2px;
	}
	.scroll {
		min-height: 0;
		flex: 1;
		overflow: auto;
		padding: 15px;
	}
	h2 {
		font-size: 13px;
		font-weight: 600;
		margin: 0 0 10px;
	}
	h2 > span {
		color: var(--app-text-tertiary);
		margin-left: 4px;
		font-size: 11px;
		font-weight: 400;
	}
	h3 {
		font-size: 12px;
		margin: 20px 0 9px;
	}
	h4 {
		font-size: 12px;
		margin: 12px 0 7px;
	}
	.versions-title {
		margin-top: 24px;
	}
	.record {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		text-align: left;
		padding: 11px 7px;
		border-radius: 0;
		border-bottom: 1px solid var(--app-border);
	}
	.record-main {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 5px;
	}
	.record strong {
		font-size: 12px;
		font-weight: 600;
	}
	.record code {
		font-size: 10px;
		overflow-wrap: anywhere;
		color: var(--app-text-secondary);
	}
	.record-excerpt {
		color: var(--app-text-secondary);
		font-size: 11px;
		line-height: 1.45;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.record-meta {
		display: flex;
		flex-direction: column;
		gap: 7px;
		flex: none;
		max-width: 110px;
		font-size: 10px;
		color: var(--app-text-secondary);
		text-align: right;
	}
	.empty {
		color: var(--app-text-secondary);
		font-size: 12px;
		line-height: 1.6;
		margin: 24px 0;
		text-align: center;
	}
	.empty.compact {
		margin: 10px 0 18px;
		text-align: left;
	}
	.error,
	.success,
	.blocked,
	.binary-note {
		font-size: 12px;
		padding: 10px 12px;
		border-radius: var(--app-control-radius);
		line-height: 1.55;
		overflow-wrap: anywhere;
	}
	.error {
		background: var(--app-danger-bg);
		color: var(--app-danger);
	}
	.success {
		background: color-mix(in srgb, var(--app-success) 12%, var(--app-surface));
		color: var(--app-success);
	}
	.blocked,
	.binary-note {
		background: var(--app-surface-secondary);
		color: var(--app-text-secondary);
	}
	.link,
	.result-path {
		color: var(--app-accent);
		text-align: left;
		overflow-wrap: anywhere;
	}
	.link {
		padding: 0;
	}
	.link:hover:not(:disabled) {
		text-decoration: underline;
		background: transparent;
	}
	.result-path {
		display: block;
		max-width: 100%;
		padding: 6px 0;
		font-size: 12px;
	}
	.detail-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
	}
	.detail-heading > div {
		min-width: 0;
	}
	.detail-heading h2 {
		font-size: 15px;
		margin-bottom: 6px;
		overflow-wrap: anywhere;
	}
	.detail-heading p {
		font-size: 10px;
		color: var(--app-text-secondary);
		margin: 8px 0 12px;
	}
	.detail-heading > button {
		flex: none;
		font-size: 11px;
	}
	.file-path {
		font-size: 11px;
		max-width: 100%;
	}
	.summary-text {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 1.7;
		font-size: 13px;
		margin: 12px 0;
		user-select: text;
	}
	.semantic-summary {
		margin: 1rem 0;
		padding: 0.85rem 1rem;
		border: 1px solid var(--app-border);
		border-radius: 0.5rem;
		background: var(--app-info-bg);
	}
	.semantic-summary h3 {
		margin-top: 0;
	}
	.semantic-summary ul {
		margin: 0;
		padding-left: 1.15rem;
		font-size: 0.78rem;
		line-height: 1.6;
	}
	.raw-change > summary {
		padding: 0.65rem 0;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}
	.muted,
	.hint {
		font-size: 11px;
		line-height: 1.5;
		color: var(--app-text-secondary);
	}
	.questions {
		margin: 0;
		padding-left: 19px;
		font-size: 12px;
		line-height: 1.7;
		overflow-wrap: anywhere;
	}
	.included-activity article {
		border-bottom: 1px solid var(--app-border);
		padding: 10px 0;
	}
	.included-activity article > div {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}
	.included-activity strong {
		font-size: 11px;
	}
	.included-activity span {
		font-size: 10px;
		color: var(--app-text-secondary);
	}
	.included-activity p {
		font-size: 12px;
		line-height: 1.5;
		margin: 7px 0;
		color: var(--app-text-secondary);
	}
	.included-activity .link {
		font-size: 11px;
	}
	.version-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		padding: 9px 0;
		border-block: 1px solid var(--app-border);
		font-size: 10px;
		color: var(--app-text-secondary);
	}
	.diff-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-top: 18px;
	}
	.diff-heading h3 {
		margin: 0;
	}
	.diff-heading > span {
		display: flex;
		gap: 10px;
		font-size: 10px;
	}
	i {
		font-style: normal;
	}
	.removed-mark {
		color: var(--app-danger);
	}
	.added-mark {
		color: var(--app-success);
	}
	.diff-scroll {
		margin-top: 9px;
		overflow: auto;
		max-height: 320px;
		border: 1px solid var(--app-border);
		border-radius: var(--app-control-radius);
		background: var(--app-surface);
	}
	.diff {
		border-collapse: collapse;
		min-width: 100%;
		font:
			11px/1.7 ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
		user-select: text;
	}
	.diff th {
		position: sticky;
		top: 0;
		background: var(--app-toolbar);
		font:
			10px/1.5 -apple-system,
			sans-serif;
		text-align: left;
		padding: 4px 7px;
		border-bottom: 1px solid var(--app-border);
	}
	.diff td {
		vertical-align: top;
		padding: 1px 6px;
	}
	.diff td:nth-child(-n + 2) {
		color: var(--app-text-tertiary);
		text-align: right;
		user-select: none;
		width: 32px;
	}
	.diff td:last-child {
		display: flex;
		gap: 7px;
		white-space: pre;
	}
	.diff .added {
		background: color-mix(in srgb, var(--app-success) 12%, var(--app-surface));
		color: var(--app-success);
	}
	.diff .removed {
		background: var(--app-danger-bg);
		color: var(--app-danger);
	}
	.excerpts pre {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 180px;
		overflow: auto;
		border: 1px solid var(--app-border);
		padding: 9px;
		background: var(--app-surface);
		font:
			11px/1.6 ui-monospace,
			monospace;
		user-select: text;
	}
	.restore-section {
		margin-top: 18px;
		padding-top: 1px;
		border-top: 1px solid var(--app-border);
	}
	.standard {
		min-height: var(--app-control-height);
		border: 1px solid var(--app-control-border);
		background: var(--app-control);
		box-shadow: 0 1px 1px #0001;
	}
	.confirmation {
		margin: 10px 0;
		padding: 11px;
		background: var(--app-info-bg);
		border: 1px solid var(--app-border);
		border-radius: var(--app-control-radius);
	}
	.confirmation p {
		font-size: 12px;
		line-height: 1.6;
		margin: 0 0 10px;
	}
	.confirmation > div {
		display: flex;
		justify-content: flex-end;
		gap: 7px;
	}
	.copy-form {
		border-top: 1px solid var(--app-border);
		margin-top: 17px;
		padding-top: 1px;
	}
	.copy-form label {
		display: block;
		font-size: 11px;
		margin: 12px 0;
	}
	.copy-form input,
	.copy-form select {
		display: block;
		box-sizing: border-box;
		width: 100%;
		font: inherit;
		font-size: 12px;
		margin-top: 6px;
		border: 1px solid var(--app-control-border);
		border-radius: var(--app-control-radius);
		padding: 7px 8px;
		background: var(--app-field);
		color: var(--app-text);
	}
	.retention {
		margin-top: 25px;
		padding-top: 12px;
		border-top: 1px solid var(--app-border);
		font-size: 11px;
		color: var(--app-text-secondary);
		line-height: 1.6;
	}
	.retention summary {
		cursor: default;
	}
	.retention p {
		margin: 8px 0;
	}
	.warning {
		color: var(--app-warning);
	}
	button.primary {
		min-height: var(--app-control-height);
		background: var(--app-accent);
		border-color: var(--app-accent);
		color: var(--app-accent-text);
	}
	button.primary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--app-accent) 85%, var(--app-text));
	}
	@container (max-width: 450px) {
		.toolbar {
			flex-wrap: wrap;
			padding-inline: 7px;
		}
		.toolbar > span {
			display: none;
		}
		.scroll {
			padding: 12px;
		}
		.record {
			gap: 7px;
		}
		.record-meta {
			font-size: 9px;
			max-width: 80px;
		}
		.detail-heading {
			flex-wrap: wrap;
		}
		.included-activity article > div {
			flex-direction: column;
		}
	}
</style>
