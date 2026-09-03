<script lang="ts">
	import { onMount } from 'svelte';
	import { apps } from '🍎/state/apps.svelte';
	import { subscribeToDesktopCommands } from '🍎/lib/desktop/commands';
	import { canvasDocument, canvasService, isCanvasPath } from '🍎/lib/canvas/canvas';
	import { workspaceService } from '🍎/lib/workspace/workspace';
	import { workspaceBasename } from '🍎/lib/workspace/path';

	type Dialog = 'new' | 'open' | 'import' | 'copy' | 'export' | 'link';
	let canvas = $state.raw(canvasService.snapshot());
	let working = $state(false);
	let error = $state('');
	let notice = $state('');
	let editorError = $state('');
	let editorAttempt = $state(0);
	let dialog = $state<Dialog | null>(null);
	let filePath = $state('');
	let fileTitle = $state('Untitled');
	let importFile = $state.raw<File | null>(null);
	let paths = $state.raw<string[]>([]);
	let dialogSource: string | null = null;
	let linkSelection = $state.raw<string[]>([]);
	const busy = $derived(working || canvas.status === 'loading' || canvas.status === 'saving');
	const status = $derived(
		{
			loading: 'Opening…',
			saved: 'Saved',
			dirty: 'Unsaved changes',
			saving: 'Saving…',
			conflict: 'Changes need review',
			error: 'File needs attention',
		}[canvas.status],
	);
	const visiblePaths = $derived(
		paths.filter((path) => path.toLowerCase().includes(filePath.toLowerCase())),
	);
	const dialogTitle = $derived(
		dialog === 'new'
			? 'New canvas'
			: dialog === 'open'
				? 'Open canvas'
				: dialog === 'import'
					? 'Import canvas'
					: dialog === 'copy'
						? 'Save a copy'
						: dialog === 'export'
							? 'Export PNG'
							: 'Link selected objects',
	);

	async function perform(action: () => unknown | Promise<unknown>) {
		if (working) return;
		working = true;
		error = '';
		notice = '';
		try {
			await action();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The canvas operation could not finish.';
		} finally {
			working = false;
		}
	}
	function attachEditor(host: HTMLDivElement) {
		let cancelled = false;
		let dispose: (() => void) | undefined;
		void import('🍎/lib/canvas/editor')
			.then(async (module) => {
				if (cancelled) return;
				const cleanup = await module.mountCanvas(host);
				if (cancelled) cleanup();
				else dispose = cleanup;
			})
			.catch((cause: unknown) => {
				if (!cancelled)
					editorError =
						cause instanceof Error ? cause.message : 'The drawing editor could not load.';
			});
		return () => {
			cancelled = true;
			dispose?.();
		};
	}
	function focusForm(node: HTMLFormElement) {
		node.querySelector<HTMLInputElement>('input')?.focus();
	}
	function showDialog(kind: Dialog) {
		if (busy) return;
		error = '';
		notice = '';
		paths = workspaceService
			.getAllPaths()
			.filter((path) => isCanvasPath(path) && !/^\/(System|Trash)\//.test(path))
			.sort();
		dialogSource = canvas.path;
		linkSelection = [...canvas.selectedIds];
		fileTitle = 'Untitled';
		importFile = null;
		const stem =
			canvas.path?.replace(/(?:\.canvas\.json|\.excalidraw)$/i, '') ?? '/Documents/Untitled';
		filePath =
			kind === 'new' || kind === 'import'
				? '/Documents/Untitled.excalidraw'
				: kind === 'copy'
					? `${stem} copy.excalidraw`
					: kind === 'export'
						? `${stem}.png`
						: '';
		dialog = kind;
	}
	function chooseImport(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		importFile = null;
		if (!file) return;
		if (!/\.(?:excalidraw|canvas\.json)$/i.test(file.name)) {
			error = 'Choose an .excalidraw or .canvas.json file.';
			return;
		}
		error = '';
		importFile = file;
		filePath = `/Documents/${file.name.replace(/(?:\.canvas\.json|\.excalidraw)$/i, '')}.excalidraw`;
	}
	function submitDialog(event: SubmitEvent) {
		event.preventDefault();
		const kind = dialog,
			path = filePath.trim(),
			title = fileTitle.trim(),
			imported = importFile;
		const source = dialogSource,
			selection = [...linkSelection];
		void perform(async () => {
			if (kind === 'new') await canvasService.create(path, title);
			else if (kind === 'open') await canvasDocument.open(path);
			else if (kind === 'import') {
				if (!imported) throw new Error('Choose an .excalidraw or .canvas.json file first.');
				await canvasService.importFile(imported, path);
			} else if (kind === 'copy') {
				if (canvas.path !== source)
					throw new Error('The open canvas changed. Open Save Copy again for the current canvas.');
				await canvasService.saveCopy(path);
				notice = `Copy saved to ${path}`;
			} else if (kind === 'export') {
				if (!source || canvas.path !== source)
					throw new Error('The open canvas changed. Open Export PNG again.');
				await canvasService.save();
				const saved = canvasService.snapshot();
				if (!saved.revision || saved.path !== source)
					throw new Error('Save this canvas before exporting.');
				await canvasService.export(source, path, saved.revision, 'human');
				notice = `PNG saved to ${path}`;
			} else if (kind === 'link') {
				if (
					canvas.path !== source ||
					JSON.stringify(canvas.selectedIds) !== JSON.stringify(selection)
				)
					throw new Error('The selection changed. Open Link selection again.');
				await canvasService.setSelectionLink(path || null);
				notice = path
					? 'Workspace link added to the selected objects.'
					: 'Links removed from the selected objects.';
			}
			dialog = null;
		});
	}
	function discard() {
		void perform(async () => {
			await canvasService.discard();
			dialog = null;
			notice = 'Reloaded the saved canvas.';
		});
	}
	function keyboard(event: KeyboardEvent) {
		if (apps.active !== 'canvas') return;
		if (event.key === 'Escape' && dialog && !working) {
			event.preventDefault();
			dialog = null;
		}
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
			event.preventDefault();
			void perform(() => canvasService.save());
		}
	}
	onMount(() => {
		const unsubscribe = canvasService.subscribe(() => {
			canvas = canvasService.snapshot();
		});
		const commands = subscribeToDesktopCommands(({ target, command }) => {
			if (target !== 'canvas') return;
			if (command === 'new-document') showDialog('new');
			else if (command === 'open') showDialog('open');
			else if (command === 'save') void perform(() => canvasService.save());
			else if (command === 'download') void perform(() => canvasService.download());
			else if (command === 'zoom') void perform(() => canvasService.fit());
		});
		void perform(() => canvasService.ensure());
		return () => {
			unsubscribe();
			commands();
		};
	});
</script>

<svelte:window onkeydown={keyboard} />

{#snippet toolIcon(name: string)}
	<svg
		class="tool-icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.4"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		{#if name === 'open'}<path d="M3 6h7l2 2h9v12H3zM3 8V4h7l2 2h7" />
		{:else if name === 'new'}<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 13h6M12 10v6" />
		{:else if name === 'save'}<path d="M4 3h14l3 3v15H3V3zM7 3v6h10V3M7 21v-8h10v8" />
		{:else if name === 'copy'}<path d="M8 7h12v14H8zM5 17H3V3h12v2" />
		{:else if name === 'import'}<path d="M4 14v7h16v-7M12 3v13M7 11l5 5 5-5" />
		{:else if name === 'export'}<path
				d="M6 3h8l4 4v6M14 3v5h4M6 3v18h12v-4M11 15h10M18 12l3 3-3 3"
			/>
		{:else}<path d="M4 15v6h16v-6M12 3v13M7 11l5 5 5-5" />{/if}
	</svg>
{/snippet}

<section class="canvas-app" aria-label="Canvas app">
	<header class="app-window-drag-handle">
		<div class="traffic-space" aria-hidden="true"></div>
		<h1 title={canvas.path ?? 'Canvas'}>{canvas.title || 'Canvas'}</h1>
		<span
			class={[
				'save-status',
				{ changed: canvas.status === 'dirty' || canvas.status === 'conflict' },
			]}
			role="status">{status}</span
		>
	</header>
	<div class="toolbar" role="toolbar" aria-label="Canvas file tools">
		<button disabled={busy} onclick={() => showDialog('new')}>{@render toolIcon('new')}New</button>
		<button disabled={busy} onclick={() => showDialog('open')}
			>{@render toolIcon('open')}Open</button
		>
		<button disabled={busy} onclick={() => showDialog('import')}
			>{@render toolIcon('import')}Import</button
		>
		<span class="separator"></span>
		<button
			disabled={busy || !canvas.path || canvas.status === 'conflict'}
			onclick={() => void perform(() => canvasService.save())}
			>{@render toolIcon('save')}Save</button
		>
		<button disabled={busy || !canvas.path} onclick={() => showDialog('copy')}
			>{@render toolIcon('copy')}Save Copy</button
		>
		<span class="separator"></span>
		<button
			disabled={busy || !canvas.path || canvas.status === 'conflict'}
			onclick={() => showDialog('export')}>{@render toolIcon('export')}Export PNG</button
		>
		<button
			disabled={busy || !canvas.path}
			aria-label="Download .excalidraw"
			title="Download as .excalidraw"
			onclick={() => void perform(() => canvasService.download())}
			>{@render toolIcon('download')}Download</button
		>
	</div>
	{#if error}<p class="message error" role="alert">{error}</p>{/if}
	{#if canvas.status === 'conflict'}
		<div class="message conflict" role="alert">
			<p>
				{canvas.error ||
					'The saved file changed while you were drawing. Your drawing is still here.'} Save a copy to
				keep your work, or discard your draft and reload the saved file.
			</p>
			<div>
				<button disabled={busy} onclick={() => showDialog('copy')}>Save Copy</button><button
					disabled={busy}
					onclick={discard}>Discard and Reload</button
				>
			</div>
		</div>
	{:else if canvas.error}<p class="message error" role="alert">{canvas.error}</p>{/if}
	{#if canvas.warning}<p class="message">{canvas.warning}</p>{/if}
	{#if notice}<p class="message notice" role="status">{notice}</p>{/if}
	{#if dialog}
		<form class="path-form" aria-label={dialogTitle} onsubmit={submitDialog} {@attach focusForm}>
			<div class="form-heading">
				<strong>{dialogTitle}</strong><span
					>{dialog === 'import'
						? 'Your file stays in this browser workspace.'
						: dialog === 'link'
							? `${linkSelection.length} selected; leave empty to remove links.`
							: 'Choose a new filename for a copy or import.'}</span
				>
			</div>
			{#if dialog === 'new'}<label
					>Canvas title<input
						bind:value={fileTitle}
						maxlength="120"
						required
						disabled={busy}
					/></label
				>{/if}
			{#if dialog === 'import'}<label
					>Choose a canvas file<input
						class="import-file"
						type="file"
						accept=".excalidraw,.canvas.json,application/json"
						onchange={chooseImport}
						disabled={busy}
						required
					/></label
				>{/if}
			<label
				>{dialog === 'export'
					? 'PNG destination'
					: dialog === 'import' || dialog === 'copy'
						? 'Save to workspace'
						: dialog === 'link'
							? 'Workspace file link'
							: 'Canvas path'}<input
					bind:value={filePath}
					list={dialog === 'open' ? 'canvas-file-paths' : undefined}
					placeholder={dialog === 'link' ? '/Documents/Brief.md' : '/Documents/Diagram.excalidraw'}
					required={dialog !== 'link'}
					disabled={busy}
				/></label
			>
			{#if dialog === 'open'}<datalist id="canvas-file-paths"
					>{#each visiblePaths as path (path)}<option value={path}>{workspaceBasename(path)}</option
						>{/each}</datalist
				>{/if}
			<div class="form-actions">
				<button type="button" disabled={busy} onclick={() => (dialog = null)}>Cancel</button><button
					class="primary"
					type="submit"
					disabled={busy || (dialog === 'import' && !importFile)}
					>{dialog === 'new'
						? 'Create canvas'
						: dialog === 'open'
							? 'Open canvas'
							: dialog === 'import'
								? 'Import into workspace'
								: dialog === 'copy'
									? 'Save copy'
									: dialog === 'export'
										? 'Save PNG'
										: 'Apply link'}</button
				>
			</div>
		</form>
	{/if}
	<div class="editor-area">
		{#key editorAttempt}<div
				class="excalidraw-host"
				aria-label="Excalidraw drawing editor"
				{@attach attachEditor}
			></div>{/key}
		{#if editorError}<div class="editor-loading" role="alert">
				<strong>The drawing editor could not load.</strong>
				<p>{editorError}</p>
				<button
					onclick={() => {
						editorError = '';
						editorAttempt++;
					}}>Retry editor</button
				>
			</div>
		{:else if !canvas.mounted}<div class="editor-loading" role="status">
				Loading drawing tools…
			</div>{/if}
	</div>
	<footer>
		<span>{canvas.elementCount} {canvas.elementCount === 1 ? 'element' : 'elements'}</span><span
			>{canvas.selectedIds.length
				? `${canvas.selectedIds.length} selected`
				: 'No objects selected'}</span
		>
		<div>
			<button disabled={busy || !canvas.selectedIds.length} onclick={() => showDialog('link')}
				>Link selection</button
			><button
				disabled={busy || !canvas.mounted}
				onclick={() => void perform(() => canvasService.fit())}>Fit</button
			>
		</div>
	</footer>
</section>

<style>
	.canvas-app {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-height: 0;
		overflow: hidden;
		border-radius: inherit;
		color: var(--app-text);
		background: var(--app-surface);
		font-size: 12px;
		container-type: inline-size;
	}
	header {
		height: var(--app-titlebar-height);
		display: flex;
		align-items: center;
		gap: 12px;
		padding-right: 15px;
		background: var(--app-chrome);
		border-bottom: 1px solid var(--app-border);
		flex-shrink: 0;
	}
	.traffic-space {
		width: 77px;
		flex: none;
	}
	header h1 {
		flex: 1;
		min-width: 0;
		margin: 0;
		text-align: center;
		font-size: 13px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	button,
	input {
		font: inherit;
	}
	button {
		border: 1px solid var(--app-control-border);
		border-radius: var(--app-control-radius);
		background: var(--app-control);
		padding: 5px 10px;
		color: inherit;
		cursor: default;
	}
	button:hover:not(:disabled) {
		background: var(--app-hover);
	}
	button:disabled {
		opacity: 0.45;
	}
	button:focus-visible,
	input:focus-visible {
		outline: 2px solid var(--app-focus);
		outline-offset: 2px;
	}
	button.primary {
		background: var(--app-accent);
		border-color: var(--app-accent);
		color: var(--app-accent-text);
	}
	button.primary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--app-accent) 85%, var(--app-text));
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 4px;
		min-height: 37px;
		padding: 4px 10px;
		overflow-x: auto;
		border-bottom: 1px solid var(--app-border);
		flex-shrink: 0;
		background: var(--app-toolbar);
	}
	.toolbar button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		flex-shrink: 0;
		border-color: transparent;
		background: transparent;
		padding: 3px 8px;
		white-space: nowrap;
		min-height: var(--app-control-height);
		font-size: 12px;
	}
	.toolbar button:hover:not(:disabled) {
		background: var(--app-hover);
	}
	.tool-icon {
		height: 17px;
		width: 17px;
	}
	.separator {
		width: 1px;
		height: 18px;
		background: var(--app-border);
		margin: 0 4px;
		flex-shrink: 0;
	}
	.save-status {
		color: var(--app-text-secondary);
		font-size: 10px;
		min-width: 62px;
		text-align: right;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.save-status.changed {
		color: var(--app-warning);
	}
	.message {
		margin: 0;
		padding: 7px 14px;
		border-bottom: 1px solid var(--app-border);
		background: var(--app-warning-bg);
		color: var(--app-warning);
		font-size: 12px;
		line-height: 1.45;
		overflow-wrap: anywhere;
		flex-shrink: 0;
	}
	.error {
		background: var(--app-danger-bg);
		border-color: var(--app-border);
		color: var(--app-danger);
	}
	.notice {
		background: color-mix(in srgb, var(--app-success) 12%, var(--app-surface));
		border-color: var(--app-border);
		color: var(--app-success);
	}
	.conflict {
		display: flex;
		align-items: center;
		gap: 14px;
		justify-content: space-between;
	}
	.conflict p {
		margin: 0;
	}
	.conflict > div {
		display: flex;
		flex-shrink: 0;
		gap: 6px;
	}
	.path-form {
		display: flex;
		align-items: flex-end;
		flex-wrap: wrap;
		padding: 12px 14px;
		gap: 10px 12px;
		border-bottom: 1px solid var(--app-border);
		background: var(--app-info-bg);
		flex-shrink: 0;
		max-height: 240px;
		overflow: auto;
	}
	.form-heading {
		display: flex;
		flex-direction: column;
		gap: 3px;
		width: 100%;
	}
	.form-heading strong {
		font-weight: 600;
	}
	.form-heading span {
		font-size: 11px;
		color: var(--app-text-secondary);
	}
	.path-form label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		flex: 1;
		min-width: 200px;
		line-height: 1.3;
	}
	.form-actions {
		display: flex;
		gap: 6px;
	}
	input {
		border: 1px solid var(--app-control-border);
		border-radius: var(--app-control-radius);
		background: var(--app-field);
		padding: 5px 7px;
		color: var(--app-text);
		min-width: 0;
		max-width: 100%;
		width: 100%;
		box-sizing: border-box;
		box-shadow: inset 0 1px 2px #00000006;
	}
	.import-file {
		padding: 4px;
	}
	.editor-area {
		position: relative;
		display: flex;
		flex: 1;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
		background: var(--app-surface);
	}
	.excalidraw-host {
		flex: 1;
		min-height: 0;
		min-width: 0;
		width: 100%;
		height: 100%;
	}
	.editor-loading {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 24px;
		background: var(--app-surface);
		color: var(--app-text-secondary);
		text-align: center;
		overflow: auto;
	}
	.editor-loading p {
		margin: 0;
		max-width: 440px;
		overflow-wrap: anywhere;
	}
	footer {
		min-height: 32px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 4px 12px;
		border-top: 1px solid var(--app-border);
		color: var(--app-text-secondary);
		font-size: 11px;
		flex-shrink: 0;
		background: var(--app-toolbar);
	}
	footer > div {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	footer button {
		font-size: 11px;
		padding: 3px 8px;
	}
	@container (max-width:620px) {
		.toolbar {
			padding-left: 6px;
		}
		.conflict {
			flex-direction: column;
			align-items: stretch;
			gap: 8px;
		}
		.conflict > div {
			flex-wrap: wrap;
		}
		.path-form {
			max-height: 210px;
		}
		.path-form label {
			min-width: 160px;
		}
		footer > span:nth-child(2) {
			display: none;
		}
		.save-status {
			font-size: 10px;
		}
	}
</style>
