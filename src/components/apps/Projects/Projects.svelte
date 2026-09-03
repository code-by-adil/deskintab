<script lang="ts">
	import { connectAppNavigation } from '🍎/lib/desktop/navigation';

	import { onMount } from 'svelte';
	import WindowSheet from '🍎/components/SystemUI/WindowSheet.svelte';
	import ProjectForm from './ProjectForm.svelte';
	import type { ProjectDraft } from './form-types';
	import FolderIcon from '~icons/mdi/folder-outline';
	import AddIcon from '~icons/mdi/plus';
	import OverviewIcon from '~icons/mdi/view-dashboard-outline';
	import ArrowIcon from '~icons/mdi/arrow-top-right';
	import {
		projectsDocument,
		projectsService,
		type ProjectSummary,
		type ProjectEvidence,
	} from '🍎/lib/projects/projects';
	import { workspaceService } from '🍎/lib/workspace/workspace';
	import { workspaceBasename, workspaceDirname } from '🍎/lib/workspace/path';
	import { revealDesktop } from '🍎/lib/desktop/files';
	import { subscribeToDesktopCommands } from '🍎/lib/desktop/commands';
	import { connectProjectsContext } from '🍎/lib/workspace/interaction-context';
	import { AppError } from '🍎/lib/errors';

	type ProjectRecord = Awaited<ReturnType<typeof projectsService.read>>;
	let record = $state.raw(projectsDocument.snapshot());
	let details = $state.raw<ProjectRecord | null>(null);
	let projects = $state.raw<ProjectSummary[]>([]);
	let warnings = $state.raw<Array<{ path: string; message: string }>>([]);
	let truncated = $state(false);
	let loading = $state(true);
	let overview = $state(true);
	let tab = $state<'handoff' | 'work' | 'context'>('handoff');
	let selectedRunId = $state('');
	let error = $state('');
	let notice = $state('');
	let working = $state(false);
	let draft = $state<ProjectDraft | null>(null);
	let draftBase = $state('');
	let draftPath = $state('');
	let draftRevision = $state('');
	let opener = $state.raw<Element | null>(null);
	let alive = true;
	let listGeneration = 0;
	let detailGeneration = 0;
	const project = $derived(record.error ? null : record.data);
	const latestRun = $derived(project?.runs.at(-1) ?? null);
	const run = $derived(project?.runs.find((item) => item.id === selectedRunId) ?? latestRun);
	const dirty = $derived(draft !== null && JSON.stringify(draft) !== draftBase);
	const busy = $derived(working || record.loading);
	const stale = $derived(
		draft !== null &&
			draftRevision !== '' &&
			(record.path !== draftPath || record.revision !== draftRevision),
	);
	const needsAttention = $derived(projects.filter((item) => item.openDecisionCount > 0));
	const questionCount = $derived(projects.reduce((sum, item) => sum + item.openDecisionCount, 0));
	const unanswered = $derived(project?.decisions.filter((item) => item.answer === null) ?? []);
	const answers = $derived(
		(project?.decisions.filter((item) => item.answer !== null) ?? []).sort(
			(a, b) => b.answeredAt!.localeCompare(a.answeredAt!) || b.id.localeCompare(a.id),
		),
	);
	const readyToStart = $derived(!latestRun || ['paused', 'completed'].includes(latestRun.status));
	const stateLabels = {
		working: 'In progress',
		waiting: 'Needs you',
		paused: 'Ready to resume',
		completed: 'Completed',
	};
	const stepLabels = {
		pending: 'To do',
		'in-progress': 'In progress',
		done: 'Done',
		skipped: 'Skipped',
	};
	const dateLabel = (value: string) =>
		new Date(value).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		});
	const summaryStatus = (item: ProjectSummary) =>
		item.openDecisionCount
			? `${item.openDecisionCount} ${item.openDecisionCount === 1 ? 'decision' : 'decisions'}`
			: item.latestRun
				? stateLabels[item.latestRun.status]
				: 'No work started';
	const namedEvidence = (items: ProjectEvidence[]) =>
		items.map((item) => ({
			...item,
			label: item.label.trim() ? item.label : workspaceBasename(item.target),
		}));

	async function refreshList() {
		const generation = ++listGeneration;
		try {
			const result = await projectsService.list();
			if (!alive || generation !== listGeneration) return;
			projects = result.projects;
			warnings = result.warnings;
			truncated = result.truncated;
		} catch (cause) {
			if (alive && generation === listGeneration)
				error = cause instanceof Error ? cause.message : 'Projects could not be read.';
		} finally {
			if (alive && generation === listGeneration) loading = false;
		}
	}
	async function refreshDetails(path: string) {
		const generation = ++detailGeneration;
		try {
			const next = await projectsService.read(path);
			if (alive && generation === detailGeneration && record.path === path) details = next;
		} catch {
			if (alive && generation === detailGeneration) details = null;
		}
	}
	function refreshRecord() {
		const next = projectsDocument.snapshot();
		if (next.path !== record.path) {
			selectedRunId = '';
			details = null;
			if (next.path) overview = false;
		}
		record = next;
		if (next.path && !next.loading && !next.error) void refreshDetails(next.path);
	}
	function guardNavigation() {
		if (!dirty && !working) return true;
		error = working
			? 'Wait for this save to finish.'
			: 'Save or discard your edits before leaving this project.';
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
			if (alive) error = cause instanceof Error ? cause.message : 'This change could not be saved.';
		} finally {
			if (alive) {
				working = false;
				refreshRecord();
				void refreshList();
			}
		}
	}
	async function chooseProject(path: string) {
		if (!guardNavigation()) return;
		await perform(async () => {
			await projectsDocument.open(path);
			if (!alive) return;
			overview = false;
			tab = 'handoff';
			selectedRunId = '';
		});
	}
	function showOverview() {
		if (!guardNavigation()) return;
		overview = true;
		error = '';
	}
	function edit(next: ProjectDraft) {
		if (!guardNavigation()) return;
		opener = document.activeElement;
		draftPath = record.path ?? '';
		draftRevision = next.kind === 'project' && next.isNew ? '' : (record.revision ?? '');
		draft = next;
		draftBase = JSON.stringify(next);
		error = '';
		notice = '';
	}
	function newProject() {
		edit({
			kind: 'project',
			isNew: true,
			path: '',
			title: '',
			objective: '',
			context: '',
			taskListPath: '',
			references: [],
		});
	}
	function editProject() {
		if (!project || !record.path) return;
		edit({
			kind: 'project',
			isNew: false,
			path: record.path,
			title: project.title,
			objective: project.objective,
			context: project.context,
			taskListPath: project.taskListPath ?? '',
			references: project.references.map((item) => ({ ...item })),
		});
	}
	function startWork() {
		if (!project) return;
		edit({
			kind: 'start',
			agent: 'You',
			objective: latestRun?.nextAction || project.objective,
			steps: '',
		});
	}
	function editCheckpoint() {
		if (!run) return;
		edit({
			kind: 'checkpoint',
			runId: run.id,
			status: run.status,
			summary: run.summary,
			nextAction: run.nextAction,
			steps: run.steps.map((item) => ({ ...item })),
			evidence: run.evidence.map((item) => ({ ...item })),
			question: '',
			options: '',
		});
	}
	function answerDecision(id: string) {
		const decision = project?.decisions.find((item) => item.id === id);
		if (!decision) return;
		edit({
			kind: 'answer',
			decisionId: id,
			question: decision.question,
			options: [...decision.options],
			answer: decision.answer ?? '',
		});
	}
	function discardDraft() {
		if (working) return;
		draft = null;
		draftBase = '';
		error = '';
	}
	async function saveDraft() {
		if (!draft || busy || stale) return;
		const value = $state.snapshot(draft);
		const path = draftPath;
		const revision = draftRevision;
		await perform(async () => {
			let result: ProjectRecord;
			if (value.kind === 'project') {
				const input = {
					title: value.title.trim(),
					objective: value.objective.trim(),
					context: value.context,
					taskListPath: value.taskListPath.trim() || null,
					references: namedEvidence(value.references),
				};
				const title = value.title
					.trim()
					.replace(/[\\/\u0000-\u001f]/g, '-')
					.replace(/^\.+$/, 'Project');
				const target = value.path.trim() || `/Projects/${title}/Project.project.json`;
				result = value.isNew
					? await projectsService.create(target, input)
					: await projectsService.update(path, revision, input);
			} else if (value.kind === 'start') {
				result = await projectsService.start(path, revision, {
					agent: value.agent.trim(),
					objective: value.objective.trim(),
					steps: value.steps
						.split('\n')
						.map((line) => line.trim())
						.filter(Boolean),
					basedOn: latestRun?.id ?? null,
				});
			} else if (value.kind === 'checkpoint') {
				result = await projectsService.checkpoint(path, value.runId, revision, {
					status: value.question.trim() ? 'waiting' : value.status,
					summary: value.summary,
					nextAction: value.nextAction,
					steps: value.steps,
					evidence: namedEvidence(value.evidence),
					...(value.question.trim()
						? {
								decision: {
									question: value.question.trim(),
									options: value.options
										.split('\n')
										.map((line) => line.trim())
										.filter(Boolean),
								},
							}
						: {}),
				});
			} else {
				result = await projectsService.answer(
					path,
					value.decisionId,
					revision,
					value.answer.trim(),
				);
			}
			if (!alive) return;
			draft = null;
			draftBase = '';
			await projectsDocument.open(result.path);
			overview = false;
			if (value.kind === 'start') {
				selectedRunId = '';
				tab = 'work';
			}
			if (value.kind === 'answer') tab = 'handoff';
			details = result;
			notice = value.kind === 'answer' ? 'Decision saved for the next agent.' : 'Project saved.';
		});
	}
	async function reveal(path: string) {
		await perform(async () => {
			await revealDesktop({ path });
		});
	}
	async function copyBrief() {
		if (!details) return;
		try {
			await navigator.clipboard.writeText(details.briefText);
			notice = 'Resume brief copied.';
		} catch {
			error = 'Copy is unavailable. Select the resume brief below and copy it.';
		}
	}

	onMount(() => {
		alive = true;
		refreshRecord();
		void refreshList();
		const unsubscribe = projectsDocument.subscribe(refreshRecord);
		const unsubscribeWorkspace = workspaceService.subscribe(() => {
			void refreshList();
		});
		const clearOpen = projectsDocument.setOpenGuard(async (path) => {
			if (path !== record.path && (dirty || (working && draft !== null))) {
				guardNavigation();
				throw new AppError('PROJECT_DRAFT', error);
			}
		});
		const clearClose = projectsDocument.setCloseGuard(guardNavigation);
		const clearPending = projectsDocument.setPendingGuard(
			(path) => draft !== null && draftPath === path && (dirty || working),
		);
		const disconnect = connectProjectsContext(() => ({
			path: overview ? null : record.path,
			revision: overview ? null : record.revision,
			projectId: overview ? null : (project?.id ?? null),
			selectedRunId: overview ? null : (run?.id ?? null),
			view: overview ? 'overview' : tab,
			draft: draft ? { dirty, stale, path: draftPath, baseRevision: draftRevision } : null,
			busy,
		}));
		const stopCommands = subscribeToDesktopCommands(({ target, command }) => {
			if (target !== 'projects' || busy) return;
			if (command === 'save') void saveDraft();
			if (command === 'new-document') newProject();
			if (command === 'open') showOverview();
		});
		void (async () => {
			if (record.path) {
				overview = false;
				return;
			}
			const remembered = await projectsDocument.resolvePath();
			if (alive && !record.path && (await workspaceService.exists(remembered)))
				await projectsDocument.open(remembered);
		})().catch((cause) => {
			if (alive)
				error =
					cause instanceof Error ? cause.message : 'The previous project could not be opened.';
		});
		return () => {
			alive = false;
			unsubscribe();
			unsubscribeWorkspace();
			clearOpen();
			clearClose();
			clearPending();
			disconnect();
			stopCommands();
		};
	});
	onMount(() =>
		connectAppNavigation('projects', {
			ready: () => !loading && !record.loading,
			read: () => ({
				path: record.path,
				view: overview ? 'overview' : tab,
				runId: run?.id ?? null,
				busy,
			}),
			navigate: ({ view, runId }) => {
				if (view === 'overview' && runId !== undefined)
					throw new AppError(
						'INVALID_INPUT',
						'A run belongs to a project view, not the project overview.',
					);
				if (!guardNavigation()) throw new AppError('UNSAVED_EDITS', error);
				if (runId !== undefined && !project?.runs.some((item) => item.id === runId))
					throw new AppError('RUN_NOT_FOUND', 'Read the project and choose an existing run ID.');
				if (view !== 'overview' && (view || runId) && !project)
					throw new AppError('NO_PROJECT', 'Open a project file first.');
				if (view) {
					overview = view === 'overview';
					if (view !== 'overview') tab = view;
				}
				if (runId !== undefined) {
					selectedRunId = runId;
					overview = false;
				}
			},
		}),
	);
</script>

<svelte:window
	onbeforeunload={(event) => {
		if (dirty || working) {
			event.preventDefault();
			event.returnValue = '';
		}
	}}
/>

{#snippet evidenceLinks(items: ProjectEvidence[])}
	<ul class="evidence-list">
		{#each items as item, index (`${item.target}-${index}`)}
			<li>
				{#if item.target.startsWith('/')}
					<button class="text-link" onclick={() => reveal(item.target)} disabled={busy}
						>{item.label}<ArrowIcon width="13" height="13" aria-hidden="true" /></button
					>
				{:else}<a href={item.target} target="_blank" rel="noreferrer"
						>{item.label}<ArrowIcon width="13" height="13" aria-hidden="true" /></a
					>{/if}
				{#if item.detail}<span>{item.detail}</span>{/if}
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet projectRow(item: ProjectSummary)}
	<button class="overview-row" onclick={() => chooseProject(item.path)} disabled={busy}>
		<span class="project-symbol"><FolderIcon width="22" height="22" aria-hidden="true" /></span>
		<span class="row-copy"
			><strong>{item.title}</strong><span>{item.latestRun?.nextAction || item.objective}</span>
			{#if item.latestRun}<small
					>{item.latestRun.agent} · Checkpoint saved {dateLabel(item.latestRun.updatedAt)}</small
				>{/if}</span
		>
		<span class={['row-state', { attention: item.openDecisionCount > 0 }]}
			>{summaryStatus(item)}</span
		>
	</button>
{/snippet}

<section class="projects-shell" aria-label="Projects">
	<div class="app-content" inert={draft !== null}>
		<header class="titlebar app-window-drag-handle">
			<div class="traffic-space" aria-hidden="true"></div>
			<h1>Projects</h1>
			<span class="save-status" role="status">{busy ? 'Saving...' : dirty ? 'Edited' : notice}</span
			>
			<button
				class="icon-button"
				aria-label="New project"
				disabled={busy || dirty}
				onclick={newProject}><AddIcon width="18" height="18" aria-hidden="true" /></button
			>
		</header>
		{#if error || record.error}<p class="banner error" role="alert">{error || record.error}</p>{/if}
		{#if record.warning}<p class="banner" role="status">{record.warning}</p>{/if}
		<div class="project-layout">
			<aside class="sidebar" aria-label="Project navigation">
				<button
					class:chosen={overview}
					aria-pressed={overview}
					onclick={showOverview}
					disabled={busy || dirty}
					><OverviewIcon width="17" height="17" aria-hidden="true" /><span>Overview</span
					>{#if questionCount}<span class="count">{questionCount}</span>{/if}</button
				>
				<p class="sidebar-label">Projects</p>
				<div class="project-nav">
					{#each projects as item (item.path)}<button
							class={['project-nav-row', { chosen: !overview && record.path === item.path }]}
							aria-pressed={!overview && record.path === item.path}
							onclick={() => chooseProject(item.path)}
							disabled={busy || dirty}
							><span class="nav-title">{item.title}</span><span class="nav-state"
								>{summaryStatus(item)}</span
							></button
						>{/each}
				</div>
				<button class="new-project" onclick={newProject} disabled={busy || dirty}
					><AddIcon width="16" height="16" aria-hidden="true" />New project</button
				>
			</aside>
			<main class="project-main">
				{#if overview || !project}
					<div class="page-heading">
						<div>
							<p class="eyebrow">Your workspace</p>
							<h2>Pick up where you left off.</h2>
							<p>Review saved work, answer open questions, and choose what happens next.</p>
						</div>
					</div>
					{#if loading}<p class="empty">Reading projects...</p>
					{:else if projects.length === 0}<div class="empty-state">
							<FolderIcon width="42" height="42" aria-hidden="true" />
							<h3>Give your work a place.</h3>
							<p>
								Create a project with an objective and source files. Save progress and decisions so
								you or your next agent session can continue from the same brief.
							</p>
							<button class="primary" onclick={newProject}>Create a project</button>
						</div>
					{:else}
						{#if needsAttention.length}<section class="overview-section" aria-label="Needs you">
								<h3>Needs you <span>{questionCount}</span></h3>
								{#each needsAttention as item (item.path)}{@render projectRow(item)}{/each}
							</section>{/if}
						<section class="overview-section" aria-label="All projects">
							<h3>All projects <span>{projects.length}</span></h3>
							{#each projects as item (item.path)}{@render projectRow(item)}{/each}
						</section>
					{/if}
					{#if warnings.length}<details class="read-warnings">
							<summary>{warnings.length} project files need attention</summary
							>{#each warnings as warning (warning.path)}<p>
									{warning.path}<br />{warning.message}
								</p>{/each}
						</details>{/if}
					{#if truncated}<p class="hint">
							Showing the first 100 projects. Open another project file from Finder.
						</p>{/if}
				{:else}
					<div class="page-heading project-heading">
						<div>
							<p class="eyebrow">Project</p>
							<h2>{project.title}</h2>
							<p>{project.objective}</p>
						</div>
						<button class="standard" onclick={editProject} disabled={busy}>Edit project</button>
					</div>
					<nav class="tabs" aria-label="Project views">
						{#each ['handoff', 'work', 'context'] as view (view)}<button
								aria-pressed={tab === view}
								class:active={tab === view}
								onclick={() => (tab = view as typeof tab)}
								>{view === 'handoff' ? 'Handoff' : view === 'work' ? 'Work' : 'Context'}</button
							>{/each}
					</nav>
					<div class="project-body">
						{#if tab !== 'context'}
							{#if run}<div class="run-heading">
									<div class="agent-avatar" aria-hidden="true">
										{run.agent.slice(0, 1).toUpperCase()}
									</div>
									<div>
										<strong>{run.agent}</strong><span
											>Checkpoint saved {dateLabel(run.updatedAt)}</span
										>
									</div>
									<span class={['run-state', run.status]}>{stateLabels[run.status]}</span>
								</div>
								{#if project.runs.length > 1}<label class="history-select"
										>Work session<select
											value={run.id}
											onchange={(event) => (selectedRunId = event.currentTarget.value)}
											>{#each [...project.runs].reverse() as previous (previous.id)}<option
													value={previous.id}>{previous.agent} · {previous.objective}</option
												>{/each}</select
										></label
									>{/if}
								<h3 class="work-objective">{run.objective}</h3>
							{:else}<div class="no-run">
									<h3>No work started yet.</h3>
									<p>Start a work session with an objective and a short plan.</p>
								</div>{/if}
						{/if}
						{#if tab === 'handoff'}
							{#if run?.summary}<p class="handoff-summary">{run.summary}</p>{/if}
							{#if run?.nextAction}<div class="next-action">
									<span>Next action</span>
									<p>{run.nextAction}</p>
								</div>{/if}
							{#if run?.evidence.length}<section class="evidence-section">
									<h3>Evidence</h3>
									{@render evidenceLinks(run.evidence)}
								</section>{/if}
							{#if unanswered.length}<section class="decisions" aria-label="Open decisions">
									<h3>Needs you</h3>
									{#each unanswered as decision (decision.id)}<article class="decision">
											<p>{decision.question}</p>
											{#if decision.options.length}<span>{decision.options.join(' · ')}</span
												>{/if}<button
												class="standard"
												onclick={() => answerDecision(decision.id)}
												disabled={busy}>Answer</button
											>
										</article>{/each}
								</section>{/if}
							{#if answers.length}<section class="answered">
									<h3>Saved decisions</h3>
									{#each answers as decision (decision.id)}<article>
											<strong>{decision.question}</strong>
											<p>{decision.answer}</p>
											<span>Saved {dateLabel(decision.answeredAt!)}</span>
										</article>{/each}
								</section>{/if}
							{#if details}<details class="resume-brief">
									<summary>Resume brief</summary><button
										class="standard copy-brief"
										onclick={copyBrief}>Copy resume brief</button
									>
									<pre>{details.briefText}</pre>
								</details>{/if}
						{:else if tab === 'work'}
							{#if run}<ol class="steps" aria-label="Work steps">
									{#each run.steps as step, index (step.id)}<li data-status={step.status}>
											<span class="step-mark" aria-hidden="true"
												>{step.status === 'done' ? '✓' : index + 1}</span
											>
											<div><strong>{step.title}</strong><span>{stepLabels[step.status]}</span></div>
										</li>{/each}
								</ol>
								<p class="hint">
									Steps reflect the last saved report. They update when the person or agent saves a
									checkpoint.
								</p>{/if}
							{#if details?.brief.taskList}<section class="linked-tasks">
									<h3>Linked tasks</h3>
									<button class="text-link" onclick={() => reveal(details!.brief.taskList!.path)}
										>{details.brief.taskList.title}<ArrowIcon
											width="13"
											height="13"
											aria-hidden="true"
										/></button
									>
									<ul>
										{#each details.brief.taskList.tasks as task (task.id)}<li>
												<span class:complete={task.status === 'done'}>{task.title}</span><small
													>{task.status === 'done'
														? 'Done'
														: task.status === 'in-progress'
															? 'In progress'
															: 'To do'}</small
												>
											</li>{/each}
									</ul>
								</section>{/if}
						{:else}
							<section class="saved-context">
								<h3>Project context</h3>
								<p>
									{project.context ||
										'Add the decisions, constraints, and background a new agent needs.'}
								</p>
							</section>
							{#if project.references.length}<section class="evidence-section">
									<h3>References</h3>
									{@render evidenceLinks(project.references)}
								</section>{/if}
							<div class="file-actions">
								<button class="standard" onclick={() => reveal(workspaceDirname(record.path!))}
									><FolderIcon width="16" height="16" aria-hidden="true" />Open project folder</button
								>{#if project.taskListPath}<button
										class="standard"
										onclick={() => reveal(project.taskListPath!)}>Open task list</button
									>{/if}
							</div>
							<details class="agent-instructions">
								<summary>Instructions for your agent</summary>
								<p>
									Add this to your project instructions after connecting your agent to this browser
									workspace.
								</p>
								<pre>At the start of substantial work, read projects_read with path {record.path}. Start a named work session with projects_start. Save a checkpoint at milestones or when blocked. Before ending, record the result, evidence, and next action. Read the saved decisions before continuing.</pre>
							</details>
						{/if}
						{#if details?.brief.warnings.length}<div class="link-warnings" role="status">
								{#each details.brief.warnings as warning (warning)}<p>{warning}</p>{/each}
							</div>{/if}
						{#if tab !== 'context'}<div class="work-actions">
								{#if run && run.id === latestRun?.id && run.status !== 'completed'}<button
										class="standard"
										onclick={editCheckpoint}
										disabled={busy}>Update checkpoint</button
									>{/if}<button class="primary" onclick={startWork} disabled={busy || !readyToStart}
									>{latestRun ? 'Continue with a new session' : 'Start work'}</button
								>
							</div>{/if}
					</div>
				{/if}
			</main>
		</div>
		<footer class="statusbar">
			<span>{overview ? `${projects.length} projects` : record.path}</span><span
				>Saved in this browser</span
			>
		</footer>
	</div>
	{#if draft}<WindowSheet
			labelledby="project-form-title"
			busy={working}
			returnFocus={opener}
			onclose={discardDraft}
			><ProjectForm
				bind:draft
				busy={working}
				{stale}
				{error}
				onSave={() => {
					void saveDraft();
				}}
				onCancel={discardDraft}
			/></WindowSheet
		>{/if}
</section>

<style>
	.projects-shell {
		height: 100%;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
		border-radius: inherit;
		container-type: inline-size;
		color: var(--app-text);
		background: var(--app-surface);
		font-size: 13px;
	}
	.app-content {
		height: 100%;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.titlebar {
		height: var(--app-titlebar-height);
		flex: none;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 0 15px;
		background: var(--app-chrome);
		border-bottom: 1px solid var(--app-border);
	}
	.traffic-space {
		flex: 0 0 72px;
	}
	h1 {
		font-size: 13px;
		font-weight: 600;
		margin: 0;
	}
	.save-status {
		margin-left: auto;
		font-size: 11px;
		color: var(--app-text-secondary);
		text-overflow: ellipsis;
		overflow: hidden;
		white-space: nowrap;
	}
	button,
	a,
	select {
		font: inherit;
	}
	button {
		cursor: pointer;
		color: inherit;
	}
	button:disabled {
		cursor: default;
		opacity: 0.45;
	}
	button:focus-visible,
	a:focus-visible,
	select:focus-visible,
	summary:focus-visible {
		outline: 2px solid var(--app-focus);
		outline-offset: 2px;
	}
	.icon-button {
		border: 0;
		background: transparent;
		border-radius: 5px;
		padding: 5px;
		display: flex;
	}
	.icon-button:hover {
		background: var(--app-hover);
	}
	.project-layout {
		display: grid;
		grid-template-columns: 205px minmax(0, 1fr);
		flex: 1;
		min-height: 0;
	}
	.sidebar {
		background: var(--app-sidebar);
		border-right: 1px solid var(--app-border);
		padding: 16px 10px;
		overflow: auto;
		min-width: 0;
	}
	.sidebar button {
		display: flex;
		align-items: center;
		gap: 9px;
		text-align: left;
		width: 100%;
		border: 0;
		padding: 9px 10px;
		border-radius: 6px;
		background: transparent;
	}
	.sidebar button:hover:not(:disabled) {
		background: var(--app-hover);
	}
	.sidebar button.chosen {
		background: var(--app-selection);
	}
	.sidebar-label {
		margin: 24px 10px 7px;
		font-size: 11px;
		font-weight: 600;
		color: var(--app-text-secondary);
	}
	.sidebar .project-nav-row {
		display: block;
		margin-top: 3px;
	}
	.nav-title,
	.nav-state {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.nav-title {
		font-weight: 500;
	}
	.nav-state {
		margin-top: 3px;
		font-size: 11px;
		color: var(--app-text-secondary);
	}
	.sidebar .new-project {
		margin-top: 20px;
		color: var(--app-text-secondary);
	}
	.count {
		margin-left: auto;
		border-radius: 9px;
		background: var(--app-warning-bg);
		color: var(--app-warning);
		padding: 1px 6px;
		font-size: 11px;
	}
	.project-main {
		min-width: 0;
		overflow: auto;
	}
	.page-heading {
		padding: 28px 30px 20px;
	}
	.eyebrow {
		font-size: 11px;
		color: var(--app-text-secondary);
		margin: 0 0 5px;
	}
	h2 {
		margin: 0;
		font-size: 23px;
		font-weight: 600;
		letter-spacing: -0.6px;
		overflow-wrap: anywhere;
	}
	.page-heading p:not(.eyebrow) {
		margin: 9px 0 0;
		color: var(--app-text-secondary);
		line-height: 1.6;
	}
	.project-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 18px;
	}
	.project-heading > div {
		min-width: 0;
	}
	.project-heading button {
		flex-shrink: 0;
		margin-top: 5px;
	}
	h3 {
		font-size: 12px;
		font-weight: 600;
		margin: 0 0 12px;
	}
	.overview-section {
		margin: 10px 30px 26px;
	}
	.overview-section h3 > span {
		color: var(--app-text-secondary);
		font-weight: 400;
		margin-left: 6px;
	}
	.overview-row {
		display: flex;
		align-items: flex-start;
		text-align: left;
		gap: 12px;
		width: 100%;
		background: transparent;
		border: 0;
		border-top: 1px solid var(--app-border);
		padding: 16px 0;
	}
	.overview-row:hover {
		background: var(--app-surface-secondary);
	}
	.project-symbol {
		color: var(--app-info);
		padding-top: 3px;
	}
	.row-copy {
		min-width: 0;
		flex: 1;
	}
	.row-copy strong,
	.row-copy span,
	.row-copy small {
		display: block;
	}
	.row-copy strong {
		font-weight: 600;
		margin-bottom: 5px;
	}
	.row-copy span {
		color: var(--app-text-secondary);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.row-copy small {
		color: var(--app-text-tertiary);
		font-size: 11px;
		margin-top: 7px;
	}
	.row-state {
		flex: 0 0 auto;
		font-size: 11px;
		color: var(--app-text-secondary);
		padding: 3px 6px;
		border-radius: 5px;
	}
	.attention {
		color: var(--app-warning);
		background: var(--app-warning-bg);
	}
	.empty-state {
		max-width: 350px;
		padding: 25px 30px 50px;
		margin: 10px auto;
		text-align: center;
	}
	.empty-state > :global(svg) {
		color: var(--app-info);
		margin-bottom: 18px;
	}
	.empty-state h3 {
		font-size: 16px;
	}
	.empty-state p,
	.empty,
	.no-run p {
		color: var(--app-text-secondary);
		line-height: 1.65;
	}
	.empty-state button {
		margin-top: 12px;
	}
	.empty {
		padding: 0 30px;
	}
	.tabs {
		display: flex;
		gap: 23px;
		margin: 0 30px;
		border-bottom: 1px solid var(--app-border);
	}
	.tabs button {
		background: transparent;
		border: 0;
		border-bottom: 2px solid transparent;
		padding: 10px 0;
		color: var(--app-text-secondary);
	}
	.tabs button.active {
		border-bottom-color: var(--app-accent);
		color: var(--app-text);
	}
	.project-body {
		padding: 23px 30px 30px;
	}
	.run-heading {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.agent-avatar {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		background: var(--app-info-bg);
		color: var(--app-info);
		display: grid;
		place-items: center;
		flex: none;
		font-weight: 600;
	}
	.run-heading strong,
	.run-heading div > span {
		display: block;
	}
	.run-heading strong {
		font-weight: 500;
	}
	.run-heading div > span {
		color: var(--app-text-secondary);
		font-size: 11px;
		margin-top: 4px;
	}
	.run-state {
		font-size: 11px;
		margin-left: auto;
		color: var(--app-text-secondary);
	}
	.run-state.waiting {
		color: var(--app-warning);
	}
	.run-state.completed {
		color: var(--app-success);
	}
	.work-objective {
		font-size: 15px;
		line-height: 1.5;
		margin: 23px 0 12px;
	}
	.handoff-summary,
	.next-action p {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 1.7;
		margin: 0;
	}
	.next-action {
		margin: 20px 0;
		padding-left: 13px;
		border-left: 2px solid var(--app-accent);
	}
	.next-action > span {
		font-size: 11px;
		color: var(--app-text-secondary);
		display: block;
		margin-bottom: 5px;
	}
	.evidence-section {
		margin: 23px 0;
	}
	.evidence-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.evidence-list li {
		margin: 9px 0;
	}
	.evidence-list li > span {
		display: block;
		font-size: 12px;
		margin-top: 4px;
		color: var(--app-text-secondary);
		overflow-wrap: anywhere;
	}
	.text-link,
	.evidence-list a {
		color: var(--app-accent);
		display: inline-flex;
		align-items: center;
		gap: 5px;
		text-decoration: none;
		padding: 0;
		border: 0;
		background: none;
		text-align: left;
		overflow-wrap: anywhere;
	}
	.text-link:hover,
	a:hover {
		text-decoration: underline;
	}
	.decisions {
		background: var(--app-warning-bg);
		border-radius: 8px;
		padding: 16px;
		margin: 23px 0;
	}
	.decisions h3 {
		color: var(--app-warning);
	}
	.decision {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		padding: 8px 0;
	}
	.decision p {
		flex: 1 1 70%;
		margin: 0;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.decision > span {
		flex: 1 1 100%;
		color: var(--app-text-secondary);
		font-size: 11px;
	}
	.answered {
		margin-top: 24px;
	}
	.answered article {
		padding: 11px 0;
		border-top: 1px solid var(--app-border);
	}
	.answered strong {
		font-size: 12px;
		font-weight: 500;
	}
	.answered p {
		margin: 7px 0;
		line-height: 1.6;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.answered span {
		font-size: 11px;
		color: var(--app-text-secondary);
	}
	.standard,
	.primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-height: var(--app-control-height);
		border: 1px solid var(--app-control-border);
		background: var(--app-control);
		padding: 5px 10px;
		border-radius: var(--app-control-radius);
		font-size: 12px;
	}
	.primary {
		background: var(--app-accent);
		color: var(--app-accent-text);
		border-color: transparent;
	}
	.standard:hover:not(:disabled) {
		background: var(--app-surface-secondary);
	}
	.primary:hover:not(:disabled) {
		filter: brightness(1.07);
	}
	.work-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 9px;
		border-top: 1px solid var(--app-border);
		padding-top: 20px;
		margin-top: 25px;
	}
	.resume-brief,
	.agent-instructions {
		margin-top: 25px;
	}
	summary {
		cursor: pointer;
		color: var(--app-accent);
		font-size: 12px;
	}
	pre {
		font:
			11px/1.7 ui-monospace,
			monospace;
		background: var(--app-surface-secondary);
		padding: 13px;
		border-radius: 6px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
	}
	.copy-brief {
		margin-top: 12px;
	}
	.steps {
		list-style: none;
		padding: 0;
		margin: 24px 0;
	}
	.steps li {
		display: flex;
		gap: 12px;
		padding-bottom: 21px;
		position: relative;
	}
	.steps li:not(:last-child)::after {
		position: absolute;
		content: '';
		width: 1px;
		background: var(--app-border);
		left: 13px;
		top: 32px;
		bottom: 5px;
	}
	.step-mark {
		display: grid;
		place-items: center;
		width: 27px;
		height: 27px;
		flex: none;
		border-radius: 50%;
		background: var(--app-surface-secondary);
		color: var(--app-text-secondary);
		font-size: 11px;
	}
	.steps li[data-status='done'] .step-mark {
		color: var(--app-success);
		background: var(--app-info-bg);
	}
	.steps li[data-status='in-progress'] .step-mark {
		color: var(--app-accent);
		background: var(--app-selection);
	}
	.steps strong {
		display: block;
		font-size: 13px;
		font-weight: 500;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.steps div > span {
		display: block;
		color: var(--app-text-secondary);
		font-size: 11px;
		margin-top: 4px;
	}
	.hint,
	.agent-instructions p {
		color: var(--app-text-secondary);
		font-size: 12px;
		line-height: 1.6;
	}
	.history-select {
		display: flex;
		align-items: center;
		gap: 9px;
		margin-top: 20px;
		color: var(--app-text-secondary);
		font-size: 11px;
	}
	.history-select select {
		max-width: 75%;
		min-width: 0;
		color: var(--app-text);
		background: var(--app-control);
		border: 1px solid var(--app-control-border);
		border-radius: 5px;
		padding: 5px;
		font-size: 11px;
	}
	.linked-tasks {
		margin-top: 24px;
	}
	.linked-tasks ul {
		padding: 0;
		list-style: none;
	}
	.linked-tasks li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 0;
		border-bottom: 1px solid var(--app-border);
	}
	.linked-tasks small {
		color: var(--app-text-secondary);
		flex: none;
	}
	.complete {
		color: var(--app-text-secondary);
	}
	.saved-context p {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 1.7;
		margin: 0;
	}
	.file-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 20px;
	}
	.banner {
		flex: none;
		margin: 0;
		padding: 9px 18px;
		font-size: 12px;
		background: var(--app-warning-bg);
		color: var(--app-warning);
	}
	.banner.error {
		color: var(--app-danger);
		background: var(--app-danger-bg);
	}
	.read-warnings {
		margin: 20px 30px;
	}
	.read-warnings p {
		font-size: 12px;
		overflow-wrap: anywhere;
	}
	.link-warnings {
		background: var(--app-warning-bg);
		color: var(--app-warning);
		padding: 7px 12px;
		margin-top: 18px;
		border-radius: 6px;
		font-size: 12px;
	}
	.statusbar {
		flex: none;
		display: flex;
		gap: 12px;
		justify-content: space-between;
		padding: 7px 13px;
		font-size: 10px;
		color: var(--app-text-secondary);
		background: var(--app-chrome);
		border-top: 1px solid var(--app-border);
	}
	.statusbar > span:first-child {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.statusbar > span:last-child {
		flex: none;
	}
	@container (max-width: 640px) {
		.project-layout {
			grid-template-columns: 160px minmax(0, 1fr);
		}
		.page-heading {
			padding: 22px 20px 16px;
		}
		.project-heading {
			flex-wrap: wrap;
			gap: 5px;
		}
		.tabs {
			margin-inline: 20px;
		}
		.project-body {
			padding: 20px;
		}
		.overview-section {
			margin-inline: 20px;
		}
		.overview-row {
			flex-wrap: wrap;
		}
		.row-state {
			margin-left: 34px;
		}
		.run-heading {
			flex-wrap: wrap;
		}
		.run-state {
			margin-left: 42px;
		}
	}
	@container (max-width: 470px) {
		.project-layout {
			display: flex;
			flex-direction: column;
		}
		.sidebar {
			flex: none;
			padding: 7px;
			max-height: 125px;
			border-right: 0;
			border-bottom: 1px solid var(--app-border);
		}
		.sidebar > button {
			width: auto;
			display: inline-flex;
			padding: 5px 8px;
		}
		.sidebar .new-project {
			margin: 0;
		}
		.sidebar-label {
			display: none;
		}
		.project-nav {
			display: flex;
			overflow: auto;
			margin-top: 3px;
			gap: 4px;
		}
		.sidebar .project-nav-row {
			width: auto;
			min-width: 95px;
			max-width: 155px;
			flex: none;
			padding: 6px 8px;
		}
		.nav-title {
			white-space: nowrap;
			font-size: 12px;
		}
		.nav-state {
			font-size: 10px;
		}
		.project-main {
			flex: 1;
		}
		.traffic-space {
			flex-basis: 63px;
		}
		.titlebar {
			gap: 8px;
		}
		h2 {
			font-size: 20px;
		}
		.save-status {
			max-width: 100px;
		}
		.statusbar > span:last-child {
			display: none;
		}
	}
</style>
