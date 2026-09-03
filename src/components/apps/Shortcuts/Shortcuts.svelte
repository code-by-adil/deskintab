<script lang="ts">
	import { onMount, tick } from 'svelte';
	import AddIcon from '~icons/mdi/plus';
	import ShortcutIcon from '~icons/mdi/lightning-bolt-outline';
	import ArrowIcon from '~icons/mdi/arrow-top-right';
	import {
		shortcutService,
		shortcutsDocument,
		type ShortcutInput,
		type ShortcutSummary,
		type ShortcutFile,
		type PreparedShortcut,
	} from '🍎/lib/shortcuts/shortcuts';
	import { projectsService, type ProjectSummary } from '🍎/lib/projects/projects';
	import { workspaceService } from '🍎/lib/workspace/workspace';
	import { workspaceDirname } from '🍎/lib/workspace/path';
	import { revealDesktop } from '🍎/lib/desktop/files';
	import { subscribeToDesktopCommands } from '🍎/lib/desktop/commands';
	import { AppError } from '🍎/lib/errors';

	let { windowId: _windowId }: { windowId?: string } = $props();
	let record = $state.raw(shortcutsDocument.snapshot());
	let shortcuts = $state.raw<ShortcutSummary[]>([]);
	let projects = $state.raw<ProjectSummary[]>([]);
	let warnings = $state.raw<string[]>([]);
	let loading = $state(true);
	let working = $state(false);
	let error = $state('');
	let notice = $state('');
	let mode = $state<'view' | 'new' | 'edit' | 'prepare'>('view');
	let draft = $state({
		path: '',
		title: '',
		description: '',
		procedure: '',
		requiredInputs: '',
		sourcePaths: '',
		outputGuidance: '',
	});
	let draftBase = $state('');
	let draftRevision = $state('');
	let prepared = $state.raw<PreparedShortcut | null>(null);
	let targetProject = $state('new');
	let projectPath = $state('');
	let projectTitle = $state('');
	let projectObjective = $state('');
	let projectRevision = $state('');
	let inputPaths = $state('');
	let inputText = $state('');
	let workOrderPath = $state('');
	let preparePath = $state('');
	let prepareRevision = $state('');
	let prepareShortcut = $state.raw<ShortcutFile | null>(null);
	let alive = true;
	let generation = 0;
	let authorizedOpen: string | null = null;
	let mainPane: HTMLElement | undefined;
	const shortcut = $derived(record.error ? null : record.data);
	const editing = $derived(mode === 'new' || mode === 'edit');
	const dirty = $derived(editing && JSON.stringify(draft) !== draftBase);
	const stale = $derived(
		mode === 'edit' &&
			(Boolean(record.error) || record.path !== draft.path || record.revision !== draftRevision),
	);
	const preparedStale = $derived(
		mode === 'prepare' &&
			(Boolean(record.error) || record.path !== preparePath || record.revision !== prepareRevision),
	);
	const busy = $derived(working || record.loading);
	const lines = (value: string) =>
		value
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
	const safeName = (value: string) =>
		value
			.trim()
			.replace(/[\/\\\u0000-\u001f\u007f]/g, '-')
			.slice(0, 100) || 'New work';
	const datedOrder = (directory: string) =>
		`${directory}/Work orders/${safeName(shortcut?.title ?? 'Work order')}-${crypto.randomUUID().slice(0, 8)}.md`;

	async function refreshList() {
		const token = ++generation;
		try {
			const [saved, projectList] = await Promise.all([
				shortcutService.list(),
				projectsService.list(),
			]);
			if (!alive || token !== generation) return;
			shortcuts = saved.shortcuts;
			projects = projectList.projects;
			warnings = saved.warnings.map((item) => `${item.path}: ${item.message}`);
			if (saved.truncated) warnings.push('Showing the first 100 shortcut files.');
		} catch (cause) {
			if (alive && token === generation)
				error = cause instanceof Error ? cause.message : 'Shortcuts could not be read.';
		} finally {
			if (alive && token === generation) loading = false;
		}
	}
	function guardNavigation() {
		if (!dirty && !working && mode !== 'prepare') return true;
		error = working
			? 'Wait for this operation to finish.'
			: mode === 'prepare'
				? 'Prepare this work or cancel before leaving.'
				: 'Save or discard your shortcut edits before leaving.';
		return false;
	}
	async function perform(action: () => Promise<void>) {
		if (working) return;
		working = true;
		error = '';
		notice = '';
		try {
			await action();
		} catch (cause) {
			if (alive)
				error = cause instanceof Error ? cause.message : 'This operation could not finish.';
		} finally {
			if (alive) {
				working = false;
				void refreshList();
			}
		}
	}
	async function choose(path: string) {
		if (!guardNavigation()) return;
		await perform(async () => {
			await openSelected(path);
			mode = 'view';
			prepared = null;
			await scrollToTop();
		});
	}
	async function scrollToTop() {
		await tick();
		mainPane?.scrollTo({ top: 0 });
	}
	function attachMain(element: HTMLElement) {
		mainPane = element;
		return () => {
			mainPane = undefined;
		};
	}
	async function openSelected(path: string) {
		authorizedOpen = path;
		try {
			await shortcutsDocument.open(path);
		} finally {
			authorizedOpen = null;
		}
	}
	function newShortcut() {
		if (!guardNavigation()) return;
		draft = {
			path: '',
			title: '',
			description: '',
			procedure: '',
			requiredInputs: '',
			sourcePaths: '',
			outputGuidance: '',
		};
		draftBase = JSON.stringify(draft);
		draftRevision = '';
		mode = 'new';
		error = '';
		notice = '';
		prepared = null;
		void scrollToTop();
	}
	function editShortcut() {
		if (!shortcut || !record.path || !guardNavigation()) return;
		draft = {
			path: record.path,
			title: shortcut.title,
			description: shortcut.description,
			procedure: shortcut.procedure,
			requiredInputs: shortcut.requiredInputs.join('\n'),
			sourcePaths: shortcut.sourcePaths.join('\n'),
			outputGuidance: shortcut.outputGuidance,
		};
		draftBase = JSON.stringify(draft);
		draftRevision = record.revision ?? '';
		mode = 'edit';
		error = '';
		notice = '';
		void scrollToTop();
	}
	async function saveShortcut() {
		if (!editing || stale) return;
		await perform(async () => {
			const input: ShortcutInput = {
				title: draft.title,
				description: draft.description,
				procedure: draft.procedure,
				requiredInputs: lines(draft.requiredInputs),
				sourcePaths: lines(draft.sourcePaths),
				outputGuidance: draft.outputGuidance,
			};
			const path = draft.path.trim() || `/Shortcuts/${safeName(draft.title)}.shortcut.json`;
			const saved =
				mode === 'new'
					? await shortcutService.create(path, input)
					: await shortcutService.update(path, draftRevision, input);
			draftBase = JSON.stringify(draft);
			mode = 'view';
			await openSelected(saved.path);
			notice = 'Shortcut saved.';
			await scrollToTop();
		});
	}
	function cancelEdit() {
		if (!working) {
			mode = 'view';
			error = '';
			notice = '';
		}
	}
	function beginPreparation() {
		if (!shortcut || !record.path || !guardNavigation()) return;
		preparePath = record.path;
		prepareRevision = record.revision ?? '';
		prepareShortcut = shortcut;
		targetProject = 'new';
		projectTitle = shortcut.title;
		projectObjective = shortcut.description || shortcut.title;
		projectPath = `/Projects/${safeName(shortcut.title)}/${safeName(shortcut.title)}.project.json`;
		projectRevision = '';
		inputPaths = '';
		inputText = '';
		workOrderPath = datedOrder(workspaceDirname(projectPath));
		mode = 'prepare';
		error = '';
		notice = '';
		prepared = null;
		void scrollToTop();
	}
	async function selectProject(value: string) {
		targetProject = value;
		projectRevision = '';
		error = '';
		if (value === 'new') {
			projectPath = `/Projects/${safeName(projectTitle)}/${safeName(projectTitle)}.project.json`;
			workOrderPath = datedOrder(workspaceDirname(projectPath));
			return;
		}
		await perform(async () => {
			const selected = await projectsService.read(value);
			if (targetProject !== value) return;
			projectPath = selected.path;
			projectRevision = selected.revision;
			workOrderPath = datedOrder(workspaceDirname(selected.path));
		});
	}
	async function prepareWork() {
		if (mode !== 'prepare' || preparedStale) return;
		await perform(async () => {
			prepared = await shortcutService.prepare(preparePath, prepareRevision, {
				projectPath,
				...(targetProject === 'new'
					? { newProject: { title: projectTitle, objective: projectObjective } }
					: { projectRevision }),
				inputPaths: lines(inputPaths),
				inputText,
				workOrderPath,
			});
			mode = 'view';
			notice = 'Work order prepared. Ready for an agent to pick up.';
			await scrollToTop();
		});
	}
	async function openFile(path: string) {
		await perform(async () => {
			await revealDesktop({ path });
		});
	}
	async function copyBrief() {
		if (!prepared) return;
		try {
			await navigator.clipboard.writeText(prepared.briefText);
			notice = 'Project brief copied.';
		} catch {
			error = 'Copy is unavailable. Open the work order to select and copy its text.';
		}
	}
	onMount(() => {
		alive = true;
		const unsubscribe = shortcutsDocument.subscribe(() => {
			record = shortcutsDocument.snapshot();
		});
		const stopWorkspace = workspaceService.subscribe(() => {
			void refreshList();
		});
		const clearPending = shortcutsDocument.setPendingGuard(
			(path) =>
				(mode === 'edit' && draft.path === path && (dirty || working)) ||
				(mode === 'prepare' && preparePath === path),
		);
		const clearClose = shortcutsDocument.setCloseGuard(guardNavigation);
		const clearOpen = shortcutsDocument.setOpenGuard(async (path) => {
			if (path !== record.path && path !== authorizedOpen && !guardNavigation())
				throw new AppError('SHORTCUT_DRAFT', error);
		});
		const stopCommands = subscribeToDesktopCommands(({ target, command }) => {
			if (target !== 'shortcuts' || busy) return;
			if (command === 'new-document') newShortcut();
			if (command === 'save') void saveShortcut();
			if (command === 'open' && guardNavigation()) void refreshList();
		});
		void refreshList();
		void (async () => {
			if (record.path) return;
			const remembered = await shortcutsDocument.resolvePath();
			if (alive && !record.path && (await workspaceService.exists(remembered)))
				await shortcutsDocument.open(remembered);
		})().catch((cause) => {
			if (alive)
				error = cause instanceof Error ? cause.message : 'Could not restore the last shortcut.';
		});
		return () => {
			alive = false;
			unsubscribe();
			stopWorkspace();
			clearPending();
			clearClose();
			clearOpen();
			stopCommands();
		};
	});
</script>

<svelte:window
	onbeforeunload={(event) => {
		if (dirty || working || mode === 'prepare') {
			event.preventDefault();
			event.returnValue = '';
		}
	}}
/>

<div class="shortcuts-app">
	<aside aria-label="Saved shortcuts">
		<div class="sidebar-heading">
			<span>Shortcuts</span><button
				title="New shortcut"
				aria-label="New shortcut"
				onclick={newShortcut}
				disabled={busy}><AddIcon /></button
			>
		</div>
		<p class="sidebar-note">Your saved procedures.</p>
		<div class="shortcut-list">
			{#each shortcuts as item (item.path)}
				<button
					class:selected={record.path === item.path}
					onclick={() => choose(item.path)}
					disabled={busy}
				>
					<ShortcutIcon /><span
						><strong>{item.title}</strong><small
							>{item.description ||
								`${item.inputCount} input ${item.inputCount === 1 ? 'item' : 'items'}`}</small
						></span
					>
				</button>
			{/each}
			{#if loading}<p class="quiet">Loading shortcuts...</p>{:else if !shortcuts.length}<p
					class="quiet"
				>
					Save a procedure you want to use again.
				</p>{/if}
		</div>
		<button
			class="folder-link"
			onclick={() =>
				openFile(
					workspaceDirname(
						record.path ?? shortcuts[0]?.path ?? '/Shortcuts/My shortcut.shortcut.json',
					),
				)}
			disabled={busy || !shortcuts.length}>Show folder <ArrowIcon /></button
		>
	</aside>
	<main {@attach attachMain}>
		{#if error || record.error}<p class="message error" role="alert">
				{error || record.error}
			</p>{/if}
		{#if notice}<p class="message" role="status">{notice}</p>{/if}
		{#if record.warning}<p class="message">{record.warning}</p>{/if}
		{#each warnings as warning (warning)}<p class="message">{warning}</p>{/each}
		{#if editing}
			<form
				onsubmit={(event) => {
					event.preventDefault();
					void saveShortcut();
				}}
			>
				<header>
					<div>
						<p class="eyebrow">Reusable procedure</p>
						<h1>{mode === 'new' ? 'New shortcut' : 'Edit shortcut'}</h1>
					</div>
					<button type="button" onclick={cancelEdit} disabled={working}>Discard</button>
				</header>
				{#if stale}<p class="message error" role="alert">
						This shortcut changed elsewhere. Discard these edits and reopen it before saving.
					</p>{/if}
				<label
					>Shortcut name<input
						bind:value={draft.title}
						maxlength="160"
						required
						disabled={busy}
						placeholder="Prepare a client update"
					/></label
				>
				<label
					>Description<input
						bind:value={draft.description}
						maxlength="1000"
						disabled={busy}
						placeholder="When to use this shortcut"
					/></label
				>
				<label
					>Procedure<textarea
						bind:value={draft.procedure}
						rows="7"
						maxlength="16000"
						required
						disabled={busy}
						placeholder="Describe the steps an agent should follow."></textarea></label
				>
				<div class="form-columns">
					<label
						>Required inputs<textarea
							bind:value={draft.requiredInputs}
							rows="3"
							disabled={busy}
							placeholder="One item per line"></textarea></label
					><label
						>Template and source files<textarea
							bind:value={draft.sourcePaths}
							rows="3"
							disabled={busy}
							placeholder="One absolute file path per line"></textarea></label
					>
				</div>
				<label
					>Expected output<textarea
						bind:value={draft.outputGuidance}
						rows="3"
						maxlength="4000"
						required
						disabled={busy}
						placeholder="What should be saved, and how should it be checked?"></textarea></label
				>
				{#if mode === 'new'}<label
						>Save path<input
							bind:value={draft.path}
							disabled={busy}
							placeholder={`/Shortcuts/${safeName(draft.title)}.shortcut.json`}
						/></label
					>{/if}
				<footer>
					<span>Saved as a readable workspace file.</span><button
						class="primary"
						type="submit"
						disabled={busy || stale}>Save shortcut</button
					>
				</footer>
			</form>
		{:else if mode === 'prepare' && prepareShortcut}
			<form
				onsubmit={(event) => {
					event.preventDefault();
					void prepareWork();
				}}
			>
				<header>
					<div>
						<p class="eyebrow">{prepareShortcut.title}</p>
						<h1>Prepare work</h1>
					</div>
					<button type="button" onclick={cancelEdit} disabled={working}>Cancel</button>
				</header>
				<p class="intro">
					Choose the inputs for this procedure and save a work order in Projects. Then ask your
					agent to carry it out.
				</p>
				{#if preparedStale}<p class="message error" role="alert">
						The shortcut changed. Cancel and prepare it again to use the current procedure.
					</p>{/if}
				<label
					>Project<select
						value={targetProject}
						onchange={(event) => void selectProject(event.currentTarget.value)}
						disabled={busy}
						><option value="new">Create a new project</option
						>{#each projects as project (project.path)}<option value={project.path}
								>{project.title}</option
							>{/each}</select
					></label
				>
				{#if targetProject === 'new'}
					<label
						>Project name<input
							bind:value={projectTitle}
							maxlength="160"
							required
							disabled={busy}
						/></label
					>
					<label
						>Project objective<textarea
							bind:value={projectObjective}
							rows="2"
							maxlength="2000"
							required
							disabled={busy}></textarea></label
					>
					<label>Project file<input bind:value={projectPath} required disabled={busy} /></label>
				{:else}<div class="selected-project">
						<code>{projectPath}</code><button
							type="button"
							onclick={() => selectProject(targetProject)}
							disabled={busy}>Refresh project</button
						>
					</div>{/if}
				{#if prepareShortcut.requiredInputs.length}<div class="input-checklist">
						<h2>Bring these inputs</h2>
						<ul>
							{#each prepareShortcut.requiredInputs as item (item)}<li>{item}</li>{/each}
						</ul>
					</div>{/if}
				<label
					>Input files<textarea
						bind:value={inputPaths}
						rows="3"
						disabled={busy}
						placeholder="One absolute workspace file path per line"></textarea></label
				>
				<label
					>Request and input notes<textarea
						bind:value={inputText}
						rows="4"
						maxlength="12000"
						disabled={busy}
						placeholder="What should the agent work on this time?"></textarea></label
				>
				<label>Work order file<input bind:value={workOrderPath} required disabled={busy} /></label>
				<footer>
					<span>Includes your saved Home preferences.</span><button
						type="submit"
						class="primary"
						disabled={busy || preparedStale || (targetProject !== 'new' && !projectRevision)}
						>Prepare work order</button
					>
				</footer>
			</form>
		{:else if shortcut}
			<header>
				<div>
					<p class="eyebrow">Reusable procedure</p>
					<h1>{shortcut.title}</h1>
				</div>
				<button onclick={editShortcut} disabled={busy}>Edit shortcut</button>
			</header>
			{#if shortcut.description}<p class="intro">{shortcut.description}</p>{/if}
			<div class="prepare-action">
				<button class="primary" onclick={beginPreparation} disabled={busy}
					><ShortcutIcon /> Prepare work</button
				><span>Choose inputs and save a work order.</span>
			</div>
			{#if prepared}<section class="prepared-result" aria-label="Prepared work">
					<p class="eyebrow">Ready for an agent</p>
					<h2>Work order saved</h2>
					<p>Give the project brief to your connected agent to start the work.</p>
					<div class="result-links">
						<button onclick={() => openFile(prepared!.workOrderPath)} disabled={busy}
							>Open work order <ArrowIcon /></button
						><button onclick={() => openFile(prepared!.projectPath)} disabled={busy}
							>Open project <ArrowIcon /></button
						><button onclick={copyBrief} disabled={busy}>Copy project brief</button>
					</div>
				</section>{/if}
			<section>
				<h2>Procedure</h2>
				<p class="saved-text">{shortcut.procedure}</p>
			</section>
			{#if shortcut.requiredInputs.length}<section>
					<h2>Required inputs</h2>
					<ul>
						{#each shortcut.requiredInputs as input (input)}<li>{input}</li>{/each}
					</ul>
				</section>{/if}
			<section>
				<h2>Expected output</h2>
				<p class="saved-text">{shortcut.outputGuidance}</p>
			</section>
			{#if shortcut.sourcePaths.length}<section>
					<h2>Templates and sources</h2>
					{#each shortcut.sourcePaths as path (path)}<button
							class="file-link"
							onclick={() => openFile(path)}
							disabled={busy}>{path}<ArrowIcon /></button
						>{/each}
				</section>{/if}
			<p class="saved-path">{record.path}</p>
		{:else}
			<div class="empty-state">
				<ShortcutIcon />
				<h1>Use a good procedure again.</h1>
				<p>
					Save the steps for a client update or release review. Add new inputs when you need it
					again, then prepare a work order for your agent.
				</p>
				<button class="primary" onclick={newShortcut} disabled={busy}>New shortcut</button>
			</div>
		{/if}
	</main>
</div>

<style>
	.shortcuts-app {
		display: flex;
		height: 100%;
		min-height: 0;
		color: #27303d;
		background: #fbfbfc;
		font-size: 13px;
	}
	aside {
		width: 210px;
		flex: 0 0 210px;
		display: flex;
		flex-direction: column;
		padding: 48px 10px 10px;
		border-right: 1px solid #dce0e7;
		background: #edf0f5;
	}
	.sidebar-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0 6px;
		font-size: 14px;
		font-weight: 650;
	}
	.sidebar-heading button {
		padding: 4px;
		display: grid;
		place-items: center;
	}
	.sidebar-note {
		color: #6a7180;
		font-size: 12px;
		margin: 5px 6px 18px;
	}
	.shortcut-list {
		overflow: auto;
		flex: 1;
	}
	.shortcut-list > button {
		display: flex;
		gap: 9px;
		align-items: flex-start;
		width: 100%;
		text-align: left;
		border: 0;
		padding: 11px 8px;
		background: transparent;
		box-shadow: none;
	}
	.shortcut-list > button > :global(svg) {
		flex: 0 0 19px;
		margin-top: 2px;
		color: #7960be;
	}
	.shortcut-list strong {
		display: block;
		font-size: 12px;
		font-weight: 600;
	}
	.shortcut-list small {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		color: #737a85;
		margin-top: 4px;
		line-height: 1.35;
	}
	.shortcut-list > button.selected {
		background: #ded9ed;
	}
	.folder-link {
		display: flex;
		justify-content: space-between;
		margin-top: 12px;
		font-size: 11px;
	}
	main {
		flex: 1;
		min-width: 0;
		overflow: auto;
		padding: 26px 30px;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 17px;
	}
	header button {
		flex-shrink: 0;
	}
	h1 {
		margin: 2px 0 0;
		font-size: 24px;
		letter-spacing: -0.7px;
		font-weight: 650;
	}
	h2 {
		font-size: 13px;
		margin: 0 0 9px;
		font-weight: 650;
	}
	.eyebrow {
		text-transform: uppercase;
		font-size: 10px;
		letter-spacing: 1px;
		color: #747887;
		margin: 0 0 6px;
		font-weight: 650;
	}
	.intro {
		margin: 0 0 22px;
		line-height: 1.6;
		color: #666e7b;
	}
	button {
		font: inherit;
		border: 1px solid #d8dce4;
		border-radius: 6px;
		padding: 7px 11px;
		background: #fff;
		color: #343b4a;
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: #f0eef7;
	}
	button:disabled {
		cursor: default;
		opacity: 0.5;
	}
	button:focus-visible,
	input:focus-visible,
	textarea:focus-visible,
	select:focus-visible {
		outline: 2px solid #8970bf;
		outline-offset: 2px;
	}
	.primary {
		background: #7655b5;
		color: #fff;
		border-color: #7655b5;
	}
	.primary:hover:not(:disabled) {
		background: #64459e;
	}
	.prepare-action {
		display: flex;
		align-items: center;
		gap: 12px;
		padding-bottom: 24px;
		border-bottom: 1px solid #e5e6eb;
	}
	.prepare-action button,
	.result-links button {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.prepare-action span,
	footer span {
		font-size: 11px;
		color: #777e8b;
	}
	section {
		margin: 25px 0;
	}
	.saved-text {
		white-space: pre-wrap;
		line-height: 1.7;
		overflow-wrap: anywhere;
		color: #485263;
		margin: 0;
	}
	ul {
		padding-left: 19px;
		margin: 0;
		line-height: 1.8;
		color: #485263;
	}
	.file-link {
		width: 100%;
		display: flex;
		justify-content: space-between;
		text-align: left;
		margin-top: 6px;
		overflow-wrap: anywhere;
		font-size: 12px;
	}
	.saved-path {
		margin: 28px 0 0;
		color: #8a8f99;
		font-size: 11px;
		overflow-wrap: anywhere;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		font-weight: 550;
		margin: 0 0 15px;
	}
	input,
	textarea,
	select {
		box-sizing: border-box;
		width: 100%;
		font: inherit;
		font-weight: 400;
		color: inherit;
		background: #fff;
		border: 1px solid #d7dce5;
		border-radius: 6px;
		padding: 9px 10px;
	}
	textarea {
		resize: vertical;
		line-height: 1.55;
		min-height: 60px;
	}
	.form-columns {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}
	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 15px 0 4px;
		border-top: 1px solid #e6e8ed;
	}
	.message {
		border-radius: 6px;
		padding: 10px 12px;
		line-height: 1.5;
		color: #426844;
		background: #edf5ed;
		margin: 0 0 16px;
		overflow-wrap: anywhere;
	}
	.message.error {
		color: #994833;
		background: #fff0e9;
	}
	.quiet {
		color: #7d8390;
		font-size: 12px;
		padding: 12px 7px;
		line-height: 1.55;
	}
	.empty-state {
		max-width: 330px;
		margin: 65px auto;
		text-align: center;
	}
	.empty-state > :global(svg) {
		width: 44px;
		height: 44px;
		color: #8c74bc;
		margin-bottom: 15px;
	}
	.empty-state p {
		line-height: 1.7;
		color: #767e8b;
		margin: 16px 0 22px;
	}
	.prepared-result {
		background: #f0ecf9;
		border: 1px solid #dfd6ef;
		padding: 18px;
		border-radius: 8px;
	}
	.prepared-result p {
		line-height: 1.6;
		color: #625375;
	}
	.result-links {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
	}
	.result-links button {
		font-size: 11px;
	}
	.input-checklist {
		padding: 13px 15px;
		margin-bottom: 18px;
		border-left: 2px solid #bcadd9;
		background: #f4f1f9;
	}
	.selected-project {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		margin: -5px 0 18px;
	}
	.selected-project code {
		overflow-wrap: anywhere;
		font-size: 11px;
		color: #727b89;
	}
	@media (max-width: 650px) {
		aside {
			flex-basis: 145px;
			width: 145px;
		}
		main {
			padding: 20px 16px;
		}
		h1 {
			font-size: 21px;
		}
		.form-columns {
			grid-template-columns: 1fr;
			gap: 0;
		}
		.prepare-action {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
