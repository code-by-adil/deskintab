<script lang="ts">
	import WindowSheet from '🍎/components/SystemUI/WindowSheet.svelte';
	import { onMount, untrack } from 'svelte';
	import PdfPreview from './PdfPreview.svelte';
	import SourcesPanel from './SourcesPanel.svelte';
	import { apps } from '🍎/state/apps.svelte';
	import { issueDesktopCommand, subscribeToDesktopCommands } from '🍎/lib/desktop/commands';
	import { officeFrameUrl, officeService, type ImageInsertionTarget } from '🍎/lib/office/office';
	import { isOfficeImagePath } from '🍎/lib/office/image';
	import { workspaceBasename, workspaceDirname } from '🍎/lib/workspace/path';
	import { workspaceService } from '🍎/lib/workspace/workspace';

	type Dialog = 'open' | 'save-as' | 'export' | 'insert-image' | null;
	let office = $state.raw(officeService.snapshot());
	let wasReady = $state(false);
	let dialog = $state<Dialog>(null);
	let paths = $state.raw<string[]>([]);
	let query = $state('');
	let destination = $state('');
	let error = $state('');
	let working = $state(false);
	let printHelp = $state(false);
	let showSources = $state(false);
	let downloads = $state<HTMLDetailsElement>();
	let importInput: HTMLInputElement;
	let imageInput: HTMLInputElement;
	let imageTarget: ImageInsertionTarget | undefined;
	let imageDescription = $state('');
	let dialogSourcePath: string | null = null;
	let dialogOpener = $state.raw<Element | null>(null);

	const title = $derived(
		office.preview
			? workspaceBasename(office.preview.path)
			: office.path
				? workspaceBasename(office.path)
				: 'Documents',
	);
	const busy = $derived(working || office.busy);
	const canEdit = $derived(wasReady && !busy && office.status === 'ready' && !office.preview);
	const visiblePaths = $derived(
		paths.filter(
			(path) =>
				(dialog === 'insert-image'
					? isOfficeImagePath(path)
					: /\.(odt|docx|doc|rtf|pdf)$/i.test(path)) &&
				path.toLowerCase().includes(query.trim().toLowerCase()),
		),
	);
	const status = $derived(
		(office.preview && office.status !== 'loading' ? 'PDF preview' : office.message) ||
			(busy ? 'Working…' : office.dirty ? 'Edited' : office.path ? 'Saved' : ''),
	);
	const dialogTitle = $derived(
		dialog === 'insert-image'
			? 'Insert an image'
			: dialog === 'open'
				? 'Open a document'
				: dialog === 'save-as'
					? 'Save document as'
					: 'Export document',
	);

	function attachEditor(node: HTMLIFrameElement) {
		return untrack(() => officeService.attach(node));
	}

	function refresh() {
		office = officeService.snapshot();
		if (office.status === 'ready') wasReady = true;
	}

	function refreshFiles() {
		paths = workspaceService
			.getAllPaths()
			.filter((path) => !/^\/(Trash|System)\//.test(path))
			.sort((a, b) => a.localeCompare(b));
	}

	async function perform(action: () => Promise<unknown>, closeOnSuccess = false) {
		if (working) return;
		error = '';
		working = true;
		if (downloads) downloads.open = false;
		try {
			await action();
			if (closeOnSuccess) dialog = null;
		} catch (cause) {
			error =
				cause instanceof Error ? cause.message : 'The document action could not be completed.';
		} finally {
			working = false;
		}
	}

	function showDialog(next: Exclude<Dialog, null>) {
		if (busy) return;
		dialogOpener = document.activeElement;
		dialogSourcePath = office.path;
		if (next === 'insert-image') {
			const path = office.path;
			if (!path || !canEdit) return;
			void perform(async () => {
				const document = await officeService.read(path);
				imageTarget = { path: document.path, revision: document.revision };
				imageDescription = '';
				query = '';
				refreshFiles();
				dialog = next;
			});
			return;
		}
		error = '';
		if (downloads) downloads.open = false;
		if (next === 'open') {
			query = '';
			refreshFiles();
		} else {
			const source = office.path || '/Documents/Untitled.odt';
			const stem = workspaceBasename(source).replace(/\.[^.]+$/, '');
			destination = `${workspaceDirname(source)}/${stem}${next === 'save-as' ? ' copy.odt' : '.pdf'}`;
		}
		dialog = next;
	}

	function submitPath(event: SubmitEvent) {
		event.preventDefault();
		if (office.path !== dialogSourcePath) {
			error = 'The open document changed. Cancel and reopen this dialog for the current document.';
			return;
		}
		const source = dialogSourcePath ?? undefined;
		const path = destination.trim();
		if (!path.startsWith('/') || path.endsWith('/')) {
			error = 'Enter a workspace file path, such as /Documents/Report.odt.';
			return;
		}
		const allowed = dialog === 'save-as' ? /\.(odt|docx)$/i : /\.(pdf|odt|docx)$/i;
		if (!allowed.test(path)) {
			error =
				dialog === 'save-as'
					? 'Use an .odt or .docx filename.'
					: 'Use a .pdf, .odt, or .docx filename.';
			return;
		}
		void perform(
			() =>
				dialog === 'save-as'
					? officeService.saveAs(path, source)
					: officeService.exportDocument(path, { expectedSourcePath: source }),
			true,
		);
	}

	function importDocument(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) void perform(() => officeService.importFile(file), true);
	}
	function insertImage(source: string | File) {
		const target = imageTarget;
		if (target)
			void perform(() => officeService.insertImage(target, source, imageDescription), true);
	}
	function importImage(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file && dialog === 'insert-image') insertImage(file);
	}

	function handleOfficeAction(action: string) {
		if (action === 'close') issueDesktopCommand('documents', 'close');
		if (busy) return;
		if (action === 'open' || action === 'save-as' || action === 'export') showDialog(action);
		if (action === 'new') void perform(() => officeService.newDocument());
		if (action === 'insert-image') showDialog('insert-image');
		if (action === 'print-help') showPrintHelp();
	}
	function showPrintHelp() {
		if (busy || dialog) return;
		if (office.preview) printHelp = true;
		else if (downloads) {
			downloads.open = true;
			downloads.querySelector<HTMLButtonElement>('button[data-format="pdf"]')?.focus();
		}
	}
	function printShortcut(event: KeyboardEvent) {
		if (
			apps.active !== 'documents' ||
			!(event.ctrlKey || event.metaKey) ||
			event.key.toLowerCase() !== 'p'
		)
			return;
		event.preventDefault();
		event.stopImmediatePropagation();
		showPrintHelp();
	}

	onMount(() => {
		refresh();
		refreshFiles();
		const unsubscribeOffice = officeService.subscribe(refresh);
		const unsubscribeFiles = workspaceService.subscribe(refreshFiles);
		const unsubscribeActions = officeService.onAction(handleOfficeAction);
		const unsubscribeCommands = subscribeToDesktopCommands(({ target, command }) => {
			if (target !== 'documents' || busy) return;
			if (command === 'new-document') void perform(() => officeService.newDocument());
			if (command === 'open') showDialog('open');
			if (command === 'save') void perform(() => officeService.save());
		});
		void officeService.show().catch(() => {});
		return () => {
			unsubscribeOffice();
			unsubscribeFiles();
			unsubscribeActions();
			unsubscribeCommands();
			officeService.detachView();
		};
	});
</script>

<svelte:window onkeydown={printShortcut} />

<section class="documents" aria-label="Documents">
	<div class="app-content" inert={dialog !== null}>
		<header class="titlebar app-window-drag-handle">
			<div class="traffic-space" aria-hidden="true"></div>
			<img src="/app-icons/documents.svg" alt="" width="22" height="22" />
			<div class="document-title">
				<strong title={office.preview?.path || office.path || 'Documents'}>{title}</strong>
				<span role="status" title={status}>{status}</span>
			</div>
			<span class="app-name">Documents</span>
		</header>
		<nav class="toolbar" aria-label="Document actions">
			<button
				disabled={busy || office.status === 'loading'}
				onclick={() => perform(() => officeService.newDocument())}>New</button
			>
			<button disabled={busy} onclick={() => showDialog('open')}>Open…</button>
			<span class="divider" aria-hidden="true"></span>
			<button
				disabled={!canEdit || !office.path}
				onclick={() => perform(() => officeService.save())}>Save</button
			>
			<button disabled={!canEdit} onclick={() => showDialog('save-as')}>Save As…</button>
			<button disabled={!canEdit} onclick={() => showDialog('export')}>Export…</button>
			<button disabled={!canEdit || !office.path} onclick={() => showDialog('insert-image')}
				>Insert Image…</button
			>
			{#if office.preview}
				<a href={office.preview.url} download={workspaceBasename(office.preview.path)}
					>Download PDF</a
				>
				{#if office.path}<button onclick={() => perform(() => officeService.open(office.path!))}
						>Back to document</button
					>{/if}
			{:else}
				<details class="downloads" bind:this={downloads}>
					<summary>Download</summary>
					<div class="download-menu">
						{#each [{ format: 'odt', label: 'OpenDocument (.odt)' }, { format: 'docx', label: 'Word (.docx)' }, { format: 'pdf', label: 'PDF (.pdf)' }] as item (item.format)}
							<button
								data-format={item.format}
								disabled={!canEdit}
								onclick={() =>
									perform(() => officeService.download(item.format as 'odt' | 'docx' | 'pdf'))}
								>{item.label}</button
							>
						{/each}
						<p class="download-hint">To print, download a PDF and open it in your PDF viewer.</p>
					</div>
				</details>
			{/if}
			<button
				disabled={!office.path || !!office.preview}
				aria-pressed={showSources}
				onclick={() => (showSources = !showSources)}>Sources</button
			>
		</nav>
		{#if showSources && office.path && !office.preview}
			{#key office.path}<SourcesPanel path={office.path} />{/key}
		{/if}
		{#if !office.preview}
			<p class="desktop-editing-notice">
				For full editing, use a desktop. You can still view and download documents here.
			</p>
		{:else if printHelp}
			<div class="print-help" role="status">
				To print, use Download PDF and open the file in your PDF viewer.
				<button aria-label="Dismiss printing guidance" onclick={() => (printHelp = false)}
					>Dismiss</button
				>
			</div>
		{/if}
		{#if (error || (office.message && office.status !== 'loading')) && (wasReady || office.preview)}
			<div class="error-banner" role="alert">
				{error || office.message}
				{#if office.preview && office.status === 'error'}
					<button disabled={busy} onclick={() => perform(() => officeService.retry())}
						>Try Again</button
					>
				{/if}
			</div>
		{/if}
		<div
			class="office-surface"
			aria-busy={busy || (!office.preview && office.status === 'loading')}
		>
			{#if office.engineRequested}
				{#key office.engineSession}
					<iframe
						title="Office document editor"
						class:preview-hidden={!!office.preview}
						src={officeFrameUrl}
						allow="clipboard-read; clipboard-write"
						inert={busy}
						{@attach attachEditor}
					></iframe>
				{/key}
			{/if}
			{#if office.preview}
				{#key office.preview.url}<PdfPreview url={office.preview.url} />{/key}
			{/if}
			{#if !office.preview && office.status !== 'ready'}
				<div class="startup">
					<img src="/app-icons/documents.svg" width="58" height="58" alt="" />
					{#if office.status === 'error'}
						<strong>Documents could not start</strong>
						<p role="alert">{error || office.message}</p>
						<button
							class="primary"
							disabled={busy}
							onclick={() => perform(() => officeService.retry())}>Try Again</button
						>
					{:else}
						<strong>Opening Documents</strong>
						<p role="status">{office.message || 'Loading the office editor…'}</p>
						<p class="startup-detail">The first launch can take a little longer.</p>
						<span class="spinner" aria-hidden="true"></span>
					{/if}
				</div>
			{/if}
		</div>
	</div>
	<input
		class="file-input"
		type="file"
		accept=".png,.jpg,.jpeg"
		aria-label="Import image"
		disabled={busy || dialog !== 'insert-image'}
		bind:this={imageInput}
		onchange={importImage}
	/>
	<input
		class="file-input"
		type="file"
		accept=".odt,.docx,.doc,.rtf"
		aria-label="Import office document"
		bind:this={importInput}
		onchange={importDocument}
	/>
	{#if dialog}
		<WindowSheet
			labelledby="document-dialog-title"
			{busy}
			returnFocus={dialogOpener}
			onclose={() => (dialog = null)}
		>
			<h2 id="document-dialog-title">{dialogTitle}</h2>
			{#if dialog === 'open' || dialog === 'insert-image'}
				<div class="sheet-body">
					{#if dialog === 'insert-image'}
						<p class="hint image-hint">
							Choose a PNG or JPEG, up to 10 MiB. Inserts at the cursor without replacing selected
							text. Imports are saved in Pictures.
						</p>
						<label for="image-description">Image description (optional)</label>
						<input
							id="image-description"
							bind:value={imageDescription}
							maxlength="2000"
							disabled={busy}
							placeholder="Describe the image for readers"
						/>
					{/if}
					<input
						class="search"
						type="search"
						aria-label={dialog === 'insert-image'
							? 'Search workspace images'
							: 'Search workspace documents'}
						placeholder={dialog === 'insert-image'
							? 'Search workspace images'
							: 'Search workspace documents'}
						bind:value={query}
						disabled={busy}
					/>
					<div class="file-list">
						{#each visiblePaths as path (path)}
							<button
								class="file-row"
								disabled={busy}
								onclick={() =>
									dialog === 'insert-image'
										? insertImage(path)
										: perform(() => officeService.open(path), true)}
							>
								{#if dialog === 'insert-image'}
									<svg
										width="28"
										height="28"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.5"
										aria-hidden="true"
									>
										<rect x="3" y="3" width="18" height="18" rx="3" />
										<circle cx="8" cy="8" r="1.5" />
										<path d="m3 17 5-5 4 4 4-7 5 8" />
									</svg>
								{:else}
									<img src="/app-icons/documents.svg" width="28" height="28" alt="" />
								{/if}
								<span
									><strong>{workspaceBasename(path)}</strong><small>{workspaceDirname(path)}</small
									></span
								>
							</button>
						{:else}
							<p class="empty">
								{dialog === 'insert-image'
									? query
										? 'No matching images.'
										: 'No PNG or JPEG images in Files yet. Import one from your computer.'
									: query
										? 'No matching documents.'
										: 'No office documents in this workspace yet.'}
							</p>
						{/each}
					</div>
					{#if error}<p class="sheet-error" role="alert">{error}</p>{/if}
				</div>
				<footer>
					<button disabled={busy} onclick={() => (dialog = null)}>Cancel</button>
					<button
						class="primary"
						disabled={busy}
						onclick={() => (dialog === 'insert-image' ? imageInput.click() : importInput.click())}
						>Import from Computer…</button
					>
				</footer>
			{:else}
				<form onsubmit={submitPath}>
					<div class="sheet-body">
						<label for="document-destination">Workspace path</label>
						<input
							id="document-destination"
							bind:value={destination}
							disabled={busy}
							spellcheck="false"
							required
						/>
						<p class="hint">
							{dialog === 'save-as'
								? 'Save an editable copy as .odt or .docx.'
								: 'Export a .pdf, .odt, or .docx file to Files. For printing, choose PDF, then download it and open it in your PDF viewer.'}
						</p>
						{#if error}<p class="sheet-error" role="alert">{error}</p>{/if}
					</div>
					<footer>
						<button type="button" disabled={busy} onclick={() => (dialog = null)}>Cancel</button>
						<button class="primary" type="submit" disabled={busy}
							>{busy ? 'Working…' : dialog === 'save-as' ? 'Save' : 'Export'}</button
						>
					</footer>
				</form>
			{/if}
		</WindowSheet>
	{/if}
</section>

<style>
	.preview-hidden {
		position: absolute;
		inset: 0;
		visibility: hidden;
	}
	.toolbar a {
		display: inline-flex;
		align-items: center;
		min-height: var(--app-control-height);
		border-radius: var(--app-control-radius);
		font-size: 12px;
		color: inherit;
		padding: 4px 9px;
		text-decoration: none;
	}
	.documents {
		position: relative;
		height: 100%;
		overflow: hidden;
		border-radius: inherit;
		background: var(--app-surface);
		color: var(--app-text);
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		font-size: 12px;
		container-type: inline-size;
	}
	.app-content {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.titlebar {
		display: flex;
		align-items: center;
		gap: 8px;
		height: var(--app-titlebar-height);
		flex: none;
		padding-right: 12px;
		background: var(--app-chrome);
		border-bottom: 1px solid var(--app-border);
	}
	.traffic-space {
		width: 77px;
		flex: none;
	}
	.document-title {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 2px;
	}
	.document-title strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		font-weight: 600;
	}
	.document-title span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11px;
		color: var(--app-text-secondary);
	}
	.app-name {
		margin-left: auto;
		padding-left: 12px;
		font-size: 11px;
		color: var(--app-text-tertiary);
	}
	.toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 2px;
		flex: none;
		padding: 4px 8px;
		border-bottom: 1px solid var(--app-border);
		background: var(--app-toolbar);
	}
	button,
	summary {
		min-height: var(--app-control-height);
		border: 0;
		border-radius: var(--app-control-radius);
		background: transparent;
		color: inherit;
		padding: 4px 9px;
		font: inherit;
		font-size: 12px;
		cursor: default;
	}
	button:hover:not(:disabled),
	summary:hover,
	.toolbar a:hover {
		background: var(--app-hover);
	}
	button[aria-pressed='true'] {
		background: var(--app-selection);
		color: var(--app-text);
	}
	button:disabled {
		opacity: 0.4;
	}
	button:focus-visible,
	summary:focus-visible,
	input:focus-visible,
	.toolbar a:focus-visible {
		outline: 2px solid var(--app-focus);
		outline-offset: 1px;
	}
	.divider {
		height: 17px;
		width: 1px;
		margin: 0 5px;
		background: var(--app-border);
	}
	.downloads {
		position: relative;
		margin-left: auto;
	}
	.downloads summary {
		list-style: none;
	}
	.downloads summary::-webkit-details-marker {
		display: none;
	}
	.downloads summary::after {
		content: '⌄';
		margin-left: 6px;
	}
	.download-menu {
		position: absolute;
		right: 0;
		top: calc(100% + 4px);
		z-index: 4;
		width: 216px;
		padding: 4px;
		border: 1px solid var(--app-control-border);
		border-radius: var(--app-control-radius);
		background: var(--app-surface);
		box-shadow: 0 5px 16px #0002;
	}
	.download-menu button {
		display: block;
		width: 100%;
		text-align: left;
	}
	.download-menu button:hover:not(:disabled) {
		background: var(--app-selection-strong);
		color: var(--app-selection-text);
	}
	.download-hint {
		margin: 4px 5px;
		padding-top: 7px;
		border-top: 1px solid var(--app-border);
		color: var(--app-text-secondary);
		font-size: 11px;
		line-height: 1.45;
	}
	.desktop-editing-notice {
		display: none;
	}
	.print-help {
		flex: none;
		padding: 7px 12px;
		font-size: 12px;
		line-height: 1.45;
		background: var(--app-info-bg);
		color: var(--app-info);
		border-bottom: 1px solid var(--app-border);
	}
	.office-surface {
		position: relative;
		flex: 1;
		min-height: 0;
	}
	iframe {
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
		background: var(--app-viewer);
	}
	.error-banner {
		flex: none;
		padding: 7px 12px;
		font-size: 12px;
		line-height: 1.45;
		background: var(--app-danger-bg);
		color: var(--app-danger);
		border-bottom: 1px solid var(--app-border);
	}
	.startup {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		gap: 11px;
		padding: 24px;
		background: var(--app-surface-secondary);
		text-align: center;
	}
	.startup strong {
		font-size: 14px;
		font-weight: 600;
		margin-top: 5px;
	}
	.startup p {
		max-width: 430px;
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--app-text-secondary);
	}
	.startup p[role='alert'] {
		color: var(--app-danger);
	}
	.startup .startup-detail {
		font-size: 11px;
		color: var(--app-text-tertiary);
	}
	.spinner {
		width: 18px;
		height: 18px;
		border: 2px solid var(--app-control-border);
		border-top-color: var(--app-accent);
		border-radius: 50%;
		animation: turn 0.85s linear infinite;
		margin-top: 3px;
	}
	@keyframes turn {
		to {
			transform: rotate(360deg);
		}
	}
	.file-input {
		display: none;
	}

	.hint {
		margin: 8px 0 0;
		font-size: 11px;
		color: var(--app-text-secondary);
	}
	.image-hint {
		margin: 0 0 15px;
		line-height: 1.5;
	}
	#image-description {
		margin-bottom: 12px;
	}
	.file-list {
		margin-top: 10px;
		max-height: 235px;
		overflow-y: auto;
		border: 1px solid var(--app-control-border);
		border-radius: var(--app-control-radius);
		background: var(--app-field);
	}
	.file-row {
		display: flex;
		justify-content: flex-start;
		align-items: center;
		gap: 9px;
		width: 100%;
		border-radius: 0;
		padding: 8px 10px;
		text-align: left;
	}
	.file-row svg {
		flex-shrink: 0;
		color: var(--app-accent);
	}
	.file-row + .file-row {
		border-top: 1px solid var(--app-border);
	}
	.file-row span {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 3px;
	}
	.file-row strong {
		font-size: 12px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.file-row small {
		font-size: 11px;
		color: var(--app-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.empty {
		padding: 24px 12px;
		margin: 0;
		color: var(--app-text-secondary);
		font-size: 12px;
		text-align: center;
	}
	.sheet-error {
		margin: 12px 0 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--app-danger);
	}

	.startup button.primary {
		color: var(--app-accent-text);
		background: var(--app-accent);
		border-color: var(--app-accent);
	}
	.startup button.primary:hover:not(:disabled) {
		background: var(--app-accent);
		filter: brightness(0.94);
	}
	@container (max-width: 500px) {
		.desktop-editing-notice {
			display: block;
			flex: none;
			margin: 0;
			padding: 6px 10px;
			font-size: 11px;
			line-height: 1.4;
			color: var(--app-text-secondary);
			border-bottom: 1px solid var(--app-border);
		}
		.app-name {
			display: none;
		}
		.toolbar {
			padding-inline: 5px;
		}
		.toolbar button,
		.toolbar summary {
			padding-inline: 6px;
			font-size: 11px;
		}
		.divider {
			margin-inline: 2px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}
</style>
