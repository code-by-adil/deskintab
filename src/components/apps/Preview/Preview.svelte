<script lang="ts">
	import WindowSheet from '🍎/components/SystemUI/WindowSheet.svelte';
	import { onMount, untrack } from 'svelte';
	import { apps } from '🍎/state/apps.svelte';
	import { subscribeToDesktopCommands } from '🍎/lib/desktop/commands';
	import { previewService, isPreviewPath } from '🍎/lib/preview/preview';
	import { workspaceBasename, workspaceDirname } from '🍎/lib/workspace/path';
	import { workspaceService } from '🍎/lib/workspace/workspace';

	type Match = { id: number; page: number; excerpt: string };
	let preview = $state.raw(previewService.snapshot());
	let working = $state(false);
	let error = $state('');
	let openDialog = $state(false);
	let dialogOpener = $state.raw<Element | null>(null);
	let paths = $state.raw<string[]>([]);
	let fileQuery = $state('');
	let zoom = $state(1);
	let textView = $state(false);
	let query = $state('');
	let searchedQuery = $state('');
	let searching = $state(false);
	let matches = $state.raw<Match[]>([]);
	let searched = $state(false);
	let scannedPages = $state(0);
	let nextPage = $state<number | null>(null);
	let limitedResults = $state(false);
	let resultId = 0;
	let searchGeneration = 0;
	let textContainer: HTMLElement | undefined;
	let searchInput: HTMLInputElement | undefined;
	let importInput: HTMLInputElement | undefined;
	let downloadLink: HTMLAnchorElement | undefined;
	const busy = $derived(working || preview.busy);
	const renderKey = $derived(preview.renderKey);
	const title = $derived(preview.path ? workspaceBasename(preview.path) : 'Preview');
	const status = $derived(
		busy
			? 'Opening…'
			: preview.kind === 'pdf'
				? `Page ${preview.page} of ${preview.pages}`
				: preview.kind === 'image'
					? `${preview.width} × ${preview.height}`
					: 'PDFs and images',
	);
	const visiblePaths = $derived(
		paths.filter(
			(path) => isPreviewPath(path) && path.toLowerCase().includes(fileQuery.trim().toLowerCase()),
		),
	);

	function clearSearch() {
		searchGeneration++;
		matches = [];
		searched = false;
		searchedQuery = '';
		scannedPages = 0;
		nextPage = null;
		limitedResults = false;
	}
	function refresh() {
		const next = previewService.snapshot();
		if (next.path !== preview.path || next.revision !== preview.revision) {
			clearSearch();
			zoom = 1;
			query = '';
			error = '';
		}
		preview = next;
	}
	function refreshFiles() {
		paths = workspaceService
			.getAllPaths()
			.filter((path) => !/^\/(Trash|System)\//.test(path))
			.sort((a, b) => a.localeCompare(b));
	}
	async function perform(action: () => Promise<unknown>, closeOnSuccess = false) {
		if (working) return;
		working = true;
		error = '';
		try {
			await action();
			if (closeOnSuccess) openDialog = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'This file could not be opened.';
		} finally {
			working = false;
		}
	}
	function showOpen() {
		if (busy) return;
		dialogOpener = document.activeElement;
		error = '';
		fileQuery = '';
		refreshFiles();
		openDialog = true;
	}
	function importFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!isPreviewPath(file.name)) {
			error = 'Choose a PDF, PNG, or JPEG file.';
			return;
		}
		const pdf = /\.pdf$/i.test(file.name);
		if (file.size > (pdf ? 50 : 10) * 1024 * 1024) {
			error = pdf
				? 'Choose a PDF no larger than 50 MiB.'
				: 'Choose an image no larger than 10 MiB.';
			return;
		}
		void perform(() => previewService.importFile(file), true);
	}
	function changePage(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const page = Number(input.value);
		if (!Number.isInteger(page) || page < 1 || page > preview.pages) {
			input.value = String(preview.page);
			return;
		}
		void perform(() => previewService.goToPage(page));
	}
	function changeZoom(amount: number) {
		zoom = Math.min(2, Math.max(0.5, Math.round((zoom + amount) * 100) / 100));
	}
	function renderPdf(canvas: HTMLCanvasElement) {
		void renderKey;
		const scale = zoom;
		return untrack(() => {
			const container = canvas.parentElement!;
			let cancel: (() => void) | undefined;
			let width = -1;
			function draw() {
				const nextWidth = Math.max(160, Math.round(container.clientWidth - 48));
				if (width === nextWidth) return;
				width = nextWidth;
				cancel?.();
				cancel = previewService.render(canvas, width, scale);
			}
			draw();
			const observer = new ResizeObserver(draw);
			observer.observe(container);
			return () => {
				observer.disconnect();
				cancel?.();
			};
		});
	}
	function sizeImage(image: HTMLImageElement) {
		void renderKey;
		const scale = zoom;
		return untrack(() => {
			const container = image.parentElement!;
			const { width, height } = preview;
			function resize() {
				if (!width || !height) return;
				const fit = Math.min(
					Math.max(1, container.clientWidth - 48) / width,
					Math.max(1, container.clientHeight - 48) / height,
					1,
				);
				image.style.width = `${Math.max(1, Math.round(width * fit * scale))}px`;
			}
			resize();
			const observer = new ResizeObserver(resize);
			observer.observe(container);
			return () => observer.disconnect();
		});
	}
	function attachText(node: HTMLElement) {
		textContainer = node;
		return () => {
			textContainer = undefined;
			previewService.setSelection('');
		};
	}
	function captureSelection() {
		const selection = document.getSelection();
		const withinText =
			!!textContainer &&
			!!selection &&
			!selection.isCollapsed &&
			textContainer.contains(selection.anchorNode) &&
			textContainer.contains(selection.focusNode);
		if (withinText) previewService.setSelection(selection!.toString());
		else if (preview.selection) previewService.setSelection('');
	}
	function attachSearch(node: HTMLInputElement) {
		searchInput = node;
		return () => {
			searchInput = undefined;
		};
	}
	function attachImport(node: HTMLInputElement) {
		importInput = node;
	}
	function attachDownload(node: HTMLAnchorElement) {
		downloadLink = node;
		return () => {
			downloadLink = undefined;
		};
	}
	async function search(append = false) {
		if (searching || busy || preview.kind !== 'pdf') return;
		const term = append ? searchedQuery : query.trim();
		if (!term) {
			clearSearch();
			return;
		}
		const path = preview.path;
		const revision = preview.revision;
		const startPage = append ? nextPage : 1;
		if (!startPage) return;
		searching = true;
		error = '';
		if (!append) clearSearch();
		const generation = searchGeneration;
		try {
			const result = await previewService.search(term, { startPage, maxPages: 20, limit: 40 });
			if (generation !== searchGeneration || preview.path !== path || preview.revision !== revision)
				return;
			matches = [
				...(append ? matches : []),
				...result.matches.map((match) => ({ ...match, id: ++resultId })),
			];
			searched = true;
			searchedQuery = term;
			scannedPages += result.scannedPages;
			nextPage = result.nextPage;
			limitedResults = limitedResults || result.truncated;
		} catch (cause) {
			if (generation === searchGeneration && preview.path === path && preview.revision === revision)
				error = cause instanceof Error ? cause.message : 'Search could not finish.';
		} finally {
			searching = false;
		}
	}
	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		void search();
	}
	function keyboard(event: KeyboardEvent) {
		if (apps.active !== 'preview' || !(event.metaKey || event.ctrlKey) || openDialog) return;
		if (event.key.toLowerCase() === 'f' && preview.kind === 'pdf') {
			event.preventDefault();
			searchInput?.focus();
			searchInput?.select();
		}
	}
	onMount(() => {
		refresh();
		refreshFiles();
		const unsubscribe = previewService.subscribe(refresh);
		const unsubscribeFiles = workspaceService.subscribe(refreshFiles);
		const unsubscribeCommands = subscribeToDesktopCommands(({ target, command }) => {
			if (target !== 'preview' || busy) return;
			if (command === 'open') showOpen();
			if (command === 'find') searchInput?.focus();
			if (command === 'download') downloadLink?.click();
		});
		void previewService.show().catch((cause) => {
			error = cause instanceof Error ? cause.message : 'The last file could not be opened.';
		});
		return () => {
			unsubscribe();
			unsubscribeFiles();
			unsubscribeCommands();
			previewService.detachView();
		};
	});
</script>

<svelte:window onkeydown={keyboard} />
<svelte:document onselectionchange={captureSelection} />

<section class="preview" aria-label="Preview">
	<div class="app-content" inert={openDialog}>
		<header class="titlebar app-window-drag-handle">
			<div class="traffic-space" aria-hidden="true"></div>
			<img src="/app-icons/preview.svg" width="22" height="22" alt="" />
			<div class="file-title">
				<strong title={preview.path || 'Preview'}>{title}</strong><span role="status">{status}</span
				>
			</div>
			<span class="app-name">Preview</span>
		</header>
		<nav class="toolbar" aria-label="Preview actions">
			<button disabled={busy} onclick={showOpen}>Open…</button>
			{#if preview.kind === 'pdf'}
				<span class="divider" aria-hidden="true"></span>
				<button
					aria-label="Previous page"
					disabled={busy || preview.page <= 1}
					onclick={() => perform(() => previewService.goToPage(preview.page - 1))}>‹</button
				>
				<label class="page-control"
					>Page <input
						type="number"
						min="1"
						max={preview.pages}
						value={preview.page}
						aria-label="Page number"
						onchange={changePage}
						disabled={busy}
					/><span>of {preview.pages}</span></label
				>
				<button
					aria-label="Next page"
					disabled={busy || preview.page >= preview.pages}
					onclick={() => perform(() => previewService.goToPage(preview.page + 1))}>›</button
				>
			{/if}
			{#if preview.path}
				<span class="divider" aria-hidden="true"></span>
				<button
					aria-label="Zoom out"
					disabled={zoom <= 0.5 || (textView && preview.kind === 'pdf')}
					onclick={() => changeZoom(-0.25)}>−</button
				>
				<button
					title="Fit to window"
					disabled={textView && preview.kind === 'pdf'}
					onclick={() => (zoom = 1)}>{zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}</button
				>
				<button
					aria-label="Zoom in"
					disabled={zoom >= 2 || (textView && preview.kind === 'pdf')}
					onclick={() => changeZoom(0.25)}>+</button
				>
				{#if preview.kind === 'pdf'}<button
						aria-pressed={textView}
						onclick={() => (textView = !textView)}>Text</button
					>{/if}
			{/if}
			{#if preview.url && preview.path}<a
					class="download"
					href={preview.url}
					download={workspaceBasename(preview.path)}
					{@attach attachDownload}>Download</a
				>{/if}
		</nav>
		{#if preview.kind === 'pdf'}
			<form class="searchbar" role="search" aria-label="Search this PDF" onsubmit={submitSearch}>
				<input
					type="search"
					aria-label="Find in PDF"
					maxlength="500"
					placeholder="Find in this PDF"
					bind:value={query}
					disabled={busy || searching}
					{@attach attachSearch}
				/>
				<button type="submit" disabled={busy || searching || !query.trim()}
					>{searching ? 'Searching…' : 'Find'}</button
				>
				{#if searched}<button type="button" onclick={clearSearch} aria-label="Close search results"
						>Done</button
					>{/if}
			</form>
		{/if}
		{#if error || preview.error}<div class="error-banner" role="alert">
				<span>{error || preview.error}</span><button disabled={busy} onclick={showOpen}
					>Open…</button
				>
			</div>{/if}
		<div class="viewer-layout" aria-busy={busy}>
			{#if searched}
				<aside class="search-results" aria-label="PDF search results">
					<p class="search-summary" role="status">
						{matches.length}
						{matches.length === 1 ? 'match' : 'matches'} for "{searchedQuery}"<small
							>{scannedPages} {scannedPages === 1 ? 'page' : 'pages'} searched</small
						>
					</p>
					{#each matches as match (match.id)}<button
							class="result"
							disabled={busy}
							onclick={() => perform(() => previewService.goToPage(match.page))}
							><strong>Page {match.page}</strong><span>{match.excerpt}</span></button
						>{/each}
					{#if limitedResults}<p class="hint search-hint">
							Search checks up to 20 pages at a time. Open a result to read it on the page.
						</p>{/if}
					{#if nextPage}<button
							class="more-results"
							disabled={busy || searching}
							onclick={() => search(true)}>{searching ? 'Searching…' : 'Search next pages'}</button
						>{/if}
				</aside>
			{/if}
			{#if preview.kind === 'pdf' && preview.url}
				{#if textView}
					<div class="text-scroll">
						<header>
							<strong>Page {preview.page} text</strong><span
								>Select a passage to share its page context with your agent.</span
							>
						</header>
						{#if preview.text}<pre {@attach attachText}>{preview.text}</pre>{:else}<p
								class="text-empty"
							>
								No readable text was found on this page. It may be a scanned image; Preview does not
								perform OCR.
							</p>{/if}
						{#if preview.textTruncated}<p class="hint">
								The extracted text is too long to show in full. Read the remaining text on the PDF
								page.
							</p>{/if}
					</div>
				{:else}
					<div class="page-scroll">
						<canvas
							aria-label={`PDF page ${preview.page} of ${preview.pages}. Use Text for readable page text.`}
							{@attach renderPdf}
						></canvas>
					</div>
				{/if}
			{:else if preview.kind === 'image' && preview.url}
				<div class="image-scroll">
					<img src={preview.url} alt={title} draggable="false" {@attach sizeImage} />
				</div>
			{:else}
				<div class="empty-state">
					<img src="/app-icons/preview.svg" width="56" height="56" alt="" /><strong
						>{busy ? 'Opening Preview…' : 'No file open'}</strong
					>
					<p>View PDFs and images from your workspace.</p>
					<button class="primary" disabled={busy} onclick={showOpen}>Open File…</button>
				</div>
			{/if}
		</div>
	</div>
	<input
		class="file-input"
		type="file"
		accept=".pdf,.png,.jpg,.jpeg"
		aria-label="Import PDF or image"
		disabled={busy}
		onchange={importFile}
		{@attach attachImport}
	/>
	{#if openDialog}
		<WindowSheet
			labelledby="preview-open-title"
			{busy}
			returnFocus={dialogOpener}
			onclose={() => (openDialog = false)}
		>
			<h2 id="preview-open-title">Open a PDF or image</h2>
			<div class="sheet-body">
				<input
					type="search"
					aria-label="Search workspace PDFs and images"
					placeholder="Search workspace files"
					bind:value={fileQuery}
					disabled={busy}
				/>
				<div class="file-list">
					{#each visiblePaths as path (path)}<button
							class="file-row"
							disabled={busy}
							onclick={() => perform(() => previewService.open(path), true)}
							><img src="/app-icons/preview.svg" width="28" height="28" alt="" /><span
								><strong>{workspaceBasename(path)}</strong><small>{workspaceDirname(path)}</small
								></span
							></button
						>{:else}<p class="empty-files">
							{fileQuery
								? 'No matching files.'
								: 'No PDFs or images here yet. Import one from your computer.'}
						</p>{/each}
				</div>
				<p class="hint">PDFs up to 50 MiB. PNG and JPEG images up to 10 MiB.</p>
				{#if error}<p class="sheet-error" role="alert">{error}</p>{/if}
			</div>
			<footer>
				<button disabled={busy} onclick={() => (openDialog = false)}>Cancel</button><button
					class="primary"
					disabled={busy}
					onclick={() => importInput?.click()}>Import from Computer…</button
				>
			</footer>
		</WindowSheet>
	{/if}
</section>

<style>
	.preview {
		height: 100%;
		position: relative;
		border-radius: inherit;
		overflow: hidden;
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
	.file-title {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 2px;
	}
	.file-title strong {
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.file-title span {
		font-size: 11px;
		color: var(--app-text-secondary);
	}
	.app-name {
		margin-left: auto;
		font-size: 11px;
		color: var(--app-text-tertiary);
	}
	.toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 2px;
		padding: 5px 8px;
		flex: none;
		background: var(--app-toolbar);
		border-bottom: 1px solid var(--app-border);
	}
	button,
	.download {
		font: inherit;
		font-size: 12px;
		color: inherit;
		min-height: var(--app-control-height);
		box-sizing: border-box;
		padding: 4px 9px;
		border: 0;
		border-radius: var(--app-control-radius);
		background: transparent;
		cursor: default;
		text-decoration: none;
	}
	button:hover:not(:disabled),
	.download:hover {
		background: var(--app-hover);
	}
	button[aria-pressed='true'],
	button[aria-pressed='true']:hover:not(:disabled) {
		background: var(--app-selection);
		box-shadow: inset 0 0 0 1px var(--app-control-border);
	}
	button:disabled {
		opacity: 0.4;
	}
	button:focus-visible,
	a:focus-visible,
	input:focus-visible {
		outline: 2px solid var(--app-focus);
		outline-offset: 1px;
	}
	.divider {
		height: 17px;
		width: 1px;
		margin: 0 5px;
		background: var(--app-border);
	}
	.page-control {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		white-space: nowrap;
	}
	.page-control input {
		width: 48px;
		min-height: var(--app-control-height);
		box-sizing: border-box;
		border: 1px solid var(--app-control-border);
		border-radius: var(--app-control-radius);
		background: var(--app-field);
		padding: 3px 4px;
		color: inherit;
		font: inherit;
	}
	.download {
		display: inline-flex;
		align-items: center;
		margin-left: auto;
	}
	.searchbar {
		display: flex;
		gap: 5px;
		padding: 6px 10px;
		flex: none;
		border-bottom: 1px solid var(--app-border);
		background: var(--app-toolbar);
	}
	.searchbar input {
		flex: 1;
		min-width: 0;
		min-height: var(--app-control-height);
		box-sizing: border-box;
		border: 1px solid var(--app-control-border);
		border-radius: var(--app-control-radius);
		padding: 5px 8px;
		background: var(--app-field);
		color: inherit;
		font: inherit;
		font-size: 12px;
	}
	input::placeholder {
		color: var(--app-text-tertiary);
		opacity: 1;
	}
	.error-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 12px;
		flex: none;
		font-size: 12px;
		line-height: 1.45;
		background: var(--app-danger-bg);
		color: var(--app-danger);
		border-bottom: 1px solid var(--app-border);
	}
	.error-banner span {
		flex: 1;
	}
	.viewer-layout {
		flex: 1;
		min-height: 0;
		display: flex;
		overflow: hidden;
		background: var(--app-viewer);
	}
	.search-results {
		width: 218px;
		flex: none;
		overflow: auto;
		background: var(--app-sidebar);
		border-right: 1px solid var(--app-border);
	}
	.search-summary {
		padding: 12px;
		margin: 0;
		border-bottom: 1px solid var(--app-border);
		font-size: 12px;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.search-summary small {
		display: block;
		margin-top: 4px;
		font-size: 11px;
		color: var(--app-text-secondary);
	}
	.result {
		display: flex;
		flex-direction: column;
		text-align: left;
		gap: 4px;
		padding: 9px 12px;
		width: 100%;
		border-bottom: 1px solid var(--app-border);
		border-radius: 0;
	}
	.result strong {
		font-size: 12px;
		font-weight: 600;
	}
	.result span {
		font-size: 12px;
		line-height: 1.5;
		color: var(--app-text-secondary);
		overflow-wrap: anywhere;
	}
	.more-results {
		display: block;
		margin: 10px auto;
		border: 1px solid var(--app-control-border);
		background: var(--app-control);
	}
	.search-hint {
		padding: 0 12px;
	}
	.page-scroll,
	.image-scroll {
		flex: 1;
		min-width: 0;
		min-height: 0;
		overflow: auto;
		box-sizing: border-box;
	}
	.page-scroll {
		padding: 24px;
	}
	canvas {
		display: block;
		margin: 0 auto;
		background: #fff;
		box-shadow: 0 1px 6px #0003;
	}
	.image-scroll {
		display: flex;
		padding: 24px;
	}
	.image-scroll img {
		flex: none;
		align-self: flex-start;
		height: auto;
		margin: auto;
		display: block;
		background: #fff;
		box-shadow: 0 1px 6px #0002;
	}
	.text-scroll {
		flex: 1;
		min-width: 0;
		overflow: auto;
		padding: 22px 26px;
		background: #fff;
		color: #303034;
	}
	.text-scroll header {
		display: flex;
		flex-direction: column;
		gap: 6px;
		border-bottom: 1px solid #e2e2e7;
		padding-bottom: 14px;
	}
	.text-scroll header strong {
		font-size: 13px;
	}
	.text-scroll header span {
		font-size: 12px;
		color: #727279;
		line-height: 1.5;
	}
	.text-scroll pre {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
		font: inherit;
		font-size: 13px;
		line-height: 1.8;
		cursor: text;
	}
	.text-empty {
		font-size: 12px;
		line-height: 1.6;
		color: #63636b;
	}
	.text-scroll .hint {
		color: #63636b;
	}
	.empty-state {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		padding: 24px;
		gap: 12px;
		background: var(--app-surface-secondary);
		text-align: center;
	}
	.empty-state strong {
		font-size: 15px;
		font-weight: 600;
	}
	.empty-state p {
		font-size: 12px;
		color: var(--app-text-secondary);
		margin: 0;
	}
	.file-input {
		display: none;
	}

	.file-list {
		margin-top: 10px;
		max-height: 235px;
		overflow-y: auto;
		border: 1px solid var(--app-border);
		border-radius: var(--app-control-radius);
		background: var(--app-field);
	}
	.file-row {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		border-radius: 0;
		padding: 8px 10px;
		text-align: left;
	}
	.file-row + .file-row {
		border-top: 1px solid var(--app-border);
	}
	.result:focus-visible,
	.file-row:focus-visible {
		outline-offset: -2px;
	}
	.file-row img {
		flex: none;
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
	.empty-files {
		padding: 24px 12px;
		margin: 0;
		color: var(--app-text-secondary);
		font-size: 12px;
		text-align: center;
	}
	.hint {
		margin: 8px 0 0;
		font-size: 12px;
		line-height: 1.45;
		color: var(--app-text-secondary);
	}
	.sheet-error {
		margin: 12px 0 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--app-danger);
	}

	.empty-state button.primary {
		color: var(--app-accent-text);
		background: var(--app-accent);
		border-color: var(--app-accent);
	}
	.empty-state button.primary:hover:not(:disabled) {
		filter: brightness(0.94);
	}
	@container (max-width: 560px) {
		.app-name {
			display: none;
		}
		.toolbar {
			padding-inline: 5px;
		}
		.toolbar button,
		.download {
			padding-inline: 6px;
			font-size: 12px;
		}
		.divider {
			margin-inline: 2px;
		}
		.viewer-layout {
			flex-direction: column;
		}
		.search-results {
			width: auto;
			max-height: 150px;
			border-right: 0;
			border-bottom: 1px solid var(--app-border);
		}

		.text-scroll {
			padding: 16px;
		}
	}
</style>
