<script lang="ts">
	import { AppError } from '🍎/lib/errors';
	import { connectAppNavigation } from '🍎/lib/desktop/navigation';

	import WindowSheet from '🍎/components/SystemUI/WindowSheet.svelte';
	import { onMount, tick } from 'svelte';
	import FolderIcon from '~icons/mdi/folder-open-outline';
	import ListIcon from '~icons/mdi/playlist-plus';
	import TaskIcon from '~icons/mdi/checkbox-marked-outline';
	import {
		tasksService,
		isTasksPath,
		type Task,
		type TaskStatus,
		type TaskInput,
	} from '🍎/lib/tasks/tasks';
	import { workspaceService } from '🍎/lib/workspace/workspace';
	import { workspaceBasename, workspaceDirname } from '🍎/lib/workspace/path';
	import { revealDesktop } from '🍎/lib/desktop/files';
	import { subscribeToDesktopCommands } from '🍎/lib/desktop/commands';
	import { connectTasksContext } from '🍎/lib/workspace/interaction-context';

	type Draft = {
		id: string | null;
		title: string;
		status: TaskStatus;
		dueDate: string;
		notes: string;
		sourcePath: string;
		outputPath: string;
	};
	const taskDocument = tasksService.document;
	const statuses: Array<{ id: TaskStatus; label: string }> = [
		{ id: 'todo', label: 'To do' },
		{ id: 'in-progress', label: 'In progress' },
		{ id: 'done', label: 'Done' },
	];
	let record = $state.raw(taskDocument.snapshot());
	let filter = $state<'all' | TaskStatus>('all');
	let draft = $state<Draft | null>(null);
	let draftPath = $state('');
	let draftRevision = $state('');
	let baseDraft = $state('');
	let working = $state(false);
	let error = $state('');
	let notice = $state('');
	let dialog = $state<'open' | 'new-list' | null>(null);
	let dialogOpener = $state.raw<Element | null>(null);
	let destination = $state('');
	let listTitle = $state('');
	let listPaths = $state.raw<string[]>([]);
	let titleInput: HTMLInputElement | undefined;
	let active = true;
	const busy = $derived(working || record.loading);
	const dirty = $derived(draft !== null && JSON.stringify(draft) !== baseDraft);
	const stale = $derived(
		draft !== null && (record.path !== draftPath || record.revision !== draftRevision),
	);
	const tasks = $derived(record.data?.tasks || []);
	const visibleTasks = $derived(
		filter === 'all' ? tasks : tasks.filter((task) => task.status === filter),
	);
	const completed = $derived(tasks.filter((task) => task.status === 'done').length);
	const statusLabel = (status: TaskStatus) => statuses.find((item) => item.id === status)!.label;
	const dueLabel = (date: string | null) =>
		date
			? new Date(`${date}T12:00:00`).toLocaleDateString([], {
					month: 'short',
					day: 'numeric',
					year: 'numeric',
				})
			: '—';

	function loadDraft(task: Task | null, path = record.path, revision = record.revision) {
		if (!path || !revision) {
			draft = null;
			baseDraft = '';
			return;
		}
		draftPath = path;
		draftRevision = revision;
		draft = task
			? {
					id: task.id,
					title: task.title,
					status: task.status,
					dueDate: task.dueDate || '',
					notes: task.notes,
					sourcePath: task.sourcePath || '',
					outputPath: task.outputPath || '',
				}
			: {
					id: null,
					title: '',
					status: 'todo',
					dueDate: '',
					notes: '',
					sourcePath: '',
					outputPath: '',
				};
		baseDraft = JSON.stringify(draft);
	}
	function refresh() {
		const next = taskDocument.snapshot();
		const preserveDraft = dirty || working;
		const previousPath = record.path;
		record = next;
		if (preserveDraft) return;
		if (!next.data || !next.path || !next.revision) {
			draft = null;
			baseDraft = '';
			return;
		}
		if (draft?.id && previousPath === next.path) {
			const updated = next.data.tasks.find((task) => task.id === draft!.id);
			if (updated) {
				loadDraft(updated, next.path, next.revision);
				return;
			}
		}
		if (draft && draft.id === null && previousPath === next.path) {
			draftRevision = next.revision;
			return;
		}
		if (next.data.tasks[0]) loadDraft(next.data.tasks[0], next.path, next.revision);
		else {
			draft = null;
			baseDraft = '';
		}
	}
	function refreshFiles() {
		listPaths = workspaceService
			.getAllPaths()
			.filter((path) => isTasksPath(path) && !/^\/(System|Trash)\//.test(path))
			.sort((a, b) => a.localeCompare(b));
	}
	function guardNavigation() {
		if (!dirty) return true;
		error = 'Save or discard your task edits before choosing another task or list.';
		return false;
	}
	function chooseTask(task: Task) {
		if (busy || (draft?.id === task.id && draftPath === record.path) || !guardNavigation()) return;
		error = '';
		notice = '';
		loadDraft(task);
	}
	async function newTask() {
		if (busy || !guardNavigation() || !record.data || !record.path || !record.revision) return;
		error = '';
		notice = '';
		filter = 'all';
		loadDraft(null);
		await tick();
		titleInput?.focus();
	}
	function discardDraft() {
		if (busy) return;
		error = '';
		notice = '';
		const task =
			draftPath === record.path && draft?.id
				? tasks.find((task) => task.id === draft!.id)
				: undefined;
		if (task) loadDraft(task);
		else {
			draft = null;
			baseDraft = '';
			refresh();
		}
	}
	async function perform(action: () => Promise<void>, fallback: string) {
		if (working) return;
		working = true;
		error = '';
		notice = '';
		try {
			await action();
		} catch (cause) {
			if (active) error = cause instanceof Error ? cause.message : fallback;
		} finally {
			if (active) {
				working = false;
				refresh();
			}
		}
	}
	async function saveTask() {
		const current = draft;
		if (!current || busy || record.error) return;
		if (stale) {
			error =
				'The list changed while you were editing. Copy the edits you want to keep, then discard and reload the saved task.';
			return;
		}
		if (!current.title.trim()) {
			error = 'Give this task a title.';
			titleInput?.focus();
			return;
		}
		const path = draftPath,
			revision = draftRevision;
		const input: TaskInput = {
			title: current.title.trim(),
			status: current.status,
			dueDate: current.dueDate || null,
			notes: current.notes,
			sourcePath: current.sourcePath.trim() || null,
			outputPath: current.outputPath.trim() || null,
		};
		await perform(async () => {
			const result = current.id
				? await tasksService.update(path, current.id, revision, input, { actor: 'human' })
				: await tasksService.create(path, input, { expectedRevision: revision, actor: 'human' });
			if (!active) return;
			if (result.task) loadDraft(result.task, result.path, result.revision);
			notice = 'Task saved';
		}, 'This task could not be saved. Your draft is unchanged.');
	}
	async function deleteTask() {
		const current = draft;
		if (!current?.id || busy || dirty || stale || record.error) return;
		await perform(async () => {
			await tasksService.update(
				draftPath,
				current.id,
				draftRevision,
				{},
				{ remove: true, actor: 'human' },
			);
			if (!active) return;
			draft = null;
			baseDraft = '';
			notice = 'Task deleted. Review the previous list version in Activity to recover it.';
		}, 'This task could not be deleted.');
	}
	async function reveal(path: string) {
		if (!path.trim() || busy) return;
		await perform(async () => {
			await revealDesktop({ path: path.trim() });
		}, 'The linked file could not be opened.');
	}
	function showDialog(next: 'open' | 'new-list') {
		if (busy || !guardNavigation()) return;
		dialogOpener = document.activeElement;
		error = '';
		notice = '';
		refreshFiles();
		listTitle = 'Untitled List';
		destination =
			next === 'open'
				? record.path || ''
				: `${workspaceDirname(record.path || '/Documents/My tasks.tasks.json')}/Untitled.tasks.json`;
		dialog = next;
	}
	async function openList(path: string) {
		if (busy || !guardNavigation()) return;
		await perform(async () => {
			await taskDocument.open(path.trim());
			if (active) {
				draft = null;
				baseDraft = '';
				dialog = null;
				filter = 'all';
			}
		}, 'This list could not be opened.');
	}
	async function submitList(event: SubmitEvent) {
		event.preventDefault();
		if (dialog === 'open') {
			await openList(destination);
			return;
		}
		if (busy) return;
		await perform(async () => {
			const path = destination.trim();
			await taskDocument.write(
				path,
				{ format: 'webmcp-tasks', version: 1, title: listTitle.trim(), tasks: [] },
				undefined,
				true,
				'human',
			);
			await taskDocument.open(path);
			if (active) {
				draft = null;
				baseDraft = '';
				dialog = null;
				filter = 'all';
			}
		}, 'The task list could not be created.');
	}
	function attachTitle(node: HTMLInputElement) {
		titleInput = node;
		return () => {
			titleInput = undefined;
		};
	}
	onMount(() => {
		const disconnectContext = connectTasksContext(() => {
			const selected =
				draftPath === record.path && draft?.id ? tasks.find((task) => task.id === draft.id) : null;
			return {
				path: record.path,
				revision: record.revision,
				selectedTaskId: selected?.id ?? null,
				selectedTaskTitle: selected?.title ?? null,
				filter,
				draft: draft
					? { dirty, stale, isNew: draft.id === null, path: draftPath, baseRevision: draftRevision }
					: null,
				busy,
				dialog,
			};
		});
		refresh();
		refreshFiles();
		const unsubscribe = taskDocument.subscribe(refresh);
		const unsubscribeFiles = workspaceService.subscribe(refreshFiles);
		const clearCloseGuard = taskDocument.setCloseGuard(() => {
			if (!dirty && !working) return true;
			error = working
				? 'Wait for the current operation to finish, then save or discard edits before closing Tasks.'
				: 'Save or discard your task edits before closing Tasks.';
			return false;
		});
		const clearPendingGuard = taskDocument.setPendingGuard(
			(path) => (dirty && draftPath === path) || (working && record.path === path),
		);
		const unsubscribeCommands = subscribeToDesktopCommands(({ target, command }) => {
			if (target !== 'tasks' || busy || dialog) return;
			if (command === 'open') showDialog('open');
			if (command === 'new-document') showDialog('new-list');
			if (command === 'save') void saveTask();
		});
		void taskDocument.ensure().catch((cause) => {
			if (active) error = cause instanceof Error ? cause.message : 'Tasks could not open.';
		});
		return () => {
			active = false;
			disconnectContext();
			unsubscribe();
			unsubscribeFiles();
			unsubscribeCommands();
			clearCloseGuard();
			clearPendingGuard();
		};
	});
	onMount(() =>
		connectAppNavigation('tasks', {
			ready: () => !record.loading,
			read: () => ({
				path: record.path,
				taskId: draft?.id ?? null,
				filter,
				visibleTaskIds: visibleTasks.map((task) => task.id),
				busy,
			}),
			navigate: ({ taskId, filter: nextFilter }) => {
				if (busy || !guardNavigation())
					throw new AppError('UNSAVED_EDITS', error || 'Wait for Tasks to finish loading.');
				const task = taskId === undefined ? undefined : tasks.find((item) => item.id === taskId);
				if (taskId !== undefined && !task)
					throw new AppError(
						'TASK_NOT_FOUND',
						'Read this task list to choose an existing task ID.',
					);
				if (task && nextFilter && nextFilter !== 'all' && task.status !== nextFilter)
					throw new AppError('INVALID_INPUT', 'The selected task does not match this filter.');
				if (nextFilter !== undefined) filter = nextFilter;
				else if (task && filter !== 'all' && task.status !== filter) filter = 'all';
				if (task) chooseTask(task);
			},
		}),
	);
</script>

<section class="tasks-shell" aria-label="Tasks">
	<div class="app-content" inert={dialog !== null}>
		<header class="titlebar app-window-drag-handle">
			<div class="traffic-space" aria-hidden="true"></div>
			<h1 title={record.path || 'Tasks'}>{record.data?.title || 'Tasks'}</h1>
			<span class="save-status" role="status">{busy ? 'Working…' : dirty ? 'Edited' : 'Saved'}</span
			>
		</header>
		<nav class="toolbar" aria-label="Task actions">
			<button disabled={busy || dirty} onclick={() => showDialog('open')}
				><FolderIcon aria-hidden="true" width="17" height="17" /><span>Open</span></button
			><span class="divider" aria-hidden="true"></span><button
				disabled={busy || dirty}
				onclick={() => showDialog('new-list')}
				><ListIcon aria-hidden="true" width="17" height="17" /><span>New List</span></button
			><button disabled={busy || dirty || !record.data || !!record.error} onclick={newTask}
				><TaskIcon aria-hidden="true" width="17" height="17" /><span>New Task</span></button
			>
		</nav>
		<div class="list-heading">
			<nav class="filters" aria-label="Task status filters">
				<button
					class={{ active: filter === 'all' }}
					aria-pressed={filter === 'all'}
					onclick={() => (filter = 'all')}>All</button
				>{#each statuses as item (item.id)}<button
						class={{ active: filter === item.id }}
						aria-pressed={filter === item.id}
						onclick={() => (filter = item.id)}>{item.label}</button
					>{/each}
			</nav>
		</div>
		{#if error || record.error}<p class="error-banner" role="alert">
				{error || record.error}
			</p>{:else if record.warning}<p class="warning-banner" role="status">{record.warning}</p>{/if}
		{#if dirty && !stale}<p class="draft-notice" role="status">
				You have unsaved edits. Save or discard them before changing tasks or lists.
			</p>{/if}
		<div class="workspace-content">
			<div class="task-list" data-testid="task-list" aria-label="Task list" aria-busy={busy}>
				{#each visibleTasks as task (task.id)}<button
						class={['task-row', { selected: draft?.id === task.id && draftPath === record.path }]}
						data-task-id={task.id}
						aria-pressed={draft?.id === task.id && draftPath === record.path}
						disabled={busy || (dirty && draft?.id !== task.id)}
						onclick={() => chooseTask(task)}
						><span class={['task-mark', task.status]} aria-hidden="true"
							>{task.status === 'done' ? '✓' : task.status === 'in-progress' ? '•' : ''}</span
						><strong>{task.title}</strong><span class="task-status">{statusLabel(task.status)}</span
						><time class="task-date" datetime={task.dueDate || undefined}
							>{dueLabel(task.dueDate)}</time
						></button
					>{:else}<p class="empty">
						{record.loading
							? 'Opening task list…'
							: !record.data
								? 'Open a task list to begin.'
								: tasks.length
									? 'No tasks in this view.'
									: 'No tasks yet. Add a task to get started.'}
					</p>{/each}
			</div>
			{#if draft}<form
					class="inspector"
					aria-label="Task details"
					onsubmit={(event) => {
						event.preventDefault();
						void saveTask();
					}}
				>
					<div class="inspector-heading">
						<strong>{draft.id ? 'Task details' : 'New task'}</strong><span
							>{dirty ? 'Unsaved changes' : ''}</span
						>
					</div>
					{#if stale}<div class="stale-notice" role="alert">
							<strong>The saved list changed.</strong>
							<p>
								Your draft is still here. Copy the edits you want to keep, then reload the saved
								task.
							</p>
							{#if draftPath !== record.path}<code>Draft from {draftPath}</code>{/if}
						</div>{/if}
					<label class="field"
						>Title<input
							bind:value={draft.title}
							disabled={busy}
							maxlength="200"
							required
							{@attach attachTitle}
						/></label
					>
					<div class="field-pair">
						<label class="field"
							>Status<select bind:value={draft.status} disabled={busy}
								>{#each statuses as item (item.id)}<option value={item.id}>{item.label}</option
									>{/each}</select
							></label
						><label class="field"
							>Due date<input type="date" bind:value={draft.dueDate} disabled={busy} /></label
						>
					</div>
					<label class="field"
						>Notes<textarea bind:value={draft.notes} disabled={busy} maxlength="5000" rows="3"
						></textarea></label
					>
					<div class="linked-field">
						<label class="field"
							>Source file<input
								bind:value={draft.sourcePath}
								disabled={busy}
								maxlength="2048"
								placeholder="/Projects/Launch/notes.md"
								spellcheck="false"
							/></label
						><button
							class="file-link"
							type="button"
							disabled={busy || !draft.sourcePath.trim()}
							onclick={() => reveal(draft!.sourcePath)}>Open source</button
						>
					</div>
					<div class="linked-field">
						<label class="field"
							>Output file<input
								bind:value={draft.outputPath}
								disabled={busy}
								maxlength="2048"
								placeholder="/Documents/Report.odt"
								spellcheck="false"
							/></label
						><button
							class="file-link"
							type="button"
							disabled={busy || !draft.outputPath.trim()}
							onclick={() => reveal(draft!.outputPath)}>Open output</button
						>
					</div>
					<p class="hint">
						File links are optional. Link an existing source or completed output from this
						workspace.
					</p>
					<div class="inspector-actions">
						{#if draft.id}<button
								class="delete"
								type="button"
								disabled={busy || dirty || stale || !!record.error}
								onclick={deleteTask}>Delete Task</button
							>{/if}<span></span>{#if dirty || stale || !draft.id}<button
								class="standard"
								type="button"
								disabled={busy}
								onclick={discardDraft}>{stale ? 'Discard & Reload' : 'Discard Changes'}</button
							>{/if}<button
							class="primary"
							type="submit"
							disabled={busy || stale || !!record.error || (!dirty && !!draft.id)}
							>{busy ? 'Saving…' : 'Save Task'}</button
						>
					</div>
				</form>{:else if record.data && tasks.length}<p class="inspector-empty">
					Select a task to view its details.
				</p>{/if}
		</div>
		<footer class="statusbar">
			<span role="status"
				>{notice ||
					`${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} · ${completed} done`}</span
			>
		</footer>
	</div>
	{#if dialog}<WindowSheet
			labelledby="tasks-dialog-title"
			{busy}
			returnFocus={dialogOpener}
			onclose={() => (dialog = null)}
			--sheet-width="450px"
			--sheet-padding="18px"
			--sheet-backdrop-padding="16px 12px"
		>
			<form onsubmit={submitList}>
				<h2 id="tasks-dialog-title">
					{dialog === 'open' ? 'Open a task list' : 'New task list'}
				</h2>
				<div class="sheet-body">
					{#if dialog === 'new-list'}<label
							>List title<input
								bind:value={listTitle}
								required
								maxlength="120"
								disabled={busy}
							/></label
						>{/if}<label
						>Workspace path<input
							bind:value={destination}
							required
							maxlength="2048"
							disabled={busy}
							spellcheck="false"
							placeholder="/Projects/Launch/launch.tasks.json"
						/></label
					>
					<p class="hint">
						{dialog === 'new-list'
							? 'Creates an empty .tasks.json file. Existing files are never replaced.'
							: 'Choose a .tasks.json file from the shared workspace.'}
					</p>
					{#if dialog === 'open'}<div class="file-list">
							{#each listPaths as path (path)}<button
									type="button"
									disabled={busy}
									onclick={() => openList(path)}
									><strong>{workspaceBasename(path)}</strong><small>{workspaceDirname(path)}</small
									></button
								>{:else}<p class="empty">No task lists found.</p>{/each}
						</div>{/if}{#if error}<p class="dialog-error" role="alert">
							{error}
						</p>{/if}
				</div>
				<footer>
					<button class="standard" type="button" disabled={busy} onclick={() => (dialog = null)}
						>Cancel</button
					><button class="primary" type="submit" disabled={busy}
						>{busy ? 'Working…' : dialog === 'open' ? 'Open' : 'Create List'}</button
					>
				</footer>
			</form>
		</WindowSheet>{/if}
</section>

<style>
	.tasks-shell {
		height: 100%;
		position: relative;
		overflow: hidden;
		border-radius: inherit;
		background: var(--app-surface);
		color: var(--app-text);
		font-family: var(--system-font-family);
		container-type: inline-size;
	}
	.app-content {
		height: 100%;
		display: flex;
		flex-direction: column;
	}
	.titlebar {
		display: flex;
		align-items: center;
		height: var(--app-titlebar-height);
		flex: none;
		background: var(--app-chrome);
		padding-right: 15px;
		border-bottom: 1px solid var(--app-border);
	}
	.traffic-space {
		width: 77px;
		flex: none;
	}
	.titlebar > h1 {
		flex: 1;
		min-width: 0;
		margin: 0 12px;
		text-align: center;
		font-size: 13px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.save-status {
		width: 62px;
		font-size: 10px;
		text-align: right;
		color: var(--app-text-tertiary);
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		min-height: 37px;
		background: var(--app-toolbar);
		border-bottom: 1px solid var(--app-border);
		flex: none;
	}
	button {
		font: inherit;
		font-size: 12px;
		color: inherit;
		background: transparent;
		border: 0;
		border-radius: var(--app-control-radius);
		padding: 5px 8px;
		cursor: default;
	}
	button:hover:not(:disabled) {
		background: var(--app-hover);
	}
	button:disabled {
		opacity: 0.45;
	}
	button:focus-visible,
	input:focus-visible,
	select:focus-visible,
	textarea:focus-visible {
		outline: 2px solid var(--app-focus);
		outline-offset: 2px;
	}
	.toolbar button {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: var(--app-control-height);
		padding: 4px 8px;
		font-size: 12px;
	}
	.divider {
		width: 1px;
		height: 18px;
		background: var(--app-border);
		margin-inline: 4px;
	}
	.list-heading {
		padding: 8px 14px;
		flex: none;
		background: var(--app-toolbar);
		border-bottom: 1px solid var(--app-border);
	}
	.filters {
		display: inline-flex;
		padding: 2px;
		gap: 2px;
		background: var(--app-hover);
		border-radius: var(--app-control-radius);
		overflow: hidden;
	}
	.filters button {
		font-size: 11px;
		border-radius: 4px;
		padding: 3px 12px;
		min-height: 23px;
		color: var(--app-text-secondary);
	}
	.filters button.active {
		background: var(--app-control);
		color: var(--app-text);
		box-shadow: 0 1px 3px #0002;
	}
	.error-banner,
	.warning-banner,
	.draft-notice {
		margin: 0;
		padding: 8px 14px;
		flex: none;
		font-size: 11px;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.error-banner {
		background: var(--app-danger-bg);
		color: var(--app-danger);
		border-bottom: 1px solid var(--app-border);
	}
	.warning-banner {
		background: var(--app-warning-bg);
		color: var(--app-warning);
	}
	.draft-notice {
		background: var(--app-info-bg);
		color: var(--app-info);
		border-bottom: 1px solid var(--app-border);
	}
	.workspace-content {
		min-height: 0;
		flex: 1;
		overflow: auto;
	}
	.task-list {
		max-height: 260px;
		min-height: 75px;
		overflow: auto;
		background: var(--app-surface);
	}
	.task-row {
		display: grid;
		grid-template-columns: 23px minmax(0, 1fr) 84px 93px;
		align-items: center;
		gap: 13px;
		width: 100%;
		border-radius: 0;
		padding: 13px 20px;
		border-bottom: 1px solid var(--app-border);
		text-align: left;
	}
	.task-row.selected {
		background: var(--app-selection);
	}
	.task-row strong {
		font-size: 12px;
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	.task-mark {
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		box-sizing: border-box;
		border: 1px solid var(--app-control-border);
		border-radius: 50%;
		color: var(--app-text-secondary);
	}
	.task-mark.in-progress {
		border-color: var(--app-accent);
		color: var(--app-accent);
		font-size: 23px;
		line-height: 1;
	}
	.task-mark.done {
		border-color: var(--app-success);
		background: var(--app-success);
		color: var(--app-surface);
		font-size: 12px;
	}
	.task-status,
	.task-date {
		font-size: 10px;
		color: var(--app-text-secondary);
	}
	.task-date {
		text-align: right;
	}
	.empty {
		margin: 0;
		padding: 25px 16px;
		text-align: center;
		font-size: 12px;
		color: var(--app-text-secondary);
		line-height: 1.5;
	}
	.inspector {
		border-top: 1px solid var(--app-border);
		background: var(--app-surface-secondary);
		padding: 17px 20px 20px;
	}
	.inspector-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 13px;
	}
	.inspector-heading strong {
		font-size: 12px;
		font-weight: 600;
	}
	.inspector-heading span {
		font-size: 10px;
		color: var(--app-text-tertiary);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 11px;
		margin-bottom: 12px;
		min-width: 0;
	}
	.field input,
	.field select,
	.field textarea {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		font-size: 12px;
		color: var(--app-text);
		background: var(--app-field);
		border: 1px solid var(--app-control-border);
		border-radius: var(--app-control-radius);
		padding: 7px 9px;
		min-width: 0;
	}
	.field textarea {
		resize: vertical;
		line-height: 1.5;
		min-height: 65px;
	}
	.field-pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}
	.linked-field {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.linked-field .field {
		flex: 1;
	}
	.file-link {
		font-size: 11px;
		color: var(--app-accent);
		margin-top: 9px;
		padding: 3px 0;
		flex: none;
	}
	.file-link:hover:not(:disabled) {
		background: transparent;
		text-decoration: underline;
	}
	.hint {
		font-size: 10px;
		color: var(--app-text-secondary);
		line-height: 1.5;
		margin: 4px 0 12px;
	}
	.inspector-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-top: 17px;
	}
	.inspector-actions > span {
		flex: 1;
	}
	.standard {
		min-height: var(--app-control-height);
		border: 1px solid var(--app-control-border);
		background: var(--app-control);
		box-shadow: 0 1px 1px #0001;
	}
	.primary {
		min-height: var(--app-control-height);
		color: var(--app-accent-text);
		background: var(--app-accent);
		border: 1px solid var(--app-accent);
		box-shadow: 0 1px 1px #0001;
	}
	.primary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--app-accent) 85%, var(--app-text));
	}
	.delete {
		color: var(--app-danger);
		font-size: 11px;
	}
	.stale-notice {
		background: var(--app-warning-bg);
		border: 1px solid var(--app-border);
		padding: 10px;
		margin-bottom: 14px;
		border-radius: var(--app-control-radius);
		font-size: 11px;
		line-height: 1.5;
		color: var(--app-warning);
	}
	.stale-notice p {
		margin: 5px 0;
	}
	.stale-notice code {
		font-size: 10px;
		overflow-wrap: anywhere;
	}
	.inspector-empty {
		font-size: 12px;
		color: var(--app-text-secondary);
		text-align: center;
		padding: 25px;
	}
	.statusbar {
		flex: none;
		border-top: 1px solid var(--app-border);
		padding: 7px 14px;
		background: var(--app-toolbar);
		font-size: 10px;
		color: var(--app-text-secondary);
		line-height: 1.4;
	}

	.file-list {
		border: 1px solid var(--app-border);
		border-radius: var(--app-control-radius);
		background: var(--app-surface);
		max-height: 210px;
		overflow: auto;
	}
	.file-list button {
		display: flex;
		flex-direction: column;
		gap: 4px;
		width: 100%;
		padding: 9px 10px;
		text-align: left;
		border-radius: 0;
	}
	.file-list button + button {
		border-top: 1px solid var(--app-border);
	}
	.file-list strong {
		font-size: 12px;
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	.file-list small {
		color: var(--app-text-secondary);
		font-size: 10px;
		overflow-wrap: anywhere;
	}
	.dialog-error {
		color: var(--app-danger);
		font-size: 12px;
		line-height: 1.5;
	}

	@container (min-width: 700px) {
		.workspace-content {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 340px;
			overflow: hidden;
		}
		.task-list {
			max-height: none;
			min-height: 0;
		}
		.task-list:only-child {
			grid-column: 1 / -1;
		}
		.task-row {
			grid-template-columns: 21px minmax(0, 1fr) auto;
			gap: 5px 10px;
			padding: 13px 16px;
		}
		.task-row strong {
			grid-column: 2 / 4;
		}
		.task-mark {
			grid-row: 1 / 3;
		}
		.task-status {
			grid-column: 2;
		}
		.task-date {
			grid-column: 3;
		}
		.inspector,
		.inspector-empty {
			min-width: 0;
			min-height: 0;
			overflow: auto;
			border-top: 0;
			border-left: 1px solid var(--app-border);
			padding: 17px 16px;
		}
	}

	@container (max-width: 460px) {
		.toolbar {
			gap: 7px;
			padding-inline: 12px;
		}
		.list-heading {
			padding-inline: 14px;
		}
		.filters button {
			padding-inline: 12px;
		}
		.task-row {
			grid-template-columns: 21px minmax(0, 1fr) auto;
			gap: 5px 10px;
			padding-inline: 14px;
		}
		.task-row strong {
			grid-column: 2 / 4;
		}
		.task-mark {
			grid-row: 1 / 3;
		}
		.task-status {
			grid-column: 2;
		}
		.task-date {
			grid-column: 3;
		}
		.inspector {
			padding-inline: 14px;
		}
		.linked-field {
			gap: 7px;
		}
		.file-link {
			font-size: 10px;
		}
		.inspector-actions {
			gap: 6px;
		}
		.inspector-actions button {
			font-size: 11px;
		}
	}
</style>
