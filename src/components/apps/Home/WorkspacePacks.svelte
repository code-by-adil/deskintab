<script lang="ts">
	import {
		packService,
		PACK_LIMITS,
		type PackPreview,
		type PackImportResult,
	} from '../../../lib/packs/packs';
	import { workspaceService } from '../../../lib/workspace/workspace';
	import { workspaceBasename } from '../../../lib/workspace/path';
	import { revealDesktop } from '../../../lib/desktop/files';

	let { onBusyChange }: { onBusyChange?: (busy: boolean) => void } = $props();
	let busy = $state(false);
	let message = $state('');
	let error = $state('');
	let filename = $state('');
	let preview = $state.raw<PackPreview | null>(null);
	let result = $state.raw<PackImportResult | null>(null);
	let packText = '';

	function setBusy(value: boolean) {
		busy = value;
		onBusyChange?.(value);
	}

	function size(bytes: number) {
		return bytes < 1024
			? `${bytes} bytes`
			: bytes < 1024 * 1024
				? `${(bytes / 1024).toFixed(1)} KiB`
				: `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
	}

	async function exportWorkspace() {
		setBusy(true);
		error = '';
		message = '';
		try {
			const exported = await packService.exportPack();
			message = `Saved ${exported.files} files and ${exported.directories} folders to ${exported.path}.`;
			if (exported.warning) message += ` ${exported.warning}`;
			const bytes = await workspaceService.readBytes(exported.path);
			const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
			const link = document.createElement('a');
			link.href = url;
			link.download = workspaceBasename(exported.path);
			link.click();
			setTimeout(() => URL.revokeObjectURL(url), 30_000);
			message += ' Download requested. The pack is also in Finder.';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			setBusy(false);
		}
	}

	async function choosePack(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		preview = null;
		result = null;
		packText = '';
		filename = file?.name ?? '';
		error = '';
		message = '';
		if (!file) return;
		setBusy(true);
		try {
			if (file.size > PACK_LIMITS.textBytes)
				throw new Error('Choose a workspace pack smaller than 48 MiB.');
			packText = await file.text();
			preview = await packService.inspectPackText(packText);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			setBusy(false);
		}
	}

	async function importWorkspace(conflictMode: 'stop' | 'preserve' = 'stop') {
		if (!preview || (!preview.canImport && !(preview.canPreserve && conflictMode === 'preserve')))
			return;
		setBusy(true);
		error = '';
		try {
			result = await packService.importPackText(packText, { conflictMode });
			if (result.status === 'imported') {
				message = `Imported ${result.createdFiles.length} files and ${result.createdDirectories.length} folders. Kept ${result.skippedFiles} identical files.`;
				if (result.preservedFiles.length)
					message += ` Preserved ${result.preservedFiles.length} original files in Imports.`;
				preview = null;
				packText = '';
			} else if (result.status === 'blocked') {
				preview = await packService.inspectPackText(packText);
				error = 'The workspace has conflicting files. Nothing was imported.';
			} else {
				error = `Import failed. ${result.error} Removed ${result.rolledBack.length} new items. ${result.remainingPaths.length ? 'Inspect the remaining paths below.' : 'No imported items remain.'}`;
				preview = null;
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			setBusy(false);
		}
	}

	async function recheckPack() {
		setBusy(true);
		error = '';
		result = null;
		try {
			preview = await packService.inspectPackText(packText);
		} catch (cause) {
			preview = null;
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			setBusy(false);
		}
	}

	async function showConflict(path: string) {
		try {
			await revealDesktop({ path, target: 'finder' });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}
</script>

<section class="workspace-packs" aria-label="Workspace packs">
	<div class="pack-heading">
		<div>
			<h2>Take your workspace with you</h2>
			<p>Keep a copy of your saved files, preferences, shortcuts, and apps.</p>
		</div>
		<button disabled={busy} onclick={exportWorkspace}>Export workspace</button>
	</div>
	<p class="pack-note">
		Includes saved files and empty folders, up to 32 MiB. System data, recovery history, Trash, and
		other packs are left out. Save open drafts before exporting.
	</p>
	<div class="pack-import">
		<label for="workspace-pack-file">Choose workspace pack</label>
		<input
			id="workspace-pack-file"
			type="file"
			accept=".desktop-pack.json,application/json"
			disabled={busy}
			onchange={choosePack}
		/>
		<p class="pack-note">
			Files return to their original paths. Existing folders merge. Identical files stay as they
			are. Preview any different files before importing.
		</p>
	</div>
	{#if preview}
		<div class="pack-preview" aria-label="Pack preview">
			<strong>{filename}</strong>
			<p>{preview.files} files · {preview.directories} folders · {size(preview.totalBytes)}</p>
			<p>
				{preview.filesToCreate} new files, {preview.directoriesToCreate} new folders, {preview.existingFiles}
				identical files.
			</p>
			{#if preview.collisions.length}
				<p class="conflicts">{preview.collisions.length} existing paths differ from this pack.</p>
				{#if preview.canPreserve}
					<p class="pack-note">
						Keep both moves the existing files into a new folder under /Imports and restores the
						packed files at their original paths. This also preserves starter files from a fresh
						desktop.
					</p>
				{:else}
					<p class="pack-note">
						Save or close the editors named below. Move conflicting folders or links aside in
						Finder, then recheck. These conflicts cannot be resolved automatically.
					</p>
				{/if}
				<ul>
					{#each preview.collisions as collision (collision.path)}
						<li>
							<code>{collision.path}</code><span>{collision.reason}</span>
							<button
								class="reveal"
								aria-label={`Show ${collision.path} in Finder`}
								onclick={() => showConflict(collision.path)}>Show in Finder</button
							>
						</li>
					{/each}
				</ul>
				<button disabled={busy} onclick={recheckPack}>Recheck pack</button>
			{/if}
			{#if preview.canPreserve}
				<button class="primary" disabled={busy} onclick={() => importWorkspace('preserve')}
					>Keep both and import</button
				>
			{:else}
				<button
					class="primary"
					disabled={busy || !preview.canImport}
					onclick={() => importWorkspace()}>Import workspace pack</button
				>
			{/if}
		</div>
	{/if}
	{#if busy}<p class="pack-note" role="status">Checking and saving workspace files…</p>{/if}
	{#if message}<p class="message" role="status">{message}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if result?.warning}<p class="error">{result.warning}</p>{/if}
	{#if result?.preservedFiles.length}
		<ul aria-label="Preserved original files">
			{#each result.preservedFiles as saved (saved.to)}
				<li>
					<code>{saved.from}</code><span>Original saved at {saved.to}</span><button
						class="reveal"
						onclick={() => showConflict(saved.to)}>Show original in Finder</button
					>
				</li>
			{/each}
		</ul>
	{/if}
	{#if result?.remainingPaths.length}
		<ul aria-label="Import paths needing inspection">
			{#each result.remainingPaths as path (path)}<li><code>{path}</code></li>{/each}
		</ul>
	{/if}
</section>

<style>
	.workspace-packs {
		color: var(--app-text, #303238);
		font-size: 13px;
	}
	.pack-heading {
		display: flex;
		gap: 20px;
		align-items: center;
		justify-content: space-between;
	}
	h2 {
		font-size: 16px;
		font-weight: 600;
		margin: 0 0 7px;
	}
	p {
		line-height: 1.5;
		margin: 6px 0;
	}
	.pack-note {
		color: var(--app-text-secondary, #737782);
		font-size: 12px;
	}
	.pack-heading > div {
		min-width: 0;
	}
	button {
		flex-shrink: 0;
		border: 1px solid var(--app-control-border, #c9ccd2);
		border-radius: 6px;
		padding: 6px 11px;
		color: var(--app-text, #303238);
		background: var(--app-control, #fff);
		font: inherit;
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: var(--app-hover, #f4f5f7);
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button:focus-visible,
	input:focus-visible {
		outline: 2px solid var(--app-focus, #3576d4);
		outline-offset: 3px;
	}
	.primary {
		background: var(--app-accent, #276aca);
		color: var(--app-accent-text, #fff);
		border-color: var(--app-accent, #276aca);
		margin-top: 8px;
	}
	.primary:hover:not(:disabled) {
		background: var(--app-accent, #205fb9);
	}
	.pack-import {
		border-top: 1px solid var(--app-border, #dddfe4);
		padding-top: 15px;
		margin-top: 16px;
	}
	label {
		font-weight: 600;
		display: block;
		margin-bottom: 8px;
	}
	input {
		max-width: 100%;
		font: inherit;
	}
	.pack-preview {
		background: var(--app-surface-secondary, #fff);
		border: 1px solid var(--app-border, #dadde3);
		padding: 14px;
		border-radius: 8px;
		margin-top: 16px;
	}
	strong,
	code {
		overflow-wrap: anywhere;
	}
	ul {
		margin: 10px 0;
		padding-left: 18px;
		max-height: 170px;
		overflow: auto;
	}
	li {
		margin: 7px 0;
	}
	li span {
		display: block;
		color: var(--app-text-secondary, #737782);
		font-size: 12px;
	}
	.reveal {
		padding: 3px 7px;
		margin-top: 4px;
		font-size: 12px;
	}
	.error,
	.conflicts {
		color: var(--app-danger, #a13b31);
	}
	.message {
		color: var(--app-success, #326743);
		overflow-wrap: anywhere;
	}
	@media (max-width: 560px) {
		.pack-heading {
			align-items: flex-start;
			flex-direction: column;
			gap: 8px;
		}
	}
</style>
