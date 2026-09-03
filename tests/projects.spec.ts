import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
	await page.addInitScript(() => {
		const tools: Record<string, any> = {};
		Object.defineProperty(window, '__projectTools', { value: tools });
		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			value: {
				registerTool(tool: any) {
					tools[tool.name] = tool;
				},
			},
		});
	});
	await page.goto('/');
	await ready(page);
}

async function ready(page: Page) {
	await page.waitForFunction(() => Boolean((window as any).__projectTools.projects_answer));
}

async function call(page: Page, name: string, input: Record<string, unknown> = {}) {
	return page.evaluate(
		async ({ name, input }) => (window as any).__projectTools[name].execute(input),
		{ name, input },
	);
}

async function ok(page: Page, name: string, input: Record<string, unknown> = {}) {
	const result = await call(page, name, input);
	expect(result.structuredContent.ok, JSON.stringify(result).slice(0, 2000)).toBe(true);
	return result.structuredContent;
}

const projectPath = '/Projects/Launch/Reader.project.json';
const artifactPath = '/Projects/Launch/Reader findings.md';
const decisionAnswer = 'Keep saved articles until the user removes them.';

async function createProject(page: Page) {
	return ok(page, 'projects_create', {
		path: projectPath,
		title: 'Reader launch',
		objective: 'Prepare an offline reader release plan.',
		context: 'Keep the first release local to this browser.',
	});
}

async function startWork(page: Page, revision: string) {
	return ok(page, 'projects_start', {
		path: projectPath,
		expectedRevision: revision,
		agent: 'Agent A',
		objective: 'Review the notes and prepare a release plan.',
		steps: ['Read the brief', 'Draft the release plan', 'Apply the retention decision'],
	});
}

async function requestDecision(page: Page) {
	const project = await createProject(page);
	const started = await startWork(page, project.revision);
	await ok(page, 'files_write', {
		path: artifactPath,
		content: '# Reader findings\n\nThe offline reader keeps saved articles available.\n',
		createOnly: true,
	});
	return ok(page, 'projects_checkpoint', {
		path: projectPath,
		runId: started.run.id,
		expectedRevision: started.revision,
		status: 'waiting',
		summary: 'Read the notes and saved a draft release plan.',
		nextAction: 'Apply the retention decision to the release plan.',
		steps: started.run.steps.map((step: any, index: number) => ({
			...step,
			status: index < 2 ? 'done' : 'pending',
		})),
		evidence: [
			{ label: 'Reader findings', target: artifactPath, detail: 'Draft release evidence.' },
		],
		decision: {
			question: 'When should saved articles expire?',
			options: ['After 30 days', 'Only when the user removes them'],
		},
	});
}

test('project discovery leaves an empty workspace and activity unchanged', async ({ page }) => {
	await setup(page);
	const activity = await ok(page, 'activity_list');
	const files = await ok(page, 'files_list', { path: '/Projects/Launch' });
	const listed = await ok(page, 'projects_list');
	expect(listed.projects).toEqual([]);
	expect(listed.warnings).toEqual([]);
	expect((await ok(page, 'desktop_get_context')).context.projects).toBeNull();
	expect(await ok(page, 'activity_list')).toEqual(activity);
	expect(await ok(page, 'files_list', { path: '/Projects/Launch' })).toEqual(files);
	await page.getByRole('button', { name: 'Launch Projects app', exact: true }).click();
	await expect(page.locator('[data-app-id="projects"]')).toBeVisible();
	expect((await ok(page, 'projects_list')).projects).toEqual([]);
	expect(await ok(page, 'files_list', { path: '/Projects/Launch' })).toEqual(files);
});

test('a fresh session continues from a human decision and opens the saved result', async ({
	page,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await setup(page);
	const waiting = await requestDecision(page);
	const app = page.locator('[data-app-id="projects"]');
	await expect(app).toContainText('When should saved articles expire?');
	await app.getByRole('button', { name: 'Answer', exact: true }).click();
	await app.getByRole('textbox', { name: 'Decision answer', exact: true }).fill(decisionAnswer);
	await app.getByRole('button', { name: 'Save answer', exact: true }).click();
	await expect(app.getByRole('dialog')).toHaveCount(0);
	await expect(app).toContainText(decisionAnswer);
	const staleAnswer = await call(page, 'projects_answer', {
		path: projectPath,
		decisionId: waiting.decision.id,
		expectedRevision: waiting.revision,
		answer: 'Expire everything after 30 days.',
	});
	expect(staleAnswer.structuredContent.error.code).toBe('FILE_CHANGED');
	await app.screenshot({ path: '/tmp/webmcp-projects-handoff-desktop.png' });

	// Reload discards the page's agent session. Agent B reads only saved project context.
	await page.reload();
	await ready(page);
	const handoff = await ok(page, 'projects_read', { path: projectPath });
	expect(handoff.brief.latestRun).toMatchObject({
		id: waiting.run.id,
		agent: 'Agent A',
		status: 'paused',
		nextAction: 'Apply the retention decision to the release plan.',
	});
	expect(handoff.brief.openDecisions).toEqual([]);
	expect(handoff.brief.recentDecisions).toContainEqual(
		expect.objectContaining({ answer: decisionAnswer }),
	);
	expect(handoff.brief.latestRun.evidence).toContainEqual(
		expect.objectContaining({ target: artifactPath, exists: true }),
	);
	expect(handoff.briefText).toContain(decisionAnswer);
	expect(handoff.briefText).toContain('Apply the retention decision');

	const resumed = await ok(page, 'projects_start', {
		path: projectPath,
		expectedRevision: handoff.revision,
		agent: 'Agent B',
		objective: handoff.brief.latestRun.nextAction,
		steps: ['Read the decision', 'Update the release plan'],
		basedOn: handoff.brief.latestRun.id,
	});
	const evidence = await ok(page, 'files_read', { path: artifactPath });
	await ok(page, 'files_write', {
		path: artifactPath,
		expectedRevision: evidence.revision,
		content: `${evidence.content}\nRetention decision: ${decisionAnswer}\n`,
	});
	const completed = await ok(page, 'projects_checkpoint', {
		path: projectPath,
		runId: resumed.run.id,
		expectedRevision: resumed.revision,
		status: 'completed',
		summary: 'Updated the release plan with the approved retention policy.',
		nextAction: '',
		steps: resumed.run.steps.map((step: any) => ({ ...step, status: 'done' })),
		evidence: [
			{ label: 'Release plan', target: artifactPath, detail: 'Includes the human decision.' },
		],
	});
	expect(completed.run).toMatchObject({
		basedOn: waiting.run.id,
		agent: 'Agent B',
		status: 'completed',
	});
	await ok(page, 'desktop_reveal', { target: 'finder', path: projectPath });
	await page.locator(`[data-path="${projectPath}"]`).dblclick();
	await expect(app).toBeVisible();
	await expect(app).toContainText('Updated the release plan with the approved retention policy.');
	await app.getByRole('button', { name: 'Handoff', exact: true }).click();
	await app.getByRole('button', { name: 'Release plan', exact: true }).click();
	await expect(page.locator('[data-app-id="textedit"]')).toBeVisible();
	expect((await ok(page, 'notes_get_context')).content).toContain(decisionAnswer);
	await page.reload();
	await ready(page);
	const saved = await ok(page, 'projects_read', { path: projectPath });
	expect(saved.brief.latestRun.id).toBe(completed.run.id);
	expect(saved.brief.latestRun.steps.every((step: any) => step.status === 'done')).toBe(true);
	expect(saved.brief.recentDecisions).toContainEqual(
		expect.objectContaining({ answer: decisionAnswer }),
	);
	expect(errors).toEqual([]);
});

test('simultaneous project edits reject a stale revision without losing the saved update', async ({
	page,
}) => {
	await setup(page);
	const project = await createProject(page);
	const results = await Promise.all(
		['First proposal', 'Second proposal'].map((objective) =>
			call(page, 'projects_update', {
				path: projectPath,
				expectedRevision: project.revision,
				changes: { objective },
			}),
		),
	);
	const saved = results.filter((result) => result.structuredContent.ok);
	expect(saved).toHaveLength(1);
	expect(results.find((result) => !result.structuredContent.ok).structuredContent.error.code).toBe(
		'FILE_CHANGED',
	);
	const current = await ok(page, 'projects_read', { path: projectPath });
	expect(current.revision).toBe(saved[0].structuredContent.revision);
	expect(current.brief.objective).toBe(saved[0].structuredContent.brief.objective);
});

test('recent decisions follow answer time while the project file keeps every decision', async ({
	page,
}) => {
	await setup(page);
	const project = await createProject(page);
	const started = await startWork(page, project.revision);
	const decisions: string[] = [];
	let revision = started.revision;
	for (let index = 0; index < 12; index++) {
		const checkpoint = await ok(page, 'projects_checkpoint', {
			path: projectPath,
			runId: started.run.id,
			expectedRevision: revision,
			decision: { question: `Which approach should we use for release item ${index + 1}?` },
		});
		revision = checkpoint.revision;
		decisions.push(checkpoint.decision.id);
	}
	for (const id of [...decisions.slice(1), decisions[0]]) {
		const answer = await ok(page, 'projects_answer', {
			path: projectPath,
			decisionId: id,
			expectedRevision: revision,
			answer: `Approved approach for ${id}.`,
		});
		revision = answer.revision;
	}
	await page.reload();
	await ready(page);
	const saved = await ok(page, 'projects_read', { path: projectPath });
	expect(saved.brief.recentDecisions).toHaveLength(10);
	expect(saved.brief.recentDecisions[0].id).toBe(decisions[0]);
	expect(saved.brief.recentDecisions.map((decision: any) => decision.id)).toEqual([
		decisions[0],
		...decisions.slice(3).reverse(),
	]);
	expect(saved.brief.omittedDecisions).toBe(2);
	expect(saved.brief.openDecisions).toEqual([]);
	const raw = JSON.parse((await ok(page, 'files_read', { path: projectPath })).content);
	expect(raw.decisions.map((decision: any) => decision.id)).toEqual(decisions);
	for (const decision of raw.decisions) {
		expect(decision.answer).toBe(`Approved approach for ${decision.id}.`);
		expect(decision.answeredAt).not.toBeNull();
	}
});

test('malformed project files do not hide valid projects or get replaced', async ({ page }) => {
	await setup(page);
	await createProject(page);
	const badPath = '/Projects/Launch/Broken.project.json';
	const broken = '{"format":"webmcp-project", "unfinished":';
	await ok(page, 'files_write', { path: badPath, content: broken, createOnly: true });
	const listing = await ok(page, 'projects_list');
	expect(listing.projects).toContainEqual(
		expect.objectContaining({ path: projectPath, title: 'Reader launch' }),
	);
	expect(listing.warnings).toContainEqual(expect.objectContaining({ path: badPath }));
	expect((await call(page, 'projects_read', { path: badPath })).structuredContent.error.code).toBe(
		'INVALID_DATA',
	);
	expect((await ok(page, 'files_read', { path: badPath })).content).toBe(broken);
});

test('editing a project title preserves reference punctuation and multiline details', async ({
	page,
}) => {
	await setup(page);
	const reference = {
		target: '/Projects/Launch/brief.md',
		label: 'Launch brief | approved',
		detail: 'Read the first section.\nKeep these notes | including the second line.',
	};
	await ok(page, 'projects_create', {
		path: projectPath,
		title: 'Reader launch',
		objective: 'Prepare the release plan.',
		references: [reference],
	});
	const app = page.locator('[data-app-id="projects"]');
	await app.getByRole('button', { name: 'Edit project', exact: true }).click();
	await expect(app.getByRole('textbox', { name: 'Reference 1 target', exact: true })).toHaveValue(
		reference.target,
	);
	await expect(app.getByRole('textbox', { name: 'Reference 1 label', exact: true })).toHaveValue(
		reference.label,
	);
	await expect(app.getByRole('textbox', { name: 'Reference 1 detail', exact: true })).toHaveValue(
		reference.detail,
	);
	await app.getByRole('textbox', { name: 'Project title', exact: true }).fill('Reader release');
	await app.getByRole('button', { name: 'Save project', exact: true }).click();
	await expect(app.getByRole('dialog')).toHaveCount(0);
	await page.reload();
	await ready(page);
	const saved = await ok(page, 'projects_read', { path: projectPath });
	expect(saved.brief.title).toBe('Reader release');
	expect(saved.brief.references).toEqual([{ ...reference, exists: true }]);
});

test('editing the ordered plan preserves existing step IDs through rename, reorder and removal', async ({
	page,
}) => {
	await setup(page);
	const project = await createProject(page);
	const started = await startWork(page, project.revision);
	const original = started.run.steps;
	const app = page.locator('[data-app-id="projects"]');
	await app.getByRole('button', { name: 'Update checkpoint', exact: true }).click();
	await app.getByRole('textbox', { name: 'Step 1 title', exact: true }).fill('Read approved notes');
	await app.getByRole('button', { name: 'Move step 1 down', exact: true }).click();
	await app.getByRole('button', { name: 'Remove step 3', exact: true }).click();
	await app.getByRole('button', { name: 'Add step', exact: true }).click();
	await app.getByRole('textbox', { name: 'Step 3 title', exact: true }).fill('Confirm the output');
	await app
		.getByRole('textbox', { name: 'Summary', exact: true })
		.fill('Revised the plan after reviewing the notes.');
	await app.getByRole('button', { name: 'Save checkpoint', exact: true }).click();
	await expect(app.getByRole('dialog')).toHaveCount(0);
	await page.reload();
	await ready(page);
	const saved = await ok(page, 'projects_read', { path: projectPath });
	const steps = saved.brief.latestRun.steps;
	expect(steps).toHaveLength(3);
	expect(steps[0]).toEqual(original[1]);
	expect(steps[1]).toEqual({ ...original[0], title: 'Read approved notes' });
	expect(steps[2]).toMatchObject({ title: 'Confirm the output', status: 'pending' });
	expect(original.map((step: any) => step.id)).not.toContain(steps[2].id);
	expect(steps.map((step: any) => step.id)).not.toContain(original[2].id);
	await ok(page, 'desktop_reveal', { path: projectPath });
	await app.getByRole('button', { name: 'Work', exact: true }).click();
	const visibleSteps = app
		.getByRole('list', { name: 'Work steps', exact: true })
		.getByRole('listitem');
	await expect(visibleSteps.nth(0)).toContainText(original[1].title);
	await expect(visibleSteps.nth(1)).toContainText('Read approved notes');
	await expect(visibleSteps.nth(2)).toContainText('Confirm the output');
});

test('work cannot be replaced or completed without an explicit valid checkpoint', async ({
	page,
}) => {
	await setup(page);
	const project = await createProject(page);
	const started = await startWork(page, project.revision);
	const replacement = await call(page, 'projects_start', {
		path: projectPath,
		expectedRevision: started.revision,
		agent: 'Agent B',
		objective: 'Replace active work',
		steps: ['Do something else'],
		basedOn: started.run.id,
	});
	expect(replacement.structuredContent.ok).toBe(false);
	const unfinished = await call(page, 'projects_checkpoint', {
		path: projectPath,
		runId: started.run.id,
		expectedRevision: started.revision,
		status: 'completed',
		summary: 'Claimed complete with unfinished steps.',
	});
	expect(unfinished.structuredContent.ok).toBe(false);
	expect((await ok(page, 'projects_read', { path: projectPath })).revision).toBe(started.revision);
	const paused = await ok(page, 'projects_checkpoint', {
		path: projectPath,
		runId: started.run.id,
		expectedRevision: started.revision,
		status: 'paused',
		summary: 'The source notes still need review.',
		nextAction: 'Read the source notes before drafting.',
	});
	const blindResume = await call(page, 'projects_start', {
		path: projectPath,
		expectedRevision: paused.revision,
		agent: 'Agent B',
		objective: 'Continue without reading the handoff',
		steps: ['Draft a plan'],
	});
	expect(blindResume.structuredContent.ok).toBe(false);
	expect((await ok(page, 'projects_read', { path: projectPath })).revision).toBe(paused.revision);
});

test('missing evidence stays visible and cannot be added as new evidence', async ({ page }) => {
	await setup(page);
	const waiting = await requestDecision(page);
	await ok(page, 'files_trash', { path: artifactPath });
	const read = await ok(page, 'projects_read', { path: projectPath });
	expect(read.brief.latestRun.evidence).toContainEqual(
		expect.objectContaining({ target: artifactPath, exists: false }),
	);
	const failed = await call(page, 'projects_checkpoint', {
		path: projectPath,
		runId: waiting.run.id,
		expectedRevision: read.revision,
		evidence: [{ label: 'Missing result', target: '/Documents/Missing result.md', detail: '' }],
	});
	expect(failed.structuredContent.ok).toBe(false);
	expect((await ok(page, 'projects_read', { path: projectPath })).revision).toBe(read.revision);
	await expect(page.locator('[data-app-id="projects"]')).toContainText(/missing/i);
});

test('human drafts survive external edits and prevent unsafe restore or closing', async ({
	page,
}) => {
	await setup(page);
	const initial = await createProject(page);
	const project = await ok(page, 'projects_update', {
		path: projectPath,
		expectedRevision: initial.revision,
		changes: { context: 'Use the approved source notes.' },
	});
	const version = (await ok(page, 'review_list', { path: projectPath })).versions[0];
	const beforeDraft = (await ok(page, 'review_read', { versionId: version.id })).review;
	expect(beforeDraft.canRestore).toBe(true);
	const app = page.locator('[data-app-id="projects"]');
	await app.getByRole('button', { name: 'Edit project', exact: true }).click();
	await app
		.getByRole('textbox', { name: 'Objective', exact: true })
		.fill('My unsaved project objective.');
	await page.getByRole('button', { name: 'Close Projects', exact: true }).click();
	await expect(app).toBeVisible();
	const attempted = await call(page, 'projects_update', {
		path: projectPath,
		expectedRevision: project.revision,
		changes: { objective: 'Agent overwrite' },
	});
	expect(attempted.structuredContent.error.code).toBe('OPEN_DRAFT');
	const blockedReview = (await ok(page, 'review_read', { versionId: version.id })).review;
	expect(blockedReview.canRestore).toBe(false);
	const restore = await call(page, 'review_restore', {
		versionId: version.id,
		mode: 'replace',
		expectedCurrentToken: beforeDraft.current.token,
	});
	expect(restore.structuredContent.ok).toBe(false);
	expect(beforeDraft.suggestedCopy).toMatch(/\.project\.json$/);
	await ok(page, 'review_restore', {
		versionId: version.id,
		mode: 'copy',
		destination: beforeDraft.suggestedCopy,
	});
	expect((await ok(page, 'projects_read', { path: beforeDraft.suggestedCopy })).brief.context).toBe(
		'Keep the first release local to this browser.',
	);
	await expect(app.getByRole('textbox', { name: 'Objective', exact: true })).toHaveValue(
		'My unsaved project objective.',
	);
	expect((await ok(page, 'projects_read', { path: projectPath })).brief.objective).toBe(
		'Prepare an offline reader release plan.',
	);
	const disk = await ok(page, 'files_read', { path: projectPath });
	await ok(page, 'files_patch', {
		path: projectPath,
		expectedRevision: disk.revision,
		find: 'Prepare an offline reader release plan.',
		replace: 'Agent changed the saved objective.',
	});
	await expect(app.getByRole('textbox', { name: 'Objective', exact: true })).toHaveValue(
		'My unsaved project objective.',
	);
	await expect(app.getByRole('button', { name: 'Save project', exact: true })).toBeDisabled();
	await app.getByRole('button', { name: 'Discard changes', exact: true }).click();
	await app.getByRole('button', { name: 'Edit project', exact: true }).click();
	await expect(app.getByRole('textbox', { name: 'Objective', exact: true })).toHaveValue(
		'Agent changed the saved objective.',
	);
	await app
		.getByRole('textbox', { name: 'Objective', exact: true })
		.fill('My unsaved project objective.');
	await app.getByRole('button', { name: 'Save project', exact: true }).click();
	await expect(app.getByRole('dialog')).toHaveCount(0);
	expect((await ok(page, 'projects_read', { path: projectPath })).brief.objective).toBe(
		'My unsaved project objective.',
	);
	await page.getByRole('button', { name: 'Close Projects', exact: true }).click();
	await expect(app).toHaveCount(0);
});

test('project context follows the visible selection and clears when minimized', async ({
	page,
}) => {
	await setup(page);
	await createProject(page);
	const selected = (await ok(page, 'desktop_get_context')).context.projects;
	expect(selected).toMatchObject({ path: projectPath });
	await page.getByRole('button', { name: 'Minimize Projects', exact: true }).click();
	expect((await ok(page, 'desktop_get_context')).context.projects).toBeNull();
	await ok(page, 'desktop_reveal', { target: 'projects' });
	expect((await ok(page, 'desktop_get_context')).context.projects).toMatchObject({
		path: projectPath,
	});
});

test('the overview finds waiting work and the selected project follows a file move', async ({
	page,
}) => {
	await setup(page);
	await requestDecision(page);
	const secondPath = '/Documents/Pricing.project.json';
	await ok(page, 'projects_create', {
		path: secondPath,
		title: 'Pricing review',
		objective: 'Review the launch price.',
	});
	const app = page.locator('[data-app-id="projects"]');
	await expect(app.getByRole('heading', { name: 'Pricing review', exact: true })).toBeVisible();
	await app.getByRole('button', { name: /^Overview/ }).click();
	const attention = app.getByRole('region', { name: 'Needs you', exact: true });
	await expect(attention).toContainText('Reader launch');
	await expect(attention).not.toContainText('Pricing review');
	await attention.getByRole('button', { name: /Reader launch/ }).click();
	await expect(app.getByRole('heading', { name: 'Reader launch', exact: true })).toBeVisible();
	expect((await ok(page, 'desktop_get_context')).context.projects.path).toBe(projectPath);
	const movedPath = '/Projects/Launch/Moved reader.project.json';
	await ok(page, 'files_move', { source: projectPath, destination: movedPath });
	await expect
		.poll(async () => (await ok(page, 'desktop_get_context')).context.projects.path)
		.toBe(movedPath);
	expect((await ok(page, 'projects_list')).projects.map((project: any) => project.path)).toContain(
		movedPath,
	);
	await page.reload();
	await ready(page);
	expect((await ok(page, 'projects_read')).path).toBe(movedPath);
});

test('a compact desktop can create work, save a checkpoint and answer its decision', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 720 });
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await setup(page);
	await page.getByRole('button', { name: 'Launch Projects app', exact: true }).click();
	const app = page.locator('[data-app-id="projects"]');
	await app.getByRole('button', { name: 'New project', exact: true }).first().click();
	await app.getByRole('textbox', { name: 'Project title', exact: true }).fill('Reader launch');
	await app.getByRole('textbox', { name: 'Workspace path', exact: true }).fill(projectPath);
	await app
		.getByRole('textbox', { name: 'Objective', exact: true })
		.fill('Prepare the reader release.');
	await app.getByRole('button', { name: 'Create project', exact: true }).click();
	await expect(app.getByRole('dialog')).toHaveCount(0);
	await app.getByRole('button', { name: 'Start work', exact: true }).click();
	await app.getByRole('textbox', { name: 'Agent name', exact: true }).fill('Morgan');
	await app
		.getByRole('textbox', { name: 'Work objective', exact: true })
		.fill('Review the retention policy.');
	await app
		.getByRole('textbox', { name: 'Steps', exact: true })
		.fill('Read the source notes\nApply the retention policy');
	await app.getByRole('dialog').getByRole('button', { name: 'Start work', exact: true }).click();
	await expect(app.getByRole('dialog')).toHaveCount(0);
	await app.getByRole('button', { name: 'Update checkpoint', exact: true }).click();
	await app.getByRole('combobox', { name: 'Status', exact: true }).selectOption('waiting');
	await app
		.getByRole('textbox', { name: 'Summary', exact: true })
		.fill('The source notes need a retention decision.');
	await app
		.getByRole('textbox', { name: 'Next action', exact: true })
		.fill('Apply the approved retention policy.');
	await app
		.getByRole('combobox', { name: 'Status for Read the source notes', exact: true })
		.selectOption('done');
	await app
		.getByRole('textbox', { name: 'Question for the user', exact: true })
		.fill('When should saved articles expire?');
	await app.getByRole('button', { name: 'Save checkpoint', exact: true }).click();
	await expect(app.getByRole('dialog')).toHaveCount(0);
	await app.getByRole('button', { name: 'Handoff', exact: true }).click();
	await app.getByRole('button', { name: 'Answer', exact: true }).click();
	await app.getByRole('textbox', { name: 'Decision answer', exact: true }).fill(decisionAnswer);
	await app.getByRole('button', { name: 'Save answer', exact: true }).click();
	await expect(app.getByRole('dialog')).toHaveCount(0);
	await app.getByRole('button', { name: 'Handoff', exact: true }).click();
	await expect(app).toContainText(decisionAnswer);
	const saved = await ok(page, 'projects_read', { path: projectPath });
	expect(saved.brief.latestRun).toMatchObject({ agent: 'Morgan', status: 'paused' });
	expect(saved.brief.latestRun.steps[0].status).toBe('done');
	expect(saved.brief.recentDecisions).toContainEqual(
		expect.objectContaining({ answer: decisionAnswer }),
	);
	await app.screenshot({ path: '/tmp/webmcp-projects-handoff-compact.png' });
	const bounds = (await app.boundingBox())!;
	expect(bounds.x).toBeGreaterThanOrEqual(0);
	expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
	expect(bounds.y + bounds.height).toBeLessThanOrEqual(720);
	expect(await page.locator('#windows-area').evaluate((element) => element.scrollTop)).toBe(0);
	expect(errors).toEqual([]);
});
