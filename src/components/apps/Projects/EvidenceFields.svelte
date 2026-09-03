<script lang="ts">
	import type { ProjectEvidence } from '🍎/lib/projects/projects';

	let {
		items = $bindable(),
		kind,
		busy,
	}: {
		items: ProjectEvidence[];
		kind: 'reference' | 'evidence';
		busy: boolean;
	} = $props();

	const name = $derived(kind === 'reference' ? 'Reference' : 'Evidence');
	const title = $derived(kind === 'reference' ? 'References' : 'Evidence');

	function add() {
		if (!busy && items.length < 40) items.push({ target: '', label: '', detail: '' });
	}
	function remove(item: ProjectEvidence) {
		if (!busy) items = items.filter((candidate) => candidate !== item);
	}
</script>

<fieldset class="evidence-fields" disabled={busy}>
	<legend>{title}</legend>
	{#each items as item, index (item)}
		<fieldset class="evidence-row">
			<legend>{name} {index + 1}</legend>
			<div class="target-row">
				<label>
					Path or URL
					<input
						bind:value={item.target}
						aria-label={`${name} ${index + 1} target`}
						required
						spellcheck="false"
					/>
				</label>
				<button
					type="button"
					onclick={() => remove(item)}
					aria-label={`Remove ${kind} ${index + 1}`}
				>
					Remove
				</button>
			</div>
			<label>
				Label
				<input
					bind:value={item.label}
					aria-label={`${name} ${index + 1} label`}
					placeholder="Use the filename if blank"
				/>
			</label>
			<label>
				Detail
				<textarea bind:value={item.detail} aria-label={`${name} ${index + 1} detail`} rows="2"
				></textarea>
			</label>
		</fieldset>
	{/each}
	<button type="button" onclick={add} disabled={items.length >= 40}>Add {kind}</button>
	{#if !items.length}
		<p class="hint">Optional. Link a workspace file or a web page.</p>
	{/if}
</fieldset>

<style>
	.evidence-fields {
		min-width: 0;
		margin: 0 0 15px;
		padding: 0;
		border: 0;
	}
	legend {
		margin-bottom: 8px;
		padding: 0;
		font-size: 12px;
	}
	.evidence-row {
		min-width: 0;
		margin: 4px 0 12px;
		padding: 9px 10px 3px;
		border: 1px solid var(--app-control-border);
		border-radius: var(--app-control-radius);
	}
	.evidence-row legend {
		margin: 0;
		padding: 0 4px;
		color: var(--app-text-secondary);
		font-size: 11px;
	}
	.target-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px;
		align-items: end;
	}
	.target-row button {
		margin-bottom: 7px;
	}
	button {
		min-height: var(--app-control-height);
		padding: 4px 9px;
		border: 1px solid var(--app-control-border);
		border-radius: var(--app-control-radius);
		color: var(--app-text);
		background: var(--app-control);
		font-size: 11px;
	}
	.hint {
		margin: 8px 0 0;
		color: var(--app-text-secondary);
		font-size: 11px;
		line-height: 1.4;
	}
</style>
