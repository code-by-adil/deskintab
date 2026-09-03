<script lang="ts">
	import WindowSheet from '🍎/components/SystemUI/WindowSheet.svelte';
	import { onMount, untrack } from 'svelte';
	import { apps } from '🍎/state/apps.svelte';
	import { issueDesktopCommand, subscribeToDesktopCommands } from '🍎/lib/desktop/commands';
	import { isSheetPath, officeFrameUrl, sheetsService } from '🍎/lib/office/office';
	import { workspaceBasename, workspaceDirname } from '🍎/lib/workspace/path';
	import { workspaceService } from '🍎/lib/workspace/workspace';

	type Dialog = 'open' | 'save-as' | 'export' | 'chart' | 'export-chart' | null;
	let office = $state.raw(sheetsService.snapshot());
	let dialog = $state<Dialog>(null);
	let paths = $state.raw<string[]>([]);
	let query = $state('');
	let destination = $state('');
	let error = $state('');
	let notice = $state('');
	let working = $state(false);
	let downloads: HTMLDetailsElement | undefined;
	let importInput: HTMLInputElement;
	let dialogSourcePath: string | null = null;
	let dialogOpener = $state.raw<Element | null>(null);
	let chartTarget: { path: string; revision: number } | undefined;
	let sheetNames = $state.raw<string[]>([]);
	let chartNames = $state.raw<string[]>([]);
	let chartSheet = $state('');
	let chartRange = $state('');
	let chartName = $state('');
	let chartTitle = $state('');

	const title = $derived(office.path ? workspaceBasename(office.path) : 'Sheets');
	const busy = $derived(working || office.busy);
	const canEdit = $derived(!busy && office.status === 'ready');
	const visiblePaths = $derived(
		paths.filter(
			(path) => isSheetPath(path) && path.toLowerCase().includes(query.trim().toLowerCase()),
		),
	);
	const status = $derived(
		office.message || (busy ? 'Working…' : office.dirty ? 'Edited' : office.path ? 'Saved' : ''),
	);
	const dialogTitle = $derived(
		dialog === 'open'
			? 'Open a spreadsheet'
			: dialog === 'save-as'
				? 'Save spreadsheet as'
				: dialog === 'chart'
					? 'Create a column chart'
					: dialog === 'export-chart'
						? 'Export chart as PNG'
						: 'Export spreadsheet',
	);

	function attachEditor(node: HTMLIFrameElement) {
		return untrack(() => sheetsService.attach(node));
	}
	function attachDownloads(node: HTMLDetailsElement) {
		downloads = node;
		return () => {
			downloads = undefined;
		};
	}
	function attachImportInput(node: HTMLInputElement) {
		importInput = node;
	}
	function refresh() {
		office = sheetsService.snapshot();
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
		notice = '';
		working = true;
		if (downloads) downloads.open = false;
		try {
			await action();
			if (closeOnSuccess) dialog = null;
		} catch (cause) {
			error =
				cause instanceof Error ? cause.message : 'The spreadsheet action could not be completed.';
		} finally {
			working = false;
		}
	}
	function chartFilename(name: string) {
		return `${workspaceDirname(chartTarget?.path || '/Documents/Untitled.ods')}/${name.replace(/[\\/]/g, '-') || 'Chart'}.png`;
	}
	function showDialog(next: Exclude<Dialog, null>) {
		if (busy) return;
		dialogOpener = document.activeElement;
		error = '';
		notice = '';
		if (downloads) downloads.open = false;
		dialogSourcePath = office.path;
		if (next === 'chart' || next === 'export-chart') {
			const path = office.path;
			if (!path || !canEdit) return;
			void perform(async () => {
				const workbook = await sheetsService.readWorkbook(path);
				if (office.path !== path)
					throw new Error('The open workbook changed. Reopen this dialog to continue.');
				chartTarget = { path: workbook.path, revision: workbook.revision };
				sheetNames = workbook.sheets;
				chartSheet = workbook.selection?.sheet || workbook.sheet;
				chartRange = workbook.selection?.range || workbook.range;
				chartNames = workbook.charts.map((chart: { name: string }) => chart.name);
				if (next === 'chart') {
					let suffix = 1;
					while (chartNames.includes(`Chart ${suffix}`)) suffix++;
					chartName = `Chart ${suffix}`;
					chartTitle = '';
				} else {
					chartName = chartNames[0] || '';
					destination = chartFilename(chartName);
				}
				dialog = next;
			});
			return;
		}
		if (next === 'open') {
			query = '';
			refreshFiles();
		} else {
			const source = office.path || '/Documents/Untitled.ods';
			const stem = workspaceBasename(source).replace(/\.[^.]+$/, '');
			destination = `${workspaceDirname(source)}/${stem}${next === 'save-as' ? ' copy.ods' : '.pdf'}`;
		}
		dialog = next;
	}
	function checkDialogSource() {
		if (office.path === dialogSourcePath) return true;
		error = 'The open workbook changed. Cancel and reopen this dialog for the current workbook.';
		return false;
	}
	function changeChartSheet(event: Event) {
		const sheet = (event.currentTarget as HTMLSelectElement).value;
		chartSheet = sheet;
		if (dialog !== 'export-chart' || !chartTarget) return;
		if (!checkDialogSource()) return;
		const path = chartTarget.path;
		void perform(async () => {
			const workbook = await sheetsService.readWorkbook(path, { sheet });
			chartNames = workbook.charts.map((chart: { name: string }) => chart.name);
			chartName = chartNames[0] || '';
			destination = chartFilename(chartName);
		});
	}
	function changeExportChart(event: Event) {
		chartName = (event.currentTarget as HTMLSelectElement).value;
		destination = chartFilename(chartName);
	}
	function submitPath(event: SubmitEvent) {
		event.preventDefault();
		if (!checkDialogSource()) return;
		const path = destination.trim();
		if (!path.startsWith('/') || path.endsWith('/')) {
			error = 'Enter a workspace file path, such as /Documents/Budget.ods.';
			return;
		}
		const allowed =
			dialog === 'export-chart'
				? /\.png$/i
				: dialog === 'save-as'
					? /\.(ods|xlsx)$/i
					: /\.(pdf|ods|xlsx)$/i;
		if (!allowed.test(path)) {
			error =
				dialog === 'export-chart'
					? 'Use a .png filename.'
					: dialog === 'save-as'
						? 'Use an .ods or .xlsx filename.'
						: 'Use a .pdf, .ods, or .xlsx filename.';
			return;
		}
		const target = chartTarget;
		const action = dialog;
		const source = dialogSourcePath ?? undefined;
		if (action === 'export-chart' && (!target || !chartName)) return;
		void perform(async () => {
			if (action === 'export-chart' && target)
				await sheetsService.exportChart(target.path, chartSheet, chartName, path, 'human');
			else if (action === 'save-as') await sheetsService.saveAs(path, source);
			else await sheetsService.exportDocument(path, { expectedSourcePath: source });
			notice = `Saved to ${path}`;
		}, true);
	}
	function submitChart(event: SubmitEvent) {
		event.preventDefault();
		if (!checkDialogSource()) return;
		const target = chartTarget;
		if (!target) return;
		if (!chartName.trim() || !chartRange.trim()) {
			error = 'Enter a chart name and a range, such as A1:B6.';
			return;
		}
		void perform(
			() =>
				sheetsService.chartWorkbook(
					target.path,
					target.revision,
					{
						sheet: chartSheet,
						range: chartRange.trim(),
						name: chartName.trim(),
						title: chartTitle.trim() || undefined,
					},
					'human',
				),
			true,
		);
	}
	function importSpreadsheet(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!isSheetPath(file.name)) {
			error = 'Choose an .ods or .xlsx spreadsheet.';
			return;
		}
		if (file.size > 50 * 1024 * 1024) {
			error = 'Choose a spreadsheet smaller than 50 MiB.';
			return;
		}
		void perform(() => sheetsService.importFile(file), true);
	}
	function handleOfficeAction(action: string) {
		if (action === 'close') issueDesktopCommand('sheets', 'close');
		if (busy) return;
		if (action === 'open' || action === 'save-as' || action === 'export') showDialog(action);
		if (action === 'new') void perform(() => sheetsService.newDocument());
		if (action === 'print-help') showPrintHelp();
	}
	function showPrintHelp() {
		if (busy || dialog || !downloads) return;
		downloads.open = true;
		downloads.querySelector<HTMLButtonElement>('button[data-format="pdf"]')?.focus();
	}
	function printShortcut(event: KeyboardEvent) {
		if (
			apps.active !== 'sheets' ||
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
		const unsubscribeOffice = sheetsService.subscribe(refresh);
		const unsubscribeFiles = workspaceService.subscribe(refreshFiles);
		const unsubscribeActions = sheetsService.onAction(handleOfficeAction);
		const unsubscribeCommands = subscribeToDesktopCommands(({ target, command }) => {
			if (target !== 'sheets' || busy) return;
			if (command === 'new-document') void perform(() => sheetsService.newDocument());
			if (command === 'open') showDialog('open');
			if (command === 'save') void perform(() => sheetsService.save());
		});
		void sheetsService.show().catch(() => {});
		return () => {
			unsubscribeOffice();
			unsubscribeFiles();
			unsubscribeActions();
			unsubscribeCommands();
			sheetsService.detachView();
		};
	});
</script>

<svelte:window onkeydown={printShortcut} />

<section class="sheets" aria-label="Sheets">
	<div class="app-content" inert={dialog !== null}>
		<header class="titlebar app-window-drag-handle">
			<div class="traffic-space" aria-hidden="true"></div>
			<img class="sheet-icon" src="/app-icons/sheets.svg" alt="" width="22" height="22" />
			<div class="workbook-title">
				<strong title={office.path || 'Sheets'}>{title}</strong>
				<span role="status" title={status}>{status}</span>
			</div>
			<span class="app-name">Sheets</span>
		</header>
		<nav class="toolbar" aria-label="Spreadsheet actions">
			<button
				disabled={busy || office.status === 'loading'}
				onclick={() => perform(() => sheetsService.newDocument())}>New</button
			>
			<button disabled={busy} onclick={() => showDialog('open')}>Open…</button>
			<span class="divider" aria-hidden="true"></span>
			<button
				disabled={!canEdit || !office.path}
				onclick={() => perform(() => sheetsService.save())}>Save</button
			>
			<button disabled={!canEdit} onclick={() => showDialog('save-as')}>Save As…</button>
			<button disabled={!canEdit} onclick={() => showDialog('export')}>Export…</button>
			<span class="divider" aria-hidden="true"></span>
			<button disabled={!canEdit || !office.path} onclick={() => showDialog('chart')}>Chart…</button
			>
			<details class="downloads" {@attach attachDownloads}>
				<summary>Download</summary>
				<div class="download-menu">
					{#each [{ format: 'ods', label: 'OpenDocument (.ods)' }, { format: 'xlsx', label: 'Excel (.xlsx)' }, { format: 'pdf', label: 'PDF (.pdf)' }] as item (item.format)}
						<button
							data-format={item.format}
							disabled={!canEdit}
							onclick={() =>
								perform(() => sheetsService.download(item.format as 'ods' | 'xlsx' | 'pdf'))}
							>{item.label}</button
						>
					{/each}
					<button
						class="export-chart-action"
						disabled={!canEdit || !office.path}
						onclick={() => showDialog('export-chart')}>Export Chart to Files…</button
					>
					<p class="download-hint">To print, download a PDF and open it in your PDF viewer.</p>
				</div>
			</details>
		</nav>
		<p class="desktop-editing-notice">
			For full editing, use a desktop. You can still view and download spreadsheets here.
		</p>
		{#if error || (office.message && office.status === 'ready')}
			<div class="error-banner" role="alert">{error || office.message}</div>
		{:else if notice}
			<div class="notice" role="status">{notice}</div>
		{/if}
		<div class="office-surface" aria-busy={busy || office.status === 'loading'}>
			{#if office.engineRequested}
				{#key office.engineSession}
					<iframe
						title="Spreadsheet editor"
						src={`${officeFrameUrl}&app=sheets`}
						allow="clipboard-read; clipboard-write"
						inert={busy}
						{@attach attachEditor}
					></iframe>
				{/key}
			{/if}
			{#if office.status !== 'ready'}
				<div class="startup">
					<img class="sheet-icon" src="/app-icons/sheets.svg" alt="" width="58" height="58" />
					{#if office.status === 'error'}
						<strong>Sheets could not start</strong>
						<p role="alert">{error || office.message}</p>
						<button
							class="primary"
							disabled={busy}
							onclick={() => perform(() => sheetsService.retry())}>Try Again</button
						>
					{:else}
						<strong>Opening Sheets</strong>
						<p role="status">{office.message || 'Loading the spreadsheet editor…'}</p>
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
		accept=".ods,.xlsx"
		aria-label="Import spreadsheet"
		disabled={busy}
		{@attach attachImportInput}
		onchange={importSpreadsheet}
	/>
	{#if dialog}
		<WindowSheet
			labelledby="spreadsheet-dialog-title"
			{busy}
			returnFocus={dialogOpener}
			onclose={() => (dialog = null)}
		>
			<h2 id="spreadsheet-dialog-title">{dialogTitle}</h2>
			{#if dialog === 'open'}
				<div class="sheet-body">
					<input
						type="search"
						aria-label="Search workspace spreadsheets"
						placeholder="Search workspace spreadsheets"
						bind:value={query}
						disabled={busy}
					/>
					<div class="file-list">
						{#each visiblePaths as path (path)}
							<button
								class="file-row"
								disabled={busy}
								onclick={() => perform(() => sheetsService.open(path), true)}
							>
								<img class="sheet-icon" src="/app-icons/sheets.svg" alt="" width="28" height="28" />
								<span
									><strong>{workspaceBasename(path)}</strong><small>{workspaceDirname(path)}</small
									></span
								>
							</button>
						{:else}
							<p class="empty">
								{query
									? 'No matching spreadsheets.'
									: 'No spreadsheets in this workspace yet. Import one or create a new workbook.'}
							</p>
						{/each}
					</div>
					<p class="hint">Open an .ods or .xlsx file, up to 50 MiB.</p>
					{#if error}<p class="sheet-error" role="alert">{error}</p>{/if}
				</div>
				<footer>
					<button disabled={busy} onclick={() => (dialog = null)}>Cancel</button>
					<button class="primary" disabled={busy} onclick={() => importInput.click()}
						>Import from Computer…</button
					>
				</footer>
			{:else if dialog === 'chart'}
				<form onsubmit={submitChart}>
					<div class="sheet-body field-stack">
						<p class="hint intro">
							Create an editable chart linked to your cells. The first row supplies series names;
							the first column supplies labels.
						</p>
						<label
							>Sheet<select value={chartSheet} onchange={changeChartSheet} disabled={busy}
								>{#each sheetNames as name (name)}<option value={name}>{name}</option
									>{/each}</select
							></label
						>
						<label
							>Data range<input
								bind:value={chartRange}
								placeholder="A1:B6"
								spellcheck="false"
								disabled={busy}
								required
							/></label
						>
						<label
							>Chart name<input
								bind:value={chartName}
								maxlength="100"
								disabled={busy}
								required
							/></label
						>
						<label
							>Title (optional)<input
								bind:value={chartTitle}
								maxlength="200"
								placeholder="For example, Monthly budget"
								disabled={busy}
							/></label
						>
						<p class="hint">
							Includes the selected range. Change the cell values later and the chart recalculates
							with them.
						</p>
						{#if error}<p class="sheet-error" role="alert">{error}</p>{/if}
					</div>
					<footer>
						<button type="button" disabled={busy} onclick={() => (dialog = null)}>Cancel</button
						><button class="primary" type="submit" disabled={busy}
							>{busy ? 'Working…' : 'Create Chart'}</button
						>
					</footer>
				</form>
			{:else}
				<form onsubmit={submitPath}>
					<div class="sheet-body field-stack">
						{#if dialog === 'export-chart'}
							<label
								>Sheet<select value={chartSheet} onchange={changeChartSheet} disabled={busy}
									>{#each sheetNames as name (name)}<option value={name}>{name}</option
										>{/each}</select
								></label
							>
							<label
								>Chart<select
									value={chartName}
									onchange={changeExportChart}
									disabled={busy || !chartNames.length}
									>{#each chartNames as name (name)}<option value={name}>{name}</option
										>{/each}</select
								></label
							>
							{#if !chartNames.length}<p class="hint">
									This sheet has no charts. Choose another sheet, or cancel and use Chart… to create
									one.
								</p>{/if}
						{/if}
						<label
							>Workspace path<input
								bind:value={destination}
								disabled={busy}
								spellcheck="false"
								required
							/></label
						>
						<p class="hint">
							{dialog === 'export-chart'
								? 'Save a PNG image in Files. You can insert it into a document; the editable chart stays in this workbook.'
								: dialog === 'save-as'
									? 'Save an editable copy as .ods or .xlsx.'
									: 'Export a .pdf, .ods, or .xlsx file to Files. For printing, choose PDF, then download it and open it in your PDF viewer.'}
						</p>
						{#if error}<p class="sheet-error" role="alert">{error}</p>{/if}
					</div>
					<footer>
						<button type="button" disabled={busy} onclick={() => (dialog = null)}>Cancel</button
						><button
							class="primary"
							type="submit"
							disabled={busy || (dialog === 'export-chart' && !chartName)}
							>{busy ? 'Working…' : dialog === 'save-as' ? 'Save' : 'Export'}</button
						>
					</footer>
				</form>
			{/if}
		</WindowSheet>
	{/if}
</section>

<style>
	.sheets {
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
	.sheet-icon {
		display: inline-flex;
		flex: none;
		color: var(--app-success);
	}
	.workbook-title {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 2px;
	}
	.workbook-title strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		font-weight: 600;
	}
	.workbook-title span {
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
	summary:hover {
		background: var(--app-hover);
	}
	button:disabled {
		opacity: 0.4;
	}
	button:focus-visible,
	summary:focus-visible,
	input:focus-visible,
	select:focus-visible {
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
	.download-menu .export-chart-action {
		margin-top: 4px;
		border-top: 1px solid var(--app-border);
		border-radius: 0;
		padding-top: 9px;
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
	.error-banner,
	.notice {
		flex: none;
		padding: 7px 12px;
		font-size: 12px;
		line-height: 1.45;
	}
	.error-banner {
		background: var(--app-danger-bg);
		color: var(--app-danger);
		border-bottom: 1px solid var(--app-border);
	}
	.notice {
		background: var(--app-surface-secondary);
		color: var(--app-success);
		border-bottom: 1px solid var(--app-border);
		overflow-wrap: anywhere;
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
		border-top-color: var(--app-success);
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

	.field-stack > label + label {
		margin-top: 12px;
	}
	.hint {
		margin: 8px 0 0;
		font-size: 11px;
		line-height: 1.45;
		color: var(--app-text-secondary);
	}
	.intro {
		margin: 0 0 15px;
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
	.file-row + .file-row {
		border-top: 1px solid var(--app-border);
	}
	.file-row > span:not(.sheet-icon) {
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
