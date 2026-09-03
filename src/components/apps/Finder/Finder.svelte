<script lang="ts">
	import { onMount, tick } from 'svelte';
	import BackIcon from '~icons/ph/caret-left';
	import FolderIcon from '~icons/ph/folder';
	import FoldersIcon from '~icons/ph/folders';
	import NewFolderIcon from '~icons/ph/folder-plus';
	import NewFileIcon from '~icons/ph/file-plus';
	import FileIcon from '~icons/ph/file-text';
	import NoteIcon from '~icons/ph/note-pencil';
	import TrashIcon from '~icons/ph/trash';
	import SearchIcon from '~icons/ph/magnifying-glass';
	import WindowSheet from '🍎/components/SystemUI/WindowSheet.svelte';
	import { subscribeToDesktopCommands } from '🍎/lib/desktop/commands';
	import { revealDesktop } from '🍎/lib/desktop/files';
	import { finderState, subscribeToFinderReveal } from '🍎/lib/workspace/finder-state.svelte';
	import {
		normalizeWorkspacePath,
		workspaceBasename,
		workspaceDirname,
	} from '🍎/lib/workspace/path';
	import { workspaceService, type WorkspaceEntry } from '🍎/lib/workspace/workspace';
	import { apps } from '🍎/state/apps.svelte.ts';

	const places = [
		{ label: 'Home', path: '/Home', icon: FolderIcon },
		{ label: 'Inbox', path: '/Inbox', icon: FolderIcon },
		{ label: 'Projects', path: '/Projects', icon: FoldersIcon },
		{ label: 'Documents', path: '/Documents', icon: FileIcon },
		{ label: 'Notes', path: '/Notes', icon: NoteIcon },
		{ label: 'Shortcuts', path: '/Shortcuts', icon: FolderIcon },
		{ label: 'Applications', path: '/Applications', icon: FolderIcon },
		{ label: 'Trash', path: '/Trash', icon: TrashIcon },
	];
	const protectedPaths = new Set([...places.map((place) => place.path), '/System']);
	const optionalPlaces = new Set(['/Home', '/Inbox', '/Shortcuts', '/Applications', '/Trash']);

	type DialogMode = 'document' | 'folder' | 'rename' | null;
	type ItemMenu = { entry: WorkspaceEntry; x: number; y: number } | null;

	let currentPath = $state(finderState.path);
	let entries = $state<WorkspaceEntry[]>([]);
	let selectedPath = $state(finderState.selectedPath);
	let loading = $state(true);
	let searchQuery = $state('');
	let searchMatches = $state<WorkspaceEntry[]>([]);
	let dialogMode = $state<DialogMode>(null);
	let dialogReturnFocus = $state<Element | null>(null);
	let dialogName = $state('');
	let dialogError = $state('');
	let actionError = $state('');
	let nameInput = $state<HTMLInputElement>();
	let searchInput = $state<HTMLInputElement>();
	let finderShell = $state<HTMLElement>();
	let itemMenu = $state<ItemMenu>(null);
	let draggedPath = $state('');
	let dropTarget = $state('');
	let loadRevision = 0;
	let searchRevision = 0;
	let pointerDrag = $state<
		| { source: string; pointerId: number; startX: number; startY: number; active: boolean }
		| undefined
	>();
	let suppressNextClick = false;
	let nativeDragActive = false;

	const visibleEntries = $derived(searchQuery.trim() ? searchMatches : entries);
	const selectedEntry = $derived(visibleEntries.find((entry) => entry.path === selectedPath));
	const breadcrumbs = $derived(
		currentPath
			.split('/')
			.filter(Boolean)
			.map((name, index, parts) => ({ name, path: `/${parts.slice(0, index + 1).join('/')}` })),
	);

	async function loadDirectory(path = currentPath, pathToSelect?: string) {
		const revision = ++loadRevision;
		loading = true;
		actionError = '';
		try {
			if (optionalPlaces.has(path) && !(await workspaceService.exists(path))) {
				await workspaceService.createDirectory(path, { actor: 'human', quiet: true });
			}
			const nextEntries = await workspaceService.list(path);
			if (revision !== loadRevision) return;
			entries = nextEntries;
			if (path !== currentPath) {
				searchQuery = '';
				searchMatches = [];
			}
			selectedPath = pathToSelect ?? (path === currentPath ? selectedPath : '');
			currentPath = path;
			finderState.path = path;
			finderState.selectedPath = selectedPath;
			await updateSearch();
		} catch (error) {
			if (revision !== loadRevision) return;
			actionError = error instanceof Error ? error.message : 'The folder could not be opened.';
		} finally {
			if (revision === loadRevision) loading = false;
		}
	}

	async function updateSearch() {
		const revision = ++searchRevision;
		const query = searchQuery.trim();
		const path = currentPath;
		if (!query) {
			searchMatches = [];
			return;
		}
		try {
			const matches = await workspaceService.search(query, path, 50, {
				includeTrash: path === '/Trash' || path.startsWith('/Trash/'),
			});
			if (revision !== searchRevision || path !== currentPath || query !== searchQuery.trim())
				return;
			searchMatches = matches;
		} catch (error) {
			if (revision !== searchRevision || path !== currentPath || query !== searchQuery.trim())
				return;
			searchMatches = [];
			actionError = error instanceof Error ? error.message : 'Search could not finish.';
		}
	}

	function selectEntry(entry: WorkspaceEntry) {
		selectedPath = entry.path;
		finderState.selectedPath = entry.path;
	}

	function openEntry(entry: WorkspaceEntry) {
		if (entry.kind === 'directory') {
			void loadDirectory(entry.path);
			return;
		}

		void revealDesktop({ path: entry.path }).catch((error) => {
			actionError = error instanceof Error ? error.message : 'The file could not be opened.';
		});
	}

	async function openDialog(mode: Exclude<DialogMode, null>) {
		dialogReturnFocus = document.activeElement;
		itemMenu = null;
		dialogMode = mode;
		dialogError = '';
		dialogName =
			mode === 'document' ? 'Untitled.md' : mode === 'rename' ? (selectedEntry?.name ?? '') : '';
		await tick();
		nameInput?.focus();
		nameInput?.select();
	}

	function closeDialog() {
		dialogMode = null;
		dialogError = '';
	}

	$effect(() => {
		const action = finderState.pendingAction;
		if (!action) return;
		finderState.pendingAction = null;
		void openDialog(action === 'new-folder' ? 'folder' : 'document');
	});

	async function submitDialog() {
		const name = dialogName.trim();
		if (!name || name === '.' || name === '..' || name.includes('/')) {
			dialogError = 'Use a name without slashes.';
			return;
		}

		try {
			if (dialogMode === 'folder') {
				const entry = await workspaceService.createDirectory(
					normalizeWorkspacePath(name, currentPath),
					{
						actor: 'human',
					},
				);
				await loadDirectory(currentPath, entry.path);
			} else if (dialogMode === 'document') {
				const path = normalizeWorkspacePath(name, currentPath);
				if (await workspaceService.exists(path)) throw new Error(`${name} already exists.`);
				const entry = await workspaceService.writeText(path, '', { actor: 'human' });
				openEntry(entry);
			} else if (dialogMode === 'rename' && selectedEntry) {
				const destination = normalizeWorkspacePath(name, workspaceDirname(selectedEntry.path));
				const moved = await workspaceService.move(selectedEntry.path, destination, {
					actor: 'human',
				});
				selectEntry(moved);
			}
			closeDialog();
		} catch (error) {
			dialogError = error instanceof Error ? error.message : 'The item could not be created.';
		}
	}

	function duplicateName(entry: WorkspaceEntry, suffix = '') {
		if (entry.kind === 'directory') return `${entry.name} copy${suffix}`;
		const dot = entry.name.lastIndexOf('.');
		if (dot <= 0) return `${entry.name} copy${suffix}`;
		return `${entry.name.slice(0, dot)} copy${suffix}${entry.name.slice(dot)}`;
	}

	async function duplicateEntry(entry = selectedEntry) {
		if (!entry) return;
		try {
			let suffix = '';
			let destination = normalizeWorkspacePath(duplicateName(entry), workspaceDirname(entry.path));
			let copyNumber = 2;
			while (await workspaceService.exists(destination)) {
				suffix = ` ${copyNumber++}`;
				destination = normalizeWorkspacePath(
					duplicateName(entry, suffix),
					workspaceDirname(entry.path),
				);
			}
			const duplicate = await workspaceService.copy(entry.path, destination, { actor: 'human' });
			selectEntry(duplicate);
		} catch (error) {
			actionError = error instanceof Error ? error.message : 'The item could not be duplicated.';
		}
	}

	async function trashEntry(entry = selectedEntry) {
		if (!entry || protectedPaths.has(entry.path)) return;
		try {
			await workspaceService.trash(entry.path, { actor: 'human' });
			selectedPath = '';
			finderState.selectedPath = '';
		} catch (error) {
			actionError =
				error instanceof Error ? error.message : 'The item could not be moved to Trash.';
		}
	}

	function openItemMenu(event: MouseEvent, entry: WorkspaceEntry) {
		event.preventDefault();
		event.stopPropagation();
		selectEntry(entry);
		const rect = finderShell?.getBoundingClientRect();
		const x = Math.min(event.clientX - (rect?.left ?? 0), (rect?.width ?? 400) - 154);
		const y = Math.min(event.clientY - (rect?.top ?? 0), (rect?.height ?? 300) - 190);
		itemMenu = { entry, x: Math.max(8, x), y: Math.max(8, y) };
	}

	function runItemMenuAction(action: (entry: WorkspaceEntry) => void | Promise<void>) {
		const entry = itemMenu?.entry;
		itemMenu = null;
		if (entry) void action(entry);
	}

	function startDrag(event: DragEvent, entry: WorkspaceEntry) {
		nativeDragActive = true;
		draggedPath = entry.path;
		event.dataTransfer?.setData('text/plain', entry.path);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function allowDrop(event: DragEvent, destination: string) {
		if (!draggedPath || destination === draggedPath || destination.startsWith(`${draggedPath}/`))
			return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		dropTarget = destination;
	}

	async function dropInto(event: DragEvent, destinationDirectory: string) {
		event.preventDefault();
		const source = draggedPath || event.dataTransfer?.getData('text/plain') || '';
		draggedPath = '';
		dropTarget = '';
		nativeDragActive = false;
		await moveInto(source, destinationDirectory);
	}

	async function moveInto(source: string, destinationDirectory: string) {
		if (!source || source === destinationDirectory || destinationDirectory.startsWith(`${source}/`))
			return;

		try {
			const destination = normalizeWorkspacePath(workspaceBasename(source), destinationDirectory);
			if (destination === source) return;
			const moved = await workspaceService.move(source, destination, { actor: 'human' });
			if (currentPath === destinationDirectory) selectEntry(moved);
		} catch (error) {
			actionError = error instanceof Error ? error.message : 'The item could not be moved.';
		}
	}

	function startPointerDrag(event: PointerEvent, entry: WorkspaceEntry) {
		if (pointerDrag || event.button !== 0) return;
		pointerDrag = {
			source: entry.path,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			active: false,
		};
	}

	function startMouseDrag(event: MouseEvent, entry: WorkspaceEntry) {
		if (pointerDrag || event.button !== 0) return;
		pointerDrag = {
			source: entry.path,
			pointerId: -1,
			startX: event.clientX,
			startY: event.clientY,
			active: false,
		};
	}

	function updatePointerDrag(event: PointerEvent) {
		if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
		updateDragPosition(event.clientX, event.clientY);
	}

	function updateMouseDrag(event: MouseEvent) {
		if (!pointerDrag || pointerDrag.pointerId !== -1) return;
		updateDragPosition(event.clientX, event.clientY);
	}

	function updateDragPosition(clientX: number, clientY: number) {
		if (!pointerDrag) return;
		const distance = Math.hypot(clientX - pointerDrag.startX, clientY - pointerDrag.startY);
		if (!pointerDrag.active && distance < 6) return;
		pointerDrag.active = true;
		draggedPath = pointerDrag.source;
		const target = document
			.elementFromPoint(clientX, clientY)
			?.closest<HTMLElement>('[data-drop-path]');
		const destination = target?.dataset.dropPath ?? '';
		dropTarget =
			destination &&
			destination !== pointerDrag.source &&
			!destination.startsWith(`${pointerDrag.source}/`)
				? destination
				: '';
	}

	function finishPointerDrag(event: PointerEvent) {
		if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
		commitPointerDrag();
	}

	function finishMouseDrag() {
		if (!pointerDrag || pointerDrag.pointerId !== -1) return;
		commitPointerDrag();
	}

	function commitPointerDrag() {
		if (!pointerDrag) return;
		const { active, source } = pointerDrag;
		const destination = dropTarget;
		pointerDrag = undefined;
		draggedPath = '';
		dropTarget = '';
		if (!active) return;
		suppressNextClick = true;
		setTimeout(() => (suppressNextClick = false));
		void moveInto(source, destination);
	}

	function cancelPointerDrag() {
		pointerDrag = undefined;
		if (nativeDragActive) return;
		draggedPath = '';
		dropTarget = '';
	}

	function finishNativeDrag() {
		nativeDragActive = false;
		cancelPointerDrag();
	}

	function handleSearchKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.stopPropagation();
		searchQuery = '';
		searchMatches = [];
		searchInput?.blur();
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (apps.active !== 'finder' || event.key !== 'Escape') return;
		if (itemMenu) {
			itemMenu = null;
			return;
		}
		if (dialogMode) {
			closeDialog();
			return;
		}
		if (searchQuery) {
			searchQuery = '';
			searchMatches = [];
		}
	}

	onMount(() => {
		const unsubscribeReveal = subscribeToFinderReveal(({ path, selectedPath: pathToSelect }) => {
			void loadDirectory(path, pathToSelect);
		});
		const unsubscribeWorkspace = workspaceService.subscribe(() => void loadDirectory());
		const unsubscribeCommands = subscribeToDesktopCommands(({ target, command }) => {
			if (target !== 'finder') return;
			if (command === 'new-folder') void openDialog('folder');
			if (command === 'new-document') void openDialog('document');
			if (command === 'open' && selectedEntry) openEntry(selectedEntry);
			if (command === 'rename' && selectedEntry) void openDialog('rename');
			if (command === 'duplicate') void duplicateEntry();
			if (command === 'trash') void trashEntry();
			if (command === 'find') searchInput?.focus();
			if (command.startsWith('go-'))
				void loadDirectory(`/${command.slice(3).replace(/^./, (c) => c.toUpperCase())}`);
		});
		void loadDirectory(finderState.path, finderState.selectedPath);
		return () => {
			loadRevision++;
			searchRevision++;
			unsubscribeWorkspace();
			unsubscribeReveal();
			unsubscribeCommands();
		};
	});
</script>

<svelte:window
	onkeydown={handleWindowKeydown}
	onpointermove={updatePointerDrag}
	onpointerup={finishPointerDrag}
	onpointercancel={cancelPointerDrag}
	onmousemove={updateMouseDrag}
	onmouseup={finishMouseDrag}
/>

<section class="finder-shell" class:inactive={apps.active !== 'finder'} bind:this={finderShell}>
	<header class="toolbar app-window-drag-handle" inert={dialogMode !== null}>
		<div class="traffic-space" aria-hidden="true"></div>
		<div class="nav-actions">
			<button
				aria-label="Back to parent folder"
				disabled={currentPath === '/'}
				onclick={() => loadDirectory(workspaceDirname(currentPath))}
				><BackIcon aria-hidden="true" /></button
			>
		</div>
		<nav class="breadcrumbs" aria-label="Current folder">
			{#each breadcrumbs as crumb, index (crumb.path)}
				{#if index > 0}<span>/</span>{/if}
				<button onclick={() => loadDirectory(crumb.path)}>{crumb.name}</button>
			{/each}
		</nav>
		<div class="toolbar-actions">
			<button aria-label="New folder" title="New folder" onclick={() => openDialog('folder')}
				><NewFolderIcon aria-hidden="true" /></button
			>
			<button aria-label="New document" title="New document" onclick={() => openDialog('document')}
				><NewFileIcon aria-hidden="true" /></button
			>
			<label class="search">
				<SearchIcon aria-hidden="true" />
				<input
					aria-label="Search this folder"
					placeholder="Search"
					bind:this={searchInput}
					bind:value={searchQuery}
					oninput={updateSearch}
					onkeydown={handleSearchKeydown}
				/>
			</label>
		</div>
	</header>

	<div class="finder-body">
		<aside inert={dialogMode !== null}>
			<p>Favorites</p>
			{#each places as place (place.path)}
				<button
					data-drop-path={place.path}
					class:active={currentPath.startsWith(place.path)}
					class:drop-target={dropTarget === place.path}
					onclick={() => loadDirectory(place.path)}
					ondragover={(event) => allowDrop(event, place.path)}
					ondragleave={() => (dropTarget = '')}
					ondrop={(event) => dropInto(event, place.path)}
				>
					<place.icon aria-hidden="true" />{place.label}
				</button>
			{/each}
		</aside>

		<main inert={dialogMode !== null}>
			<div class="column-head"><span>Name</span><span>Date Modified</span><span>Size</span></div>
			<div
				class="file-list"
				class:drop-target={dropTarget === currentPath}
				data-testid="finder-list"
				role="listbox"
				tabindex="0"
				aria-label={`Files in ${currentPath}`}
				data-drop-path={currentPath}
				ondragover={(event) => allowDrop(event, currentPath)}
				ondragleave={() => (dropTarget = '')}
				ondrop={(event) => dropInto(event, currentPath)}
			>
				{#if loading}
					<p class="empty">Loading workspace…</p>
				{:else if visibleEntries.length === 0}
					<p class="empty">
						{searchQuery ? 'No matches in this folder.' : 'This folder is empty.'}
					</p>
				{:else}
					{#each visibleEntries as entry (entry.path)}
						<button
							class="file-row"
							class:selected={selectedPath === entry.path}
							class:drop-target={dropTarget === entry.path}
							data-path={entry.path}
							data-drop-path={entry.kind === 'directory' ? entry.path : undefined}
							role="option"
							aria-selected={selectedPath === entry.path}
							aria-grabbed={pointerDrag?.active && pointerDrag.source === entry.path}
							draggable="true"
							onclick={() => {
								if (suppressNextClick) {
									suppressNextClick = false;
									return;
								}
								selectEntry(entry);
							}}
							ondblclick={() => openEntry(entry)}
							onkeydown={(event) => {
								if (event.key === 'Enter') {
									event.preventDefault();
									openEntry(entry);
								}
							}}
							oncontextmenu={(event) => openItemMenu(event, entry)}
							onpointerdown={(event) => startPointerDrag(event, entry)}
							onmousedown={(event) => startMouseDrag(event, entry)}
							ondragstart={(event) => startDrag(event, entry)}
							ondragend={finishNativeDrag}
							ondragover={(event) => entry.kind === 'directory' && allowDrop(event, entry.path)}
							ondrop={(event) => entry.kind === 'directory' && dropInto(event, entry.path)}
						>
							<span class="name"
								><span class:folder={entry.kind === 'directory'} class="file-icon">
									{#if entry.kind === 'directory'}<FolderIcon aria-hidden="true" />{:else}<FileIcon
											aria-hidden="true"
										/>{/if}</span
								><span class="file-name">{entry.name}</span></span
							>
							<time datetime={entry.modifiedAt}
								>{new Date(entry.modifiedAt).toLocaleDateString([], {
									month: 'short',
									day: 'numeric',
									year: 'numeric',
								})}</time
							>
							<span
								>{entry.kind === 'directory'
									? '—'
									: `${Math.max(1, Math.ceil(entry.size / 1024))} KB`}</span
							>
						</button>
					{/each}
				{/if}
			</div>
			<footer class:error={actionError}>
				{actionError ||
					`${visibleEntries.length} ${visibleEntries.length === 1 ? 'item' : 'items'}`}
			</footer>
		</main>
	</div>

	{#if itemMenu}
		<button class="context-backdrop" aria-label="Close item menu" onclick={() => (itemMenu = null)}
		></button>
		<div class="item-menu" role="menu" style:left={`${itemMenu.x}px`} style:top={`${itemMenu.y}px`}>
			<button onclick={() => runItemMenuAction(openEntry)}>Open</button>
			<button
				onclick={() => openDialog('rename')}
				disabled={protectedPaths.has(itemMenu.entry.path)}>Rename…</button
			>
			<button onclick={() => runItemMenuAction(duplicateEntry)}>Duplicate</button>
			<button
				onclick={() => runItemMenuAction(trashEntry)}
				disabled={protectedPaths.has(itemMenu.entry.path)}>Move to Trash</button
			>
		</div>
	{/if}

	{#if dialogMode}
		<WindowSheet
			labelledby="finder-name-title"
			returnFocus={dialogReturnFocus}
			onclose={closeDialog}
			--sheet-width="360px"
		>
			<form
				onsubmit={(event) => {
					event.preventDefault();
					void submitDialog();
				}}
			>
				<h2 id="finder-name-title">
					{dialogMode === 'rename'
						? 'Rename item'
						: dialogMode === 'folder'
							? 'New folder'
							: 'New document'}
				</h2>
				<label>
					Name
					<input
						bind:this={nameInput}
						bind:value={dialogName}
						aria-invalid={Boolean(dialogError)}
					/>
				</label>
				{#if dialogError}<p class="sheet-error" role="alert">{dialogError}</p>{/if}
				<footer>
					<button type="button" onclick={closeDialog}>Cancel</button>
					<button type="submit" class="primary"
						>{dialogMode === 'rename' ? 'Rename' : 'Create'}</button
					>
				</footer>
			</form>
		</WindowSheet>
	{/if}
</section>

<style>
	.finder-shell {
		display: grid;
		container-type: inline-size;
		grid-template: var(--app-titlebar-height) minmax(0, 1fr) / minmax(0, 1fr);
		height: 100%;
		min-width: 0;
		position: relative;
		overflow: hidden;
		border-radius: inherit;
		background: var(--app-surface);
		color: var(--app-text);
	}

	.finder-body {
		display: grid;
		grid-template-columns: 12.5rem minmax(0, 1fr);
		min-height: 0;
	}

	.toolbar {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0 0.75rem;
		border-bottom: 1px solid var(--app-border);
		background: var(--app-chrome);
		backdrop-filter: blur(22px);
	}
	.traffic-space {
		width: 4rem;
		flex: none;
	}
	.nav-actions button,
	.toolbar-actions > button {
		min-width: 1.8rem;
		height: var(--app-control-height);
		border-radius: var(--app-control-radius);
		font-size: 1.2rem;
	}
	.nav-actions button:hover:not(:disabled),
	.toolbar-actions > button:hover {
		background: var(--app-hover);
	}
	.nav-actions button:disabled {
		opacity: 0.3;
	}
	.breadcrumbs {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
		overflow: hidden;
	}
	.breadcrumbs button {
		font-size: 0.82rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.breadcrumbs span {
		color: var(--app-text-tertiary);
	}
	.toolbar :global(svg),
	.file-icon :global(svg) {
		width: 18px;
		height: 18px;
		flex: none;
	}
	.toolbar-actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.search {
		display: flex;
		align-items: center;
		width: 9.5rem;
		height: var(--app-control-height);
		padding: 0 0.45rem;
		border: 1px solid var(--app-control-border);
		border-radius: var(--app-control-radius);
		background: var(--app-field);
	}
	.search:focus-within {
		outline: 2px solid var(--app-focus);
		outline-offset: 1px;
	}
	.search :global(svg) {
		width: 14px;
		height: 14px;
		color: var(--app-text-secondary);
	}
	.search input:focus-visible {
		outline: none;
	}
	.search input {
		width: 100%;
		border: 0;
		background: transparent;
		font: inherit;
		font-size: 0.78rem;
	}

	aside {
		padding: 0.9rem 0.55rem;
		background: var(--app-sidebar);
		border-right: 1px solid var(--app-border);
	}
	aside > p {
		margin: 0 0.55rem 0.4rem;
		color: var(--app-text-secondary);
		font-size: 0.7rem;
		font-weight: 600;
	}
	aside > button {
		justify-content: flex-start;
		gap: 0.55rem;
		width: 100%;
		padding: 0.42rem 0.6rem;
		border-radius: 0.38rem;
		font-size: 0.82rem;
	}
	aside > button :global(svg) {
		width: 17px;
		height: 17px;
		flex: none;
		color: var(--app-accent);
		font-size: 1rem;
	}
	aside > button.active {
		background: var(--app-hover);
		font-weight: 600;
	}
	aside > button.drop-target {
		box-shadow: inset 0 0 0 2px var(--app-accent);
		background: var(--app-selection);
	}
	main {
		min-height: 0;
		min-width: 0;
		display: grid;
		grid-template-rows: 1.8rem minmax(0, 1fr) 1.65rem;
		background: var(--app-surface);
	}
	.column-head,
	.file-row {
		display: grid;
		grid-template-columns: minmax(12rem, 1fr) 9rem 4rem;
		align-items: center;
	}
	.column-head {
		padding: 0 0.75rem;
		color: var(--app-text-secondary);
		border-bottom: 1px solid var(--app-border);
		font-size: 0.7rem;
	}
	.file-list {
		overflow: auto;
		padding: 0.2rem 0.45rem;
		border: 2px solid transparent;
	}
	.file-list.drop-target {
		border-color: var(--app-accent);
		background: var(--app-selection);
	}
	.file-row {
		width: 100%;
		min-height: 2.05rem;
		padding: 0 0.35rem;
		border-radius: 0.3rem;
		text-align: left;
		font-size: 0.78rem;
	}
	.file-row:nth-child(even) {
		background: var(--app-surface-secondary);
	}
	.file-row.selected {
		background: var(--app-selection-strong);
		color: var(--app-selection-text);
	}
	.file-row.drop-target {
		box-shadow: inset 0 0 0 2px var(--app-accent);
	}
	.file-row > time,
	.file-row > span:last-child {
		color: var(--app-text-secondary);
	}
	.file-row.selected > time,
	.file-row.selected > span:last-child {
		color: inherit;
	}
	.name {
		display: flex;
		gap: 0.55rem;
		align-items: center;
		min-width: 0;
	}
	.file-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.inactive .file-row.selected {
		background: var(--app-hover);
		color: var(--app-text);
	}
	.file-row.selected .file-icon {
		color: inherit;
	}
	.file-icon {
		display: flex;
		flex: none;
		color: var(--app-text-tertiary);
		font-size: 1.05rem;
	}
	.file-icon.folder {
		color: var(--app-accent);
	}
	.empty {
		margin: 2rem;
		text-align: center;
		color: var(--app-text-secondary);
		font-size: 0.8rem;
	}
	main > footer {
		padding: 0.3rem 0.75rem;
		border-top: 1px solid var(--app-border);
		color: var(--app-text-secondary);
		font-size: 0.68rem;
	}
	main > footer.error {
		color: var(--app-danger);
	}

	.sheet-error {
		margin: 4px 0 0;
		color: var(--app-danger);
		font-size: 12px;
	}

	.context-backdrop {
		position: absolute;
		inset: 0;
		z-index: 5;
		width: 100%;
		height: 100%;
		border-radius: 0;
		background: transparent;
	}
	.item-menu {
		position: absolute;
		z-index: 6;
		width: 9.5rem;
		padding: 0.35rem;
		border: 1px solid var(--app-border);
		border-radius: 0.48rem;
		background: var(--app-chrome);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.24);
	}
	.item-menu button {
		width: 100%;
		justify-content: flex-start;
		padding: 0.35rem 0.45rem;
		border-radius: var(--app-control-radius);
		font-size: 0.78rem;
	}
	.item-menu button:not(:disabled):hover,
	.item-menu button:not(:disabled):focus-visible {
		background: var(--app-selection-strong);
		color: var(--app-selection-text);
	}
	.item-menu button:disabled {
		opacity: 0.4;
	}

	@container (max-width: 560px) {
		.finder-body {
			grid-template-columns: 1fr;
		}
		aside {
			display: none;
		}
		.search,
		.column-head span:not(:first-child),
		.file-row > :not(.name) {
			display: none;
		}
		.column-head,
		.file-row {
			grid-template-columns: 1fr;
		}
		.traffic-space {
			width: 4rem;
		}
		.toolbar {
			gap: 0.25rem;
			padding-right: 0.4rem;
		}
		.toolbar-actions {
			gap: 0.15rem;
		}
	}
</style>
