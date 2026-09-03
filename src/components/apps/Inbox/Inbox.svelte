<script lang="ts">
	import { connectAppNavigation } from '🍎/lib/desktop/navigation';

	import { onMount } from 'svelte';
	import WindowSheet from '🍎/components/SystemUI/WindowSheet.svelte';
	import InboxIcon from '~icons/mdi/inbox-arrow-down-outline';
	import PlusIcon from '~icons/mdi/plus';
	import FileIcon from '~icons/mdi/file-outline';
	import { AppError } from '🍎/lib/errors';
	import {
		inboxDocument,
		inboxService,
		INBOX_MAX_FILES,
		INBOX_MAX_FILE_BYTES,
		INBOX_MAX_TOTAL_BYTES,
		type InboxState,
		type InboxSummary,
	} from '🍎/lib/inbox/inbox';
	import { workspaceService } from '🍎/lib/workspace/workspace';
	import { workspaceBasename, workspaceDirname } from '🍎/lib/workspace/path';
	import { revealDesktop } from '🍎/lib/desktop/files';

	let record = $state.raw(inboxDocument.snapshot());
	let requests = $state.raw<InboxSummary[]>([]);
	let listErrors = $state.raw<Array<{ path: string; message: string }>>([]);
	let truncated = $state(false);
	let filter = $state<'all' | InboxState>('new');
	let dialog = $state<'new' | 'edit' | null>(null);
	let opener = $state.raw<Element | null>(null);
	let title = $state('');
	let request = $state('');
	let note = $state('');
	let sourceUrl = $state('');
	let projectPath = $state('');
	let outputText = $state('');
	let status = $state<InboxState>('new');
	let files = $state.raw<File[]>([]);
	let projectPaths = $state.raw<string[]>([]);
	let editingPath = $state('');
	let editingRevision = $state('');
	let baseDraft = $state('');
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	let mounted = true;
	let listGeneration = 0;
	const states: Array<{ value: 'all' | InboxState; label: string }> = [
		{ value: 'new', label: 'New' },
		{ value: 'filed', label: 'Filed' },
		{ value: 'done', label: 'Done' },
		{ value: 'all', label: 'All' },
	];
	const visible = $derived(requests.filter((item) => filter === 'all' || item.state === filter));
	const current = $derived(record.data);
	const fingerprint = () =>
		JSON.stringify({
			title,
			request,
			note,
			sourceUrl,
			projectPath,
			outputText,
			status,
			files: files.map((file) => [file.name, file.size, file.lastModified]),
		});
	const dirty = $derived(dialog !== null && fingerprint() !== baseDraft);
	const stale = $derived(
		dialog === 'edit' && (record.path !== editingPath || record.revision !== editingRevision),
	);
	const label = (state: InboxState) => states.find((item) => item.value === state)?.label;
	const size = (bytes: number) =>
		bytes < 1000
			? `${bytes} B`
			: bytes < 1_000_000
				? `${(bytes / 1000).toFixed(1)} KB`
				: `${(bytes / 1_000_000).toFixed(1)} MB`;

	async function refreshList() {
		const generation = ++listGeneration;
		try {
			const result = await inboxService.list();
			if (!mounted || generation !== listGeneration) return;
			requests = result.requests;
			listErrors = result.errors;
			truncated = result.truncated;
			projectPaths = workspaceService
				.getAllPaths()
				.filter((path) => path.endsWith('.project.json') && !/^\/(System|Trash)\//.test(path))
				.sort();
		} catch (cause) {
			if (mounted) error = cause instanceof Error ? cause.message : String(cause);
		}
	}
	async function perform(action: () => Promise<void>) {
		if (busy) return;
		busy = true;
		error = '';
		notice = '';
		try {
			await action();
		} catch (cause) {
			if (mounted) error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (mounted) busy = false;
		}
	}
	async function choose(path: string) {
		await perform(async () => {
			await inboxDocument.open(path);
		});
	}
	function openDialog(kind: 'new' | 'edit') {
		if (busy) return;
		opener = document.activeElement;
		dialog = kind;
		error = '';
		notice = '';
		const data = kind === 'edit' ? current : null;
		title = data?.title ?? '';
		request = data?.request ?? '';
		note = '';
		sourceUrl = '';
		projectPath = data?.projectPath ?? '';
		outputText = data?.outputPaths.join('\n') ?? '';
		status = data?.state ?? 'new';
		files = [];
		editingPath = record.path ?? '';
		editingRevision = record.revision ?? '';
		baseDraft = fingerprint();
	}
	function closeDialog(discard = false) {
		if (busy) return;
		if (dirty && !discard) {
			error = 'Save or discard your request edits before closing.';
			return;
		}
		dialog = null;
		files = [];
		error = '';
	}
	function selectFiles(event: Event) {
		files = Array.from((event.currentTarget as HTMLInputElement).files ?? []);
	}
	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (stale || busy) return;
		await perform(async () => {
			if (dialog === 'new') {
				if (
					files.length > INBOX_MAX_FILES ||
					files.some((file) => file.size > INBOX_MAX_FILE_BYTES) ||
					files.reduce((total, file) => total + file.size, 0) > INBOX_MAX_TOTAL_BYTES
				)
					throw new AppError(
						'FILE_TOO_LARGE',
						'Choose up to 20 files, at most 10 MB each and 25 MB in total.',
					);
				const uploads = await Promise.all(
					files.map(async (file) => ({
						name: file.name,
						bytes: new Uint8Array(await file.arrayBuffer()),
					})),
				);
				const saved = await inboxService.create(
					{
						title: title.trim(),
						request: request.trim(),
						note,
						sourceUrl: sourceUrl.trim(),
						projectPath: projectPath.trim() || null,
						files: uploads,
					},
					{ actor: 'human' },
				);
				if (!mounted) return;
				dialog = null;
				files = [];
				filter = 'new';
				await inboxDocument.open(saved.path);
				notice = 'Added to Inbox';
			} else {
				await inboxService.update(
					editingPath,
					editingRevision,
					{
						title: title.trim(),
						request: request.trim(),
						state: status,
						projectPath: projectPath.trim() || null,
						outputPaths: outputText
							.split('\n')
							.map((path) => path.trim())
							.filter(Boolean),
					},
					{ actor: 'human' },
				);
				if (!mounted) return;
				dialog = null;
				filter = status;
				notice = 'Request saved';
			}
			await refreshList();
		});
	}
	async function reveal(path: string, folder = false) {
		await perform(async () => {
			await revealDesktop({ path, ...(folder ? { target: 'finder' as const } : {}) });
		});
	}
	onMount(() => {
		mounted = true;
		const unsub = inboxDocument.subscribe(() => {
			record = inboxDocument.snapshot();
		});
		const unwatch = workspaceService.subscribe(() => {
			void refreshList();
		});
		const clearPending = inboxDocument.setPendingGuard(
			(path) => dialog === 'edit' && editingPath === path && (dirty || busy),
		);
		const clearOpen = inboxDocument.setOpenGuard(async (path) => {
			if (dialog && (dirty || busy) && path !== editingPath)
				throw new AppError(
					'OPEN_DRAFT',
					'Save or discard the Inbox draft before opening another request.',
				);
		});
		const clearClose = inboxDocument.setCloseGuard(() => {
			if (busy || dirty) {
				error = 'Save or discard your request edits before closing Inbox.';
				return false;
			}
			return true;
		});
		void (async () => {
			await refreshList();
			if (!mounted || inboxDocument.snapshot().path || dialog) return;
			const remembered = await inboxDocument.resolvePath();
			const first = requests.find((item) => item.path === remembered) ?? requests[0];
			if (first && mounted) await choose(first.path);
		})();
		return () => {
			mounted = false;
			listGeneration++;
			unsub();
			unwatch();
			clearPending();
			clearOpen();
			clearClose();
		};
	});
	onMount(() =>
		connectAppNavigation('inbox', {
			ready: () => !record.loading,
			read: () => ({
				path: record.path,
				filter,
				visiblePaths: visible.map((item) => item.path),
				busy,
				dirty,
			}),
			navigate: async ({ filter: nextFilter }) => {
				if (busy || dirty)
					throw new AppError('UNSAVED_EDITS', 'Save or discard Inbox edits before navigating.');
				if (nextFilter !== undefined) filter = nextFilter;
				await refreshList();
			},
		}),
	);
</script>

<svelte:window
	onbeforeunload={(event) => {
		if (dirty || busy) {
			event.preventDefault();
			event.returnValue = '';
		}
	}}
/>

<div class="inbox-app" inert={dialog !== null}>
	<div class="toolbar app-window-drag-handle">
		<span class="app-label"><InboxIcon /> Inbox</span>
		<button onclick={() => openDialog('new')} disabled={busy}><PlusIcon /> New request</button>
	</div>
	<div class="panes">
		<aside aria-label="Inbox requests">
			<nav aria-label="Request status">
				{#each states as item (item.value)}<button
						class={{ active: filter === item.value }}
						aria-pressed={filter === item.value}
						onclick={() => (filter = item.value)}
						>{item.label}<span
							>{requests.filter((request) => item.value === 'all' || request.state === item.value)
								.length}</span
						></button
					>{/each}
			</nav>
			<div class="request-list">
				{#each visible as item (item.path)}
					<button
						class={{ selected: record.path === item.path }}
						aria-label={item.title}
						aria-pressed={record.path === item.path}
						onclick={() => choose(item.path)}
						disabled={busy}
					>
						<strong>{item.title}</strong><span class="excerpt">{item.request}</span><span
							class="meta"
							>{label(item.state)} · {item.attachmentCount}
							{item.attachmentCount === 1 ? 'file' : 'files'}</span
						>
					</button>
				{:else}<p class="list-empty">
						{filter === 'new' ? 'Nothing waiting here.' : 'No requests in this view.'}
					</p>{/each}
			</div>
		</aside>
		<section class="detail" aria-label="Request details">
			{#if record.loading}<p class="muted">Opening request...</p>
			{:else if record.error}<p class="error" role="alert">{record.error}</p>
			{:else if current}
				<header>
					<div>
						<span class="state" data-state={current.state}>{label(current.state)}</span>
						<h1>{current.title}</h1>
					</div>
					<button onclick={() => openDialog('edit')} disabled={busy}>Edit request</button>
				</header>
				<p class="request-text">{current.request}</p>
				{#if current.attachments.length || current.notePath}
					<h2>Source files</h2>
					<div class="files">
						{#if current.notePath}<button onclick={() => reveal(current.notePath!)} disabled={busy}
								><FileIcon /><span
									>Pasted notes<small>{workspaceBasename(current.notePath)}</small></span
								></button
							>{/if}
						{#each current.attachments as file (file.path)}<button
								onclick={() => reveal(file.path)}
								disabled={busy}
								><FileIcon /><span>{file.name}<small>{size(file.size)}</small></span></button
							>{/each}
					</div>
				{/if}
				{#if current.sourceUrl}<h2>Source bookmark</h2>
					<a class="source-link" href={current.sourceUrl} target="_blank" rel="noopener noreferrer"
						>{current.sourceUrl}</a
					>
					<p class="muted">Saved as a reference. Page content has not been imported.</p>{/if}
				{#if current.projectPath}<h2>Filed with</h2>
					<button class="file-link" onclick={() => reveal(current.projectPath!)} disabled={busy}
						>{workspaceBasename(current.projectPath)}</button
					>{/if}
				{#if current.outputPaths.length}<h2>Finished work</h2>
					<div class="files">
						{#each current.outputPaths as path (path)}<button
								onclick={() => reveal(path)}
								disabled={busy}
								><FileIcon /><span>{workspaceBasename(path)}<small>{path}</small></span></button
							>{/each}
					</div>{/if}
				<footer class="record-footer">
					<span>Added {new Date(current.createdAt).toLocaleDateString()}</span><button
						onclick={() => reveal(workspaceDirname(record.path!), true)}
						disabled={busy}>Show in Finder</button
					>
				</footer>
			{:else}
				<div class="empty">
					<InboxIcon />
					<h1>Start with what you have.</h1>
					<p>
						Add source files and notes, then describe what you need. Your agent can read the request
						and link the finished work here.
					</p>
					<button class="primary" onclick={() => openDialog('new')} disabled={busy}
						>Add first request</button
					>
				</div>
			{/if}
		</section>
	</div>
	{#if !dialog && error}<p class="status error" role="alert">{error}</p>{/if}
	{#if notice}<p class="status" role="status">{notice}</p>{/if}
	{#if listErrors.length}<p class="status error">
			{listErrors.length} request {listErrors.length === 1 ? 'file needs' : 'files need'} repair. Open
			the file in Notepad or restore a saved version in Activity.
		</p>{/if}
	{#if truncated}<p class="status">Showing the first 200 request files.</p>{/if}
</div>

{#if dialog}
	<WindowSheet
		labelledby="inbox-sheet-title"
		{busy}
		returnFocus={opener}
		onclose={() => closeDialog()}
		--sheet-width="530px"
	>
		<h2 id="inbox-sheet-title">{dialog === 'new' ? 'Add to Inbox' : 'Edit request'}</h2>
		<form onsubmit={save}>
			<div class="sheet-body">
				<fieldset disabled={busy}>
					<label>Request title<input bind:value={title} required maxlength="160" /></label>
					<label
						>What needs doing?<textarea bind:value={request} required maxlength="6000" rows="3"
						></textarea></label
					>
					{#if dialog === 'new'}
						<label
							>Pasted notes<textarea
								bind:value={note}
								maxlength="100000"
								rows="3"
								placeholder="Paste source material to save as a note"></textarea></label
						>
						<label
							>Source URL<input
								bind:value={sourceUrl}
								type="url"
								maxlength="2048"
								placeholder="https://"
							/></label
						>
						<label>Files<input type="file" multiple onchange={selectFiles} /></label>
						<p class="form-hint">
							Up to 20 files, 10 MB each and 25 MB in total. Files stay in this browser workspace.
						</p>
						{#if files.length}<p class="form-hint">
								{files.length} selected · {size(
									files.reduce((total, file) => total + file.size, 0),
								)}
							</p>{/if}
					{:else}
						<label
							>Status<select bind:value={status}
								><option value="new">New</option><option value="filed">Filed</option><option
									value="done">Done</option
								></select
							></label
						>
					{/if}
					<label
						>Project file<input
							bind:value={projectPath}
							list="inbox-project-files"
							maxlength="2048"
							placeholder="/Projects/Client.project.json"
						/></label
					>
					<datalist id="inbox-project-files"
						>{#each projectPaths as path (path)}<option value={path}></option>{/each}</datalist
					>
					{#if dialog === 'edit'}<label
							>Output files<textarea
								bind:value={outputText}
								rows="3"
								placeholder="One saved workspace file path per line"></textarea></label
						>
						<p class="form-hint">
							Filed requests need a project. Done requests need at least one saved output.
						</p>{/if}
				</fieldset>
				{#if stale}<p class="error" role="alert">
						This request changed while you were editing. Copy any edits you need, then discard this
						draft and reopen the request.
					</p>{/if}
				{#if error}<p class="error" role="alert">{error}</p>{/if}
			</div>
			<footer>
				<button type="button" disabled={busy} onclick={() => closeDialog(true)}
					>{dialog === 'edit' ? 'Discard changes' : 'Cancel'}</button
				><button class="primary" type="submit" disabled={busy || stale}
					>{busy ? 'Saving...' : dialog === 'new' ? 'Add to Inbox' : 'Save request'}</button
				>
			</footer>
		</form>
	</WindowSheet>
{/if}

<style>
	.inbox-app {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		container-type: inline-size;
		color: var(--app-text);
		background: var(--app-surface);
		font-size: 13px;
	}
	.toolbar {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: var(--app-titlebar-height);
		box-sizing: border-box;
		padding: 9px 14px 9px 94px;
		border-bottom: 1px solid var(--app-border);
		background: var(--app-chrome);
	}
	.app-label,
	.toolbar button {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.app-label {
		font-weight: 600;
	}
	.app-label :global(svg) {
		width: 19px;
		height: 19px;
		color: var(--app-accent);
	}
	button {
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.toolbar button,
	.detail header button,
	.file-link,
	.record-footer button,
	.empty button {
		border: 1px solid var(--app-control-border);
		background: var(--app-control);
		border-radius: var(--app-control-radius);
		padding: 5px 10px;
		min-height: var(--app-control-height);
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button:focus-visible,
	a:focus-visible {
		outline: 2px solid var(--app-focus);
		outline-offset: 2px;
	}
	.panes {
		display: flex;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
	aside {
		display: flex;
		flex-direction: column;
		width: 235px;
		flex-shrink: 0;
		border-right: 1px solid var(--app-border);
		background: var(--app-sidebar);
		min-height: 0;
	}
	nav {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 10px;
		border-bottom: 1px solid var(--app-border);
	}
	nav button {
		display: flex;
		align-items: center;
		gap: 5px;
		border: 0;
		background: transparent;
		padding: 5px 7px;
		border-radius: 5px;
		font-size: 11px;
	}
	nav button.active {
		background: var(--app-selection-strong);
		color: var(--app-selection-text);
	}
	nav span {
		opacity: 0.65;
		font-variant-numeric: tabular-nums;
	}
	.request-list {
		overflow: auto;
		min-height: 0;
		padding: 6px;
	}
	.request-list > button {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 6px;
		width: 100%;
		padding: 11px 10px;
		text-align: left;
		border: 0;
		border-radius: 6px;
		background: transparent;
	}
	.request-list > button.selected {
		background: var(--app-selection-strong);
		color: var(--app-selection-text);
	}
	.request-list strong {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.excerpt {
		display: -webkit-box;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		line-height: 1.45;
		font-size: 12px;
		opacity: 0.8;
	}
	.meta {
		font-size: 10px;
		opacity: 0.65;
	}
	.list-empty {
		padding: 14px 8px;
		color: var(--app-text-secondary);
		font-size: 12px;
	}
	.detail {
		flex: 1;
		min-width: 0;
		min-height: 0;
		overflow: auto;
		padding: 25px 28px;
	}
	.detail header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 18px;
	}
	.detail header button {
		flex-shrink: 0;
		font-size: 11px;
	}
	h1 {
		margin: 9px 0 0;
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.4px;
		overflow-wrap: anywhere;
	}
	h2 {
		font-size: 11px;
		font-weight: 600;
		color: var(--app-text-secondary);
		margin: 26px 0 9px;
	}
	.state {
		display: inline-block;
		font-size: 10px;
		padding: 3px 7px;
		border-radius: 4px;
		background: var(--app-selection-strong);
		color: var(--app-selection-text);
	}
	.state[data-state='done'] {
		color: var(--app-success, #207d48);
		background: color-mix(in srgb, var(--app-success, #207d48) 12%, transparent);
	}
	.request-text {
		margin-top: 20px;
		line-height: 1.6;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.files {
		border-block: 1px solid var(--app-border);
	}
	.files button {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 10px;
		width: 100%;
		padding: 10px 3px;
		text-align: left;
		border: 0;
		border-bottom: 1px solid var(--app-border);
		background: transparent;
	}
	.files button:last-child {
		border-bottom: 0;
	}
	.files :global(svg) {
		width: 21px;
		height: 21px;
		flex-shrink: 0;
		color: var(--app-text-secondary);
	}
	.files span {
		overflow-wrap: anywhere;
	}
	.files small {
		display: block;
		color: var(--app-text-secondary);
		font-size: 10px;
		margin-top: 3px;
	}
	.source-link {
		color: var(--app-accent);
		overflow-wrap: anywhere;
	}
	.muted {
		color: var(--app-text-secondary);
		font-size: 11px;
		line-height: 1.5;
	}
	.record-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 30px;
		padding-top: 14px;
		border-top: 1px solid var(--app-border);
		font-size: 10px;
		color: var(--app-text-secondary);
	}
	.record-footer button {
		font-size: 11px;
	}
	.empty {
		max-width: 300px;
		margin: 60px auto;
		text-align: center;
	}
	.empty :global(svg) {
		width: 46px;
		height: 46px;
		color: var(--app-text-secondary);
	}
	.empty h1 {
		font-size: 20px;
	}
	.empty p {
		color: var(--app-text-secondary);
		line-height: 1.6;
		margin: 16px 0 22px;
	}
	.empty .primary {
		background: var(--app-accent);
		color: var(--app-accent-text);
		border-color: transparent;
	}
	.status {
		flex: none;
		margin: 0;
		padding: 8px 14px;
		font-size: 11px;
		border-top: 1px solid var(--app-border);
	}
	.error {
		color: var(--app-danger, #b52b30);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}
	.form-hint {
		font-size: 11px;
		color: var(--app-text-secondary);
		line-height: 1.5;
	}
	@container (max-width: 640px) {
		aside {
			width: 185px;
		}
		.detail {
			padding: 20px 16px;
		}
		.detail header {
			flex-direction: column;
			gap: 12px;
		}
	}
	@container (max-width: 460px) {
		.panes {
			flex-direction: column;
		}
		aside {
			width: auto;
			max-height: 165px;
			border-right: 0;
			border-bottom: 1px solid var(--app-border);
		}
		nav {
			gap: 0;
			padding: 6px;
		}
		nav button {
			font-size: 10px;
			padding: 4px;
		}
		.detail {
			padding: 16px 12px;
		}
		h1 {
			font-size: 18px;
		}
		.record-footer {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
