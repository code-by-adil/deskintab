<script lang="ts">
	import { onMount } from 'svelte';
	import WindowSheet from '🍎/components/SystemUI/WindowSheet.svelte';
	import { AppError } from '🍎/lib/errors';
	import { revealDesktop } from '🍎/lib/desktop/files';
	import { subscribeToDesktopCommands } from '🍎/lib/desktop/commands';
	import { workspaceService } from '🍎/lib/workspace/workspace';
	import {
		studioDocument,
		studioService,
		type StudioInput,
		type StudioList,
		type StudioPreview,
		type StudioRecord,
	} from '🍎/lib/studio/studio';
	import { studioSourceRequest } from '🍎/lib/studio/renderer';

	type Draft = Omit<StudioInput, 'columns' | 'sourcePaths'> & {
		path: string;
		columns: string;
		sourcePaths: string;
		isNew: boolean;
	};
	let record = $state.raw(studioDocument.snapshot());
	let listing = $state.raw<StudioList>({ apps: [], warnings: [], truncated: false });
	let details = $state.raw<StudioRecord | null>(null);
	let preview = $state.raw<StudioPreview | null>(null);
	let iframe = $state.raw<HTMLIFrameElement>();
	let draft = $state<Draft | null>(null);
	let draftBase = $state('');
	let draftPath = $state('');
	let draftRevision = $state('');
	let opener = $state.raw<Element | null>(null);
	let working = $state(false);
	let loadingPreview = $state(false);
	let error = $state('');
	let showFiles = $state(false);
	let alive = true;
	let previewGeneration = 0;
	let listGeneration = 0;
	let detailsGeneration = 0;
	const dirty = $derived(draft !== null && JSON.stringify(draft) !== draftBase);
	const staleDraft = $derived(
		draft !== null &&
			!draft.isNew &&
			(record.path !== draftPath || record.revision !== draftRevision),
	);
	const dataChanged = $derived(
		preview !== null &&
			details !== null &&
			preview.path === details.path &&
			preview.dataRevision !== details.dataFile.revision,
	);
	const busy = $derived(working || record.loading);

	async function refreshList() {
		const turn = ++listGeneration;
		try {
			const next = await studioService.list();
			if (alive && turn === listGeneration) listing = next;
		} catch (cause) {
			if (alive && turn === listGeneration) error = message(cause);
		}
	}
	async function refreshDetails() {
		const path = record.path;
		const turn = ++detailsGeneration;
		if (!path) {
			details = null;
			return;
		}
		try {
			const next = await studioService.read(path);
			if (alive && turn === detailsGeneration && record.path === path) details = next;
		} catch {
			if (alive && turn === detailsGeneration) details = null;
		}
	}
	function refreshRecord() {
		const next = studioDocument.snapshot();
		const changed =
			next.path !== record.path || (next.revision && next.revision !== record.revision);
		record = next;
		if (changed && next.data && !next.error) void reloadPreview();
		if (next.error) {
			previewGeneration++;
			preview = null;
			loadingPreview = false;
		}
		void refreshDetails();
	}
	function message(cause: unknown) {
		return cause instanceof Error ? cause.message : String(cause);
	}
	async function reloadPreview() {
		const path = record.path;
		if (!path) return;
		const turn = ++previewGeneration;
		loadingPreview = true;
		error = '';
		try {
			const next = await studioService.preview(path);
			if (alive && turn === previewGeneration && record.path === path) preview = next;
		} catch (cause) {
			if (alive && turn === previewGeneration) {
				preview = null;
				error = message(cause);
			}
		} finally {
			if (alive && turn === previewGeneration) loadingPreview = false;
		}
		void refreshDetails();
	}
	function guardNavigation() {
		if (!dirty && !working) return true;
		error = 'Save or discard app settings before leaving this app.';
		return false;
	}
	async function choose(path: string) {
		if (busy || !guardNavigation()) return;
		error = '';
		try {
			await studioService.open(path);
		} catch (cause) {
			error = message(cause);
		}
	}
	async function starter() {
		if (busy || !guardNavigation()) return;
		working = true;
		error = '';
		try {
			await studioService.createStarter();
		} catch (cause) {
			if (alive) error = message(cause);
		} finally {
			if (alive) working = false;
		}
	}
	function edit(isNew = false) {
		if (busy || !guardNavigation() || (!isNew && !record.data)) return;
		opener = document.activeElement;
		const app = record.data;
		draft = isNew
			? {
					isNew: true,
					path: '/Applications/My explorer/My explorer.app.json',
					title: 'My explorer',
					description: '',
					view: 'cards',
					dataPath: '/Documents/data.json',
					columns: 'title: Title\ncategory: Category\ndescription: Description',
					titleField: 'title',
					filterField: 'category',
					sourceField: null,
					sourcePaths: '',
				}
			: {
					...app!,
					isNew: false,
					path: record.path!,
					columns: app!.columns.map((column) => `${column.key}: ${column.label}`).join('\n'),
					sourcePaths: app!.sourcePaths.join('\n'),
				};
		draftBase = JSON.stringify(draft);
		draftPath = record.path ?? '';
		draftRevision = record.revision ?? '';
		error = '';
	}
	function discard() {
		if (!working) {
			draft = null;
			draftBase = '';
			error = '';
		}
	}
	async function save() {
		if (!draft || busy || staleDraft) return;
		const value = $state.snapshot(draft);
		working = true;
		error = '';
		try {
			const input: StudioInput = {
				title: value.title,
				description: value.description,
				view: value.view,
				dataPath: value.dataPath.trim(),
				columns: value.columns
					.split('\n')
					.filter((line) => line.trim())
					.map((line) => {
						const split = line.indexOf(':');
						return {
							key: (split < 0 ? line : line.slice(0, split)).trim(),
							label: (split < 0 ? line : line.slice(split + 1)).trim(),
						};
					}),
				titleField: value.titleField.trim(),
				filterField: value.filterField?.trim() || null,
				sourceField: value.sourceField?.trim() || null,
				sourcePaths: value.sourcePaths
					.split('\n')
					.map((path) => path.trim())
					.filter(Boolean),
			};
			const saved = value.isNew
				? await studioService.create(value.path, input)
				: await studioService.update(draftPath, draftRevision, input);
			draft = null;
			draftBase = '';
			await studioService.open(saved.path);
		} catch (cause) {
			if (alive) error = message(cause);
		} finally {
			if (alive) working = false;
		}
	}
	async function openFile(path: string) {
		try {
			await revealDesktop({ path, target: 'textedit' });
		} catch (cause) {
			if (alive) error = message(cause);
		}
	}
	function onMessage(event: MessageEvent) {
		if (!preview || event.source !== iframe?.contentWindow || event.origin !== 'null') return;
		const path = studioSourceRequest(event.data, preview.token, preview.sources);
		if (path)
			void revealDesktop({ path }).catch((cause) => {
				if (alive) error = message(cause);
			});
	}
	function attachPreview(node: HTMLIFrameElement) {
		iframe = node;
		return () => {
			if (iframe === node) iframe = undefined;
		};
	}
	function beforeUnload(event: BeforeUnloadEvent) {
		if (dirty || working) {
			event.preventDefault();
			event.returnValue = '';
		}
	}
	onMount(() => {
		alive = true;
		const unsubscribe = studioDocument.subscribe(refreshRecord);
		const unsubscribeFiles = workspaceService.subscribe(() => {
			void refreshList();
			void refreshDetails();
		});
		const clearOpen = studioDocument.setOpenGuard(async (path) => {
			if (path !== record.path && dirty) {
				guardNavigation();
				throw new AppError('OPEN_DRAFT', error);
			}
		});
		const clearPending = studioDocument.setPendingGuard((path) =>
			Boolean(draft && !draft.isNew && draftPath === path && (dirty || working)),
		);
		const clearClose = studioDocument.setCloseGuard(guardNavigation);
		const stopCommands = subscribeToDesktopCommands(({ target, command }) => {
			if (target !== 'studio' || busy) return;
			if (command === 'save') void save();
			if (command === 'new-document') edit(true);
		});
		void refreshList();
		void studioService
			.initialize()
			.then(() => {
				refreshRecord();
				if (record.path && !preview) void reloadPreview();
			})
			.catch((cause) => {
				if (alive) error = message(cause);
			});
		return () => {
			alive = false;
			previewGeneration++;
			detailsGeneration++;
			listGeneration++;
			unsubscribe();
			unsubscribeFiles();
			clearOpen();
			clearPending();
			clearClose();
			stopCommands();
		};
	});
</script>

<svelte:window onmessage={onMessage} onbeforeunload={beforeUnload} />

<section class="studio-shell">
	<div class="studio-content" inert={draft !== null}>
		<div class="toolbar">
			<div class="toolbar-title">
				<strong>App Studio</strong><span>Tools made from your files</span>
			</div>
			<button disabled={busy} onclick={() => edit(true)}>New app</button>
			<button disabled={busy || !record.data} onclick={() => edit()}>App settings</button>
			<button disabled={loadingPreview || !record.data} onclick={() => void reloadPreview()}
				>Reload data</button
			>
			<button
				class={showFiles ? 'active' : ''}
				aria-pressed={showFiles}
				disabled={!record.path}
				onclick={() => (showFiles = !showFiles)}>Files</button
			>
		</div>
		{#if error || record.error}<p class="notice error" role="alert">{error || record.error}</p>{/if}
		{#if record.warning}<p class="notice">{record.warning}</p>{/if}
		{#if dataChanged && !loadingPreview}<p class="notice">
				{details?.dataFile.error || 'The data file changed. Reload data to use the latest records.'}
			</p>{/if}
		<div class="body">
			<aside class="library" aria-label="Saved apps">
				<h2>Applications</h2>
				{#each listing.apps as app (app.path)}
					<button
						class={record.path === app.path ? 'selected' : ''}
						disabled={busy}
						onclick={() => void choose(app.path)}
						title={app.description}
					>
						<span class="app-icon" aria-hidden="true">▦</span><span
							><strong>{app.title}</strong><small
								>{app.view === 'cards' ? 'Explorer' : 'Table'}</small
							></span
						>
					</button>
				{/each}
				{#if !listing.apps.length}<p class="library-empty">Your saved apps appear here.</p>{/if}
				<button class="sample" disabled={busy} onclick={() => void starter()}
					>Create Feedback Explorer</button
				>
				{#if listing.truncated}<p class="library-empty">Showing the first 100 apps.</p>{/if}
				{#each listing.warnings as warning (warning)}<p class="library-empty">{warning}</p>{/each}
			</aside>
			<main class="preview-pane">
				{#if preview && preview.path === record.path && !record.error}
					{#key preview.token}<iframe
							{@attach attachPreview}
							title="App preview"
							srcdoc={preview.srcdoc}
							sandbox="allow-scripts"
							referrerpolicy="no-referrer"
						></iframe>{/key}
				{:else if loadingPreview || record.loading}<div class="empty"><p>Opening app…</p></div>
				{:else if record.path}<div class="empty">
						<h2>App preview unavailable</h2>
						<p>
							{details?.dataFile.error ||
								error ||
								record.error ||
								'Open the data and app settings to check the selected files.'}
						</p>
						<button onclick={() => (showFiles = true)}>Show app files</button>
					</div>
				{:else}<div class="empty welcome">
						<span class="welcome-icon" aria-hidden="true">▦</span>
						<h2>Turn your data into an app.</h2>
						<p>
							Search records, filter findings, and open the source notes. You and your agent can
							update the saved data and use the app again.
						</p>
						<button class="primary" disabled={busy} onclick={() => void starter()}
							>Try the Feedback Explorer</button
						><small>Creates a sample app, four fictional interviews, and their source notes.</small>
					</div>{/if}
				{#if showFiles && record.path && record.data}
					<div class="files-panel">
						<h2>App files</h2>
						<button onclick={() => void openFile(record.path!)}
							><strong>App settings</strong><span>{record.path}</span></button
						>
						<button onclick={() => void openFile(record.data!.dataPath)}
							><strong
								>Data {details?.dataFile.error
									? '· unavailable'
									: `· ${details?.dataFile.rowCount ?? 0} records`}</strong
							><span>{record.data.dataPath}</span></button
						>
						{#each details?.sources ?? [] as source (source.path)}<button
								disabled={!source.exists}
								onclick={() =>
									void revealDesktop({ path: source.path }).catch(
										(cause) => (error = message(cause)),
									)}
								><strong>{source.exists ? 'Source' : 'Missing source'}</strong><span
									>{source.path}</span
								></button
							>{/each}
						<p>Edits stay in the shared workspace. Reload data after changing records.</p>
					</div>
				{/if}
			</main>
		</div>
		<footer>
			<span>{record.path || 'Saved apps use the same files as the desktop.'}</span><span
				>{loadingPreview ? 'Loading data…' : 'Read-only preview'}</span
			>
		</footer>
	</div>
	{#if draft}
		<WindowSheet
			labelledby="studio-form-title"
			busy={working}
			returnFocus={opener}
			onclose={discard}
		>
			<h2 id="studio-form-title">{draft.isNew ? 'Create an app' : 'App settings'}</h2>
			<form
				onsubmit={(event) => {
					event.preventDefault();
					void save();
				}}
			>
				<div class="form-fields">
					<label
						>App title<input
							bind:value={draft.title}
							required
							maxlength="160"
							disabled={working}
						/></label
					>
					<label
						>Description<textarea
							bind:value={draft.description}
							rows="2"
							maxlength="2000"
							disabled={working}></textarea></label
					>
					{#if draft.isNew}<label
							>Save app at<input bind:value={draft.path} required disabled={working} /></label
						>{/if}
					<label
						>JSON data file<input bind:value={draft.dataPath} required disabled={working} /></label
					>
					<p class="hint">A JSON array of records. Text, numbers, and booleans are supported.</p>
					<label
						>Columns<textarea bind:value={draft.columns} rows="4" required disabled={working}
						></textarea></label
					>
					<p class="hint">One field per line, written as field: Label. Up to 12 columns.</p>
					<div class="field-pair">
						<label
							>Title field<input bind:value={draft.titleField} required disabled={working} /></label
						><label
							>Filter field<input
								bind:value={draft.filterField}
								disabled={working}
								placeholder="Optional"
							/></label
						>
					</div>
					<div class="field-pair">
						<label
							>Source field<input
								bind:value={draft.sourceField}
								disabled={working}
								placeholder="Optional"
							/></label
						><label
							>Default view<select
								aria-label="Default view"
								bind:value={draft.view}
								disabled={working}
								><option value="cards">Cards</option><option value="table">Table</option></select
							></label
						>
					</div>
					<label
						>Selected source files<textarea
							bind:value={draft.sourcePaths}
							rows="3"
							disabled={working}
							placeholder="One workspace path per line"></textarea></label
					>
					<p class="hint">Records can open only the source files listed here.</p>
				</div>
				{#if error}<p class="form-error" role="alert">{error}</p>{/if}
				{#if staleDraft}<p class="form-error" role="alert">
						The saved app changed. Discard these settings and reopen them before editing.
					</p>{/if}
				<div class="form-actions">
					<button type="button" disabled={working} onclick={discard}>Discard</button><button
						class="primary"
						type="submit"
						disabled={working || staleDraft}>{working ? 'Saving…' : 'Save app'}</button
					>
				</div>
			</form>
		</WindowSheet>
	{/if}
</section>

<style>
	.studio-shell {
		height: 100%;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		color: var(--app-text);
		background: var(--app-surface);
		container-type: inline-size;
		--sheet-width: 540px;
	}
	.studio-content {
		height: 100%;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.toolbar {
		display: flex;
		gap: 7px;
		align-items: center;
		padding: 12px 15px;
		border-bottom: 1px solid var(--app-border);
		background: var(--app-chrome);
		flex-wrap: wrap;
	}
	.toolbar-title {
		padding-left: 74px;
		margin-right: auto;
		display: flex;
		flex-direction: column;
		min-width: 125px;
	}
	.toolbar-title strong {
		font-size: 13px;
	}
	.toolbar-title span {
		font-size: 10px;
		color: var(--app-text-secondary);
		margin-top: 2px;
	}
	button,
	input,
	textarea,
	select {
		font: inherit;
	}
	button {
		font-size: 11px;
		border: 1px solid var(--app-control-border);
		border-radius: 6px;
		background: var(--app-control);
		color: var(--app-text);
		padding: 6px 9px;
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: var(--app-hover);
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button:focus-visible,
	input:focus,
	textarea:focus,
	select:focus {
		outline: 2px solid var(--app-accent);
		outline-offset: 2px;
	}
	.primary {
		background: var(--app-accent);
		color: white;
		border-color: transparent;
	}
	.toolbar button.active {
		background: var(--app-selection);
	}
	.body {
		flex: 1;
		display: flex;
		min-height: 0;
		overflow: hidden;
	}
	.library {
		width: 188px;
		flex: none;
		background: var(--app-sidebar);
		border-right: 1px solid var(--app-border);
		padding: 16px 10px;
		overflow: auto;
	}
	.library h2 {
		font-size: 10px;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--app-text-secondary);
		margin: 0 8px 12px;
	}
	.library > button:not(.sample) {
		display: flex;
		align-items: center;
		text-align: left;
		gap: 9px;
		width: 100%;
		background: transparent;
		border-color: transparent;
		margin-bottom: 4px;
		padding: 8px;
	}
	.library > button.selected {
		background: var(--app-selection);
	}
	.library strong {
		font-size: 12px;
		font-weight: 550;
		display: block;
		overflow-wrap: anywhere;
	}
	.library small {
		display: block;
		font-size: 10px;
		color: var(--app-text-secondary);
		margin-top: 3px;
	}
	.app-icon {
		display: grid;
		place-items: center;
		flex: none;
		width: 29px;
		height: 29px;
		border-radius: 7px;
		background: #627eae;
		color: white;
		font-size: 22px;
	}
	.library-empty {
		font-size: 11px;
		line-height: 1.5;
		color: var(--app-text-secondary);
		padding: 0 8px;
		overflow-wrap: anywhere;
	}
	.sample {
		width: 100%;
		margin-top: 18px;
		font-size: 10px;
		padding: 8px 4px;
	}
	.preview-pane {
		display: flex;
		flex: 1;
		min-width: 0;
		min-height: 0;
		background: #f6f7fa;
		position: relative;
	}
	.preview-pane iframe {
		width: 100%;
		height: 100%;
		flex: 1;
		border: 0;
		min-width: 0;
	}
	.empty {
		display: flex;
		flex: 1;
		min-width: 0;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		gap: 12px;
		text-align: center;
		padding: 30px;
		color: #455163;
	}
	.empty h2 {
		font-size: 20px;
		letter-spacing: -0.5px;
		margin: 0;
		max-width: 330px;
	}
	.empty p {
		font-size: 12px;
		line-height: 1.7;
		max-width: 350px;
		margin: 0;
		color: #78808d;
		overflow-wrap: anywhere;
	}
	.empty small {
		font-size: 10px;
		color: #7b8591;
		max-width: 280px;
		line-height: 1.6;
	}
	.welcome-icon {
		font-size: 42px;
		color: #607daf;
		background: #e8edf5;
		border-radius: 16px;
		width: 72px;
		height: 72px;
		display: grid;
		place-items: center;
		margin-bottom: 8px;
	}
	.empty .primary {
		font-size: 12px;
		padding: 9px 16px;
	}
	.files-panel {
		width: 230px;
		flex: none;
		background: var(--app-surface);
		border-left: 1px solid var(--app-border);
		padding: 16px;
		overflow: auto;
		color: var(--app-text);
	}
	.files-panel h2 {
		font-size: 12px;
		margin: 0 0 12px;
	}
	.files-panel button {
		text-align: left;
		width: 100%;
		margin-bottom: 9px;
		display: block;
	}
	.files-panel strong {
		display: block;
		font-size: 10px;
	}
	.files-panel span {
		display: block;
		font-size: 10px;
		color: var(--app-text-secondary);
		overflow-wrap: anywhere;
		margin-top: 5px;
		line-height: 1.5;
	}
	.files-panel p {
		font-size: 10px;
		line-height: 1.7;
		color: var(--app-text-secondary);
	}
	.notice {
		flex: none;
		margin: 0;
		padding: 8px 15px;
		font-size: 11px;
		line-height: 1.5;
		background: var(--app-warning-bg);
		color: var(--app-warning);
		overflow-wrap: anywhere;
	}
	.notice.error {
		background: var(--app-danger-bg);
		color: var(--app-danger);
	}
	footer {
		display: flex;
		gap: 12px;
		justify-content: space-between;
		border-top: 1px solid var(--app-border);
		padding: 6px 12px;
		color: var(--app-text-secondary);
		font-size: 9px;
		background: var(--app-chrome);
	}
	footer span:first-child {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	footer span:last-child {
		white-space: nowrap;
	}
	form {
		display: flex;
		flex-direction: column;
		min-height: 0;
		gap: 13px;
	}
	.form-fields {
		overflow: auto;
		min-height: 0;
		padding: 3px;
		display: flex;
		flex-direction: column;
		gap: 11px;
	}
	.form-fields label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 11px;
		font-weight: 550;
	}
	.form-fields input,
	.form-fields textarea,
	.form-fields select {
		min-width: 0;
		width: 100%;
		border: 1px solid var(--app-control-border);
		background: var(--app-surface);
		color: var(--app-text);
		border-radius: 5px;
		padding: 7px 9px;
		font-size: 12px;
		box-sizing: border-box;
	}
	.form-fields textarea {
		resize: vertical;
	}
	.field-pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.hint {
		font-size: 10px;
		line-height: 1.5;
		color: var(--app-text-secondary);
		margin: -5px 0 0;
	}
	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 7px;
	}
	.form-error {
		font-size: 11px;
		line-height: 1.5;
		color: var(--app-danger);
		margin: 0;
	}
	@container (max-width:720px) {
		.library {
			width: 145px;
		}
		.toolbar-title span {
			display: none;
		}
		.files-panel {
			position: absolute;
			right: 0;
			top: 0;
			bottom: 0;
			box-shadow: -5px 0 18px #0001;
		}
		.toolbar {
			padding: 9px;
			gap: 5px;
		}
		.toolbar button {
			font-size: 10px;
			padding: 5px 7px;
		}
	}
	@container (max-width:480px) {
		.library {
			width: 100px;
			padding: 12px 5px;
		}
		.library .app-icon {
			display: none;
		}
		.library strong {
			font-size: 10px;
		}
		.library h2 {
			margin: 0 4px 10px;
			font-size: 8px;
		}
		.library > button:not(.sample) {
			padding: 6px;
		}
		.sample {
			font-size: 9px;
		}
		.toolbar-title {
			width: 100%;
		}
		.empty {
			padding: 20px;
		}
		.empty h2 {
			font-size: 17px;
		}
		.field-pair {
			grid-template-columns: 1fr;
		}
	}
</style>
