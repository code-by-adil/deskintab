<script lang="ts">
	import EvidenceFields from './EvidenceFields.svelte';
	import type { ProjectDraft } from './form-types';

	let {
		draft = $bindable(),
		busy,
		stale,
		error,
		onSave,
		onCancel,
	}: {
		draft: ProjectDraft;
		busy: boolean;
		stale: boolean;
		error: string;
		onSave: () => void;
		onCancel: () => void;
	} = $props();

	const title = $derived(
		draft.kind === 'project'
			? draft.isNew
				? 'Create project'
				: 'Project details'
			: draft.kind === 'start'
				? 'Start work'
				: draft.kind === 'checkpoint'
					? 'Save a checkpoint'
					: 'Answer decision',
	);
	const saveLabel = $derived(
		draft.kind === 'project'
			? draft.isNew
				? 'Create project'
				: 'Save project'
			: draft.kind === 'start'
				? 'Start work'
				: draft.kind === 'checkpoint'
					? 'Save checkpoint'
					: 'Save answer',
	);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!busy && !stale) onSave();
	}
	function addStep() {
		if (busy || draft.kind !== 'checkpoint' || draft.steps.length >= 40) return;
		draft.steps.push({ id: crypto.randomUUID(), title: '', status: 'pending' });
	}
	function removeStep(id: string) {
		if (busy || draft.kind !== 'checkpoint' || draft.steps.length <= 1) return;
		draft.steps = draft.steps.filter((step) => step.id !== id);
	}
	function moveStep(id: string, direction: -1 | 1) {
		if (busy || draft.kind !== 'checkpoint') return;
		const index = draft.steps.findIndex((step) => step.id === id);
		const destination = index + direction;
		if (index < 0 || destination < 0 || destination >= draft.steps.length) return;
		const [step] = draft.steps.splice(index, 1);
		draft.steps.splice(destination, 0, step);
	}
</script>

<h2 id="project-form-title">{title}</h2>
<form onsubmit={submit} aria-busy={busy}>
	<div class="sheet-body">
		{#if stale}
			<p class="message stale" role="status">
				The project changed while you were editing. Copy anything you want to keep, then discard
				these changes and reopen the form.
			</p>
		{/if}
		{#if error}
			<p class="message error" role="alert">{error}</p>
		{/if}

		{#if draft.kind === 'project'}
			<label>
				Project title
				<input bind:value={draft.title} required disabled={busy} />
			</label>
			<label>
				Workspace path
				<input
					bind:value={draft.path}
					readonly={!draft.isNew}
					disabled={busy}
					spellcheck="false"
					placeholder="/Projects/<project title>/Project.project.json"
					aria-describedby={draft.isNew ? 'project-path-hint' : undefined}
				/>
			</label>
			{#if draft.isNew}
				<p id="project-path-hint" class="hint">
					Leave blank to choose a path from the project title.
				</p>
			{/if}
			<label>
				Objective
				<textarea bind:value={draft.objective} rows="2" required disabled={busy}></textarea>
			</label>
			<label>
				Project context
				<textarea
					bind:value={draft.context}
					rows="3"
					disabled={busy}
					aria-describedby="project-context-hint"></textarea>
			</label>
			<p id="project-context-hint" class="hint">
				Keep decisions and constraints the next agent needs to know.
			</p>
			<label>
				Task list
				<input
					bind:value={draft.taskListPath}
					disabled={busy}
					spellcheck="false"
					placeholder="/Projects/My project/Tasks.tasks.json"
				/>
			</label>
			<EvidenceFields bind:items={draft.references} kind="reference" {busy} />
		{:else if draft.kind === 'start'}
			<label>
				Agent name
				<input bind:value={draft.agent} required disabled={busy} placeholder="Your name or agent" />
			</label>
			<label>
				Work objective
				<textarea bind:value={draft.objective} rows="3" required disabled={busy}></textarea>
			</label>
			<label>
				Steps
				<textarea
					bind:value={draft.steps}
					rows="5"
					required
					disabled={busy}
					aria-describedby="project-steps-hint"></textarea>
			</label>
			<p id="project-steps-hint" class="hint">
				Write one step per line, in the order you plan to work.
			</p>
		{:else if draft.kind === 'checkpoint'}
			<label>
				Status
				<select bind:value={draft.status} disabled={busy}>
					<option value="working">Working</option>
					<option value="waiting">Waiting for an answer</option>
					<option value="paused">Paused</option>
					<option value="completed">Completed</option>
				</select>
			</label>
			<label>
				Summary
				<textarea bind:value={draft.summary} rows="3" required disabled={busy}></textarea>
			</label>
			<label>
				Next action
				<textarea
					bind:value={draft.nextAction}
					rows="2"
					disabled={busy}
					aria-describedby="project-next-action-hint"></textarea>
			</label>
			<p id="project-next-action-hint" class="hint">
				Leave a specific next action so a fresh agent can continue.
			</p>
			<fieldset disabled={busy} class="steps">
				<legend>Steps</legend>
				{#each draft.steps as step, index (step.id)}
					<div class="step-row">
						<input bind:value={step.title} required aria-label={`Step ${index + 1} title`} />
						<select
							bind:value={step.status}
							aria-label={`Status for ${step.title || `step ${index + 1}`}`}
						>
							<option value="pending">To do</option>
							<option value="in-progress">In progress</option>
							<option value="done">Done</option>
							<option value="skipped">Skipped</option>
						</select>
						<div class="step-actions">
							<button
								type="button"
								onclick={() => moveStep(step.id, -1)}
								disabled={index === 0}
								aria-label={`Move step ${index + 1} up`}
								title="Move up">↑</button
							>
							<button
								type="button"
								onclick={() => moveStep(step.id, 1)}
								disabled={index === draft.steps.length - 1}
								aria-label={`Move step ${index + 1} down`}
								title="Move down">↓</button
							>
							<button
								type="button"
								onclick={() => removeStep(step.id)}
								disabled={draft.steps.length <= 1}
								aria-label={`Remove step ${index + 1}`}
								title="Remove step">×</button
							>
						</div>
					</div>
				{/each}
				<button class="add-step" type="button" onclick={addStep} disabled={draft.steps.length >= 40}
					>Add step</button
				>
			</fieldset>
			<EvidenceFields bind:items={draft.evidence} kind="evidence" {busy} />
			<label>
				Question for the user
				<textarea
					bind:value={draft.question}
					rows="2"
					disabled={busy}
					placeholder="Leave blank if no decision is needed."></textarea>
			</label>
			<label>
				Answer options
				<textarea
					bind:value={draft.options}
					rows="3"
					disabled={busy}
					aria-describedby="project-options-hint"></textarea>
			</label>
			<p id="project-options-hint" class="hint">Optional. Write one suggested answer per line.</p>
		{:else}
			<p class="question">{draft.question}</p>
			{#if draft.options.length}
				<div class="answer-options" aria-label="Suggested answers">
					{#each [...new Set(draft.options)] as option (option)}
						<button
							type="button"
							disabled={busy}
							onclick={() => {
								if (draft.kind === 'answer') draft.answer = option;
							}}
							aria-pressed={draft.answer === option}
						>
							{option}
						</button>
					{/each}
				</div>
			{/if}
			<label>
				Decision answer
				<textarea bind:value={draft.answer} rows="4" required disabled={busy}></textarea>
			</label>
		{/if}
	</div>
	<footer>
		<button type="button" onclick={onCancel} disabled={busy}>
			{stale ? 'Discard changes' : 'Cancel'}
		</button>
		<button class="primary" type="submit" disabled={busy || stale}>
			{busy ? 'Saving...' : saveLabel}
		</button>
	</footer>
</form>

<style>
	.hint {
		margin: -1px 0 15px;
		color: var(--app-text-secondary);
		font-size: 11px;
		line-height: 1.45;
	}
	.message {
		margin: 0 0 13px;
		padding: 9px 11px;
		border-radius: var(--app-control-radius);
		font-size: 12px;
		line-height: 1.45;
	}
	.error {
		color: var(--app-danger);
		background: var(--app-danger-bg);
	}
	.stale {
		color: var(--app-warning);
		background: var(--app-warning-bg);
	}
	.steps {
		min-width: 0;
		margin: 0 0 14px;
		padding: 0;
		border: 0;
	}
	legend {
		padding: 0;
		margin-bottom: 8px;
		font-size: 12px;
	}
	.steps .step-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 104px auto;
		gap: 6px;
		align-items: center;
		margin-bottom: 7px;
	}
	.step-actions {
		display: flex;
		gap: 3px;
	}
	.steps button {
		min-width: 24px;
		min-height: var(--app-control-height);
		padding: 4px 6px;
		border: 1px solid var(--app-control-border);
		border-radius: var(--app-control-radius);
		color: var(--app-text);
		background: var(--app-control);
		font-size: 12px;
	}
	.steps .add-step {
		padding-inline: 9px;
		font-size: 11px;
	}
	@container (max-width: 420px) {
		.steps .step-row {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.step-row > input {
			grid-column: 1 / -1;
		}
	}
	.question {
		margin: 0 0 14px;
		font-size: 13px;
		line-height: 1.5;
		white-space: pre-wrap;
	}
	.answer-options {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
		margin-bottom: 16px;
	}
	.answer-options button {
		padding: 7px 10px;
		border: 1px solid var(--app-control-border);
		border-radius: var(--app-control-radius);
		color: var(--app-text);
		background: var(--app-control);
		font-size: 12px;
		text-align: left;
		overflow-wrap: anywhere;
	}
	.answer-options button[aria-pressed='true'] {
		border-color: var(--app-accent);
		background: color-mix(in srgb, var(--app-accent) 12%, var(--app-control));
	}
</style>
