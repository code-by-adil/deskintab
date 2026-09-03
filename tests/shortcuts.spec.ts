import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
	await page.addInitScript(() => {
		const tools: Record<string, any> = {};
		Object.defineProperty(window, '__shortcutTools', { value: tools });
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
	await page.waitForFunction(() => Boolean((window as any).__shortcutTools.shortcuts_prepare));
}

async function call(page: Page, name: string, input: Record<string, unknown> = {}) {
	return page.evaluate(
		async ({ name, input }) => (window as any).__shortcutTools[name].execute(input),
		{ name, input },
	);
}

async function ok(page: Page, name: string, input: Record<string, unknown> = {}) {
	const result = await call(page, name, input);
	expect(result.structuredContent.ok, JSON.stringify(result).slice(0, 2000)).toBe(true);
	return result.structuredContent;
}

async function expectMissing(page: Page, path: string) {
	const result = await call(page, 'files_read', { path });
	expect(result.structuredContent.ok, path).toBe(false);
	expect(result.structuredContent.error.code, path).toBe('PATH_NOT_FOUND');
}

const shortcutPath = '/Documents/Source review.shortcut.json';
const sourcePath = '/Projects/Launch/Review procedure.md';
const inputPath = '/Projects/Launch/Sprint notes.md';
const projectPath = '/Projects/Launch/Source review.project.json';
const workOrderPath = '/Projects/Launch/Review work order.md';
const shortcutInput = {
	title: 'Review source notes',
	description: 'Turn a set of project notes into a cited status report.',
	procedure:
		'Read the supplied notes.\nCompare them with the review procedure.\nSave a cited report.',
	requiredInputs: ['Notes to review', 'Audience and scope'],
	sourcePaths: [sourcePath],
	outputGuidance: 'Save a Markdown report with evidence links and open questions.',
};

async function createShortcut(page: Page) {
	await ok(page, 'files_write', {
		path: sourcePath,
		content: '# Review procedure\n\nKeep verified findings separate from open questions.\n',
		createOnly: true,
	});
	return ok(page, 'shortcuts_create', { path: shortcutPath, ...shortcutInput });
}

async function prepareProject(page: Page, revision: string) {
	await ok(page, 'files_write', {
		path: inputPath,
		content: '# Sprint notes\n\nThe offline reader has a saved retention decision.\n',
		createOnly: true,
	});
	return ok(page, 'shortcuts_prepare', {
		path: shortcutPath,
		expectedRevision: revision,
		projectPath,
		newProject: {
			title: 'Reader status review',
			objective: 'Prepare a status report from the current reader notes.',
			context: 'Keep the review local to this workspace.',
		},
		inputPaths: [inputPath],
		inputText: 'Review sprint 9 for the release team.',
		workOrderPath,
	});
}

test('shortcut discovery leaves an empty workspace and activity unchanged', async ({ page }) => {
	await setup(page);
	const files = await ok(page, 'files_list', { path: '/Documents' });
	const activity = await ok(page, 'activity_list');
	const listed = await ok(page, 'shortcuts_list');
	expect(listed.shortcuts).toEqual([]);
	expect(listed.warnings).toEqual([]);
	expect(await ok(page, 'files_list', { path: '/Documents' })).toEqual(files);
	expect(await ok(page, 'activity_list')).toEqual(activity);
});

test('shortcuts keep their procedure and references after edits and reload', async ({ page }) => {
	await setup(page);
	const created = await createShortcut(page);
	const changed = await ok(page, 'shortcuts_update', {
		path: shortcutPath,
		expectedRevision: created.revision,
		changes: { title: 'Review release notes', description: 'Review notes | preserve evidence.' },
	});
	expect(changed.revision).not.toBe(created.revision);
	await page.reload();
	await ready(page);
	const saved = await ok(page, 'shortcuts_read', { path: shortcutPath });
	expect(saved.revision).toBe(changed.revision);
	expect(saved.data).toMatchObject({
		...shortcutInput,
		title: 'Review release notes',
		description: 'Review notes | preserve evidence.',
	});
	expect((await ok(page, 'shortcuts_list')).shortcuts).toContainEqual(
		expect.objectContaining({ path: shortcutPath, title: 'Review release notes' }),
	);
	const duplicate = await call(page, 'shortcuts_create', { path: shortcutPath, ...shortcutInput });
	expect(duplicate.structuredContent.ok).toBe(false);
	expect((await ok(page, 'shortcuts_read', { path: shortcutPath })).revision).toBe(
		changed.revision,
	);
});

test('malformed shortcut files stay intact without hiding valid shortcuts', async ({ page }) => {
	await setup(page);
	await createShortcut(page);
	const brokenPath = '/Documents/Broken.shortcut.json';
	const content = '{"format":"webmcp-shortcut", "procedure":';
	await ok(page, 'files_write', { path: brokenPath, content, createOnly: true });
	const listed = await ok(page, 'shortcuts_list');
	expect(listed.shortcuts).toContainEqual(
		expect.objectContaining({ path: shortcutPath, title: shortcutInput.title }),
	);
	expect(listed.warnings).toContainEqual(expect.objectContaining({ path: brokenPath }));
	expect((await call(page, 'shortcuts_read', { path: brokenPath })).structuredContent.ok).toBe(
		false,
	);
	expect((await ok(page, 'files_read', { path: brokenPath })).content).toBe(content);
});

test('preparing twice saves distinct work orders and paused project handoffs across reload', async ({
	page,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await setup(page);
	const shortcut = await createShortcut(page);
	const first = await prepareProject(page, shortcut.revision);
	expect(first).toMatchObject({
		shortcutPath,
		workOrderPath,
		projectPath,
		status: 'prepared',
	});
	expect(first.runId).toBeTruthy();
	const workOrder = await ok(page, 'files_read', { path: workOrderPath });
	for (const detail of [
		shortcutInput.title,
		shortcutInput.procedure,
		...shortcutInput.requiredInputs,
		shortcutInput.outputGuidance,
		shortcutPath,
		sourcePath,
		inputPath,
		'Review sprint 9 for the release team.',
	]) {
		expect(workOrder.content).toContain(detail);
	}
	const handoff = await ok(page, 'projects_read', { path: projectPath });
	expect(handoff.revision).toBe(first.projectRevision);
	expect(handoff.brief.latestRun).toMatchObject({ id: first.runId, status: 'paused' });
	expect(handoff.brief.latestRun.steps.length).toBeGreaterThan(0);
	expect(handoff.brief.latestRun.steps.every((step: any) => step.status === 'pending')).toBe(true);
	expect(handoff.brief.latestRun.evidence).toContainEqual(
		expect.objectContaining({ target: workOrderPath, exists: true }),
	);
	expect(handoff.brief.latestRun.nextAction).toContain(workOrderPath);
	expect((await ok(page, 'shortcuts_read', { path: shortcutPath })).revision).toBe(
		shortcut.revision,
	);

	const secondPath = '/Projects/Launch/Second review work order.md';
	const second = await ok(page, 'shortcuts_prepare', {
		path: shortcutPath,
		expectedRevision: shortcut.revision,
		projectPath,
		projectRevision: first.projectRevision,
		inputPaths: [inputPath],
		inputText: 'Review sprint 10 for the same release team.',
		workOrderPath: secondPath,
	});
	expect(second.status).toBe('prepared');
	expect(second.runId).not.toBe(first.runId);
	expect(second.projectRevision).not.toBe(first.projectRevision);
	expect((await ok(page, 'files_read', { path: workOrderPath })).content).toBe(workOrder.content);
	expect((await ok(page, 'files_read', { path: secondPath })).content).toContain(
		'Review sprint 10 for the same release team.',
	);
	await ok(page, 'shortcuts_update', {
		path: shortcutPath,
		expectedRevision: shortcut.revision,
		changes: { procedure: 'Use the updated review procedure for future work orders.' },
	});

	await page.reload();
	await ready(page);
	const saved = await ok(page, 'projects_read', { path: projectPath });
	expect(saved.revision).toBe(second.projectRevision);
	expect(saved.brief.latestRun).toMatchObject({ id: second.runId, status: 'paused' });
	const project = JSON.parse((await ok(page, 'files_read', { path: projectPath })).content);
	expect(project.runs.map((run: any) => run.id)).toEqual([first.runId, second.runId]);
	expect(project.runs.every((run: any) => run.status === 'paused')).toBe(true);
	expect(
		project.runs.every((run: any) => run.steps.every((step: any) => step.status === 'pending')),
	).toBe(true);
	expect((await ok(page, 'files_read', { path: secondPath })).content).toContain(
		'Review sprint 10 for the same release team.',
	);
	expect((await ok(page, 'files_read', { path: workOrderPath })).content).toBe(workOrder.content);
	expect((await ok(page, 'files_read', { path: secondPath })).content).toContain(
		shortcutInput.procedure,
	);
	expect(errors).toEqual([]);
});

test('stale shortcut and project revisions reject preparation before creating a work order', async ({
	page,
}) => {
	await setup(page);
	const shortcut = await createShortcut(page);
	const project = await ok(page, 'projects_create', {
		path: projectPath,
		title: 'Reader status review',
		objective: 'Review the current source notes.',
	});
	const changedShortcut = await ok(page, 'shortcuts_update', {
		path: shortcutPath,
		expectedRevision: shortcut.revision,
		changes: { procedure: 'Read all notes before saving a cited status report.' },
	});
	const staleUpdate = await call(page, 'shortcuts_update', {
		path: shortcutPath,
		expectedRevision: shortcut.revision,
		changes: { title: 'Overwrite newer shortcut' },
	});
	expect(staleUpdate.structuredContent.error.code).toBe('FILE_CHANGED');
	const staleShortcut = await call(page, 'shortcuts_prepare', {
		path: shortcutPath,
		expectedRevision: shortcut.revision,
		projectPath,
		projectRevision: project.revision,
		inputPaths: [],
		inputText: 'Review source notes for the release team.',
		workOrderPath,
	});
	expect(staleShortcut.structuredContent.error.code).toBe('FILE_CHANGED');
	await expectMissing(page, workOrderPath);
	expect((await ok(page, 'projects_read', { path: projectPath })).revision).toBe(project.revision);

	const changedProject = await ok(page, 'projects_update', {
		path: projectPath,
		expectedRevision: project.revision,
		changes: { context: 'A person added a scope decision.' },
	});
	const staleProject = await call(page, 'shortcuts_prepare', {
		path: shortcutPath,
		expectedRevision: changedShortcut.revision,
		projectPath,
		projectRevision: project.revision,
		inputPaths: [],
		inputText: 'Review source notes for the release team.',
		workOrderPath,
	});
	expect(staleProject.structuredContent.error.code).toBe('FILE_CHANGED');
	await expectMissing(page, workOrderPath);
	expect((await ok(page, 'projects_read', { path: projectPath })).revision).toBe(
		changedProject.revision,
	);
	expect((await ok(page, 'shortcuts_read', { path: shortcutPath })).revision).toBe(
		changedShortcut.revision,
	);
});

test('invalid shortcut definitions are rejected without creating files', async ({ page }) => {
	await setup(page);
	await ok(page, 'files_write', {
		path: sourcePath,
		content: 'Approved procedure source.',
		createOnly: true,
	});
	const cases = [
		{ title: ' ' },
		{ procedure: '' },
		{ requiredInputs: [''] },
		{ sourcePaths: ['/Documents/Missing source.md'] },
		{ sourcePaths: ['/Documents'] },
		{ sourcePaths: ['/System/settings.json'] },
		{ command: 'touch /Documents/Unexpected result.md' },
	];
	for (const changes of cases) {
		const result = await call(page, 'shortcuts_create', {
			path: shortcutPath,
			...shortcutInput,
			...changes,
		});
		expect(result.structuredContent.ok, JSON.stringify(changes)).toBe(false);
		await expectMissing(page, shortcutPath);
	}
	for (const path of [
		'/Documents/Wrong extension.json',
		'/System/Hidden.shortcut.json',
		'/Trash/Deleted.shortcut.json',
	]) {
		const result = await call(page, 'shortcuts_create', { path, ...shortcutInput });
		expect(result.structuredContent.ok, path).toBe(false);
		await expectMissing(page, path);
	}
	expect((await ok(page, 'shortcuts_list')).shortcuts).toEqual([]);
});

test('missing inputs and deleted source files cannot leave a partial new project', async ({
	page,
}) => {
	await setup(page);
	const shortcut = await createShortcut(page);
	const inputs = [
		{ inputPaths: [], inputText: '' },
		{ inputPaths: ['/Documents/Missing input.md'], inputText: 'Review the missing notes.' },
		{ inputPaths: ['/Documents'], inputText: 'Review this directory as a file.' },
	];
	for (const input of inputs) {
		const result = await call(page, 'shortcuts_prepare', {
			path: shortcutPath,
			expectedRevision: shortcut.revision,
			projectPath,
			newProject: { title: 'Review', objective: 'Review the supplied notes.' },
			...input,
			workOrderPath,
		});
		expect(result.structuredContent.ok, JSON.stringify(input)).toBe(false);
		await expectMissing(page, workOrderPath);
		await expectMissing(page, projectPath);
	}
	await ok(page, 'files_trash', { path: sourcePath });
	const missingSource = await call(page, 'shortcuts_prepare', {
		path: shortcutPath,
		expectedRevision: shortcut.revision,
		projectPath,
		newProject: { title: 'Review', objective: 'Review the supplied notes.' },
		inputPaths: [],
		inputText: 'Review the available notes for the release team.',
		workOrderPath,
	});
	expect(missingSource.structuredContent.ok).toBe(false);
	await expectMissing(page, workOrderPath);
	await expectMissing(page, projectPath);
	const savedShortcut = await ok(page, 'shortcuts_read', { path: shortcutPath });
	expect(savedShortcut.revision).toBe(shortcut.revision);
	expect(savedShortcut.sourceFiles).toContainEqual({ path: sourcePath, exists: false });
});

test('preparation preserves existing output and requires the current existing project revision', async ({
	page,
}) => {
	await setup(page);
	const shortcut = await createShortcut(page);
	const project = await ok(page, 'projects_create', {
		path: projectPath,
		title: 'Reader status review',
		objective: 'Review the current source notes.',
	});
	const input = {
		path: shortcutPath,
		expectedRevision: shortcut.revision,
		projectPath,
		inputPaths: [],
		inputText: 'Review the notes for the release team.',
		workOrderPath,
	};
	const noRevision = await call(page, 'shortcuts_prepare', input);
	expect(noRevision.structuredContent.ok).toBe(false);
	await expectMissing(page, workOrderPath);
	await ok(page, 'files_write', {
		path: workOrderPath,
		content: '# Existing work order\n\nA person saved this file.\n',
		createOnly: true,
	});
	const original = await ok(page, 'files_read', { path: workOrderPath });
	const collision = await call(page, 'shortcuts_prepare', {
		...input,
		projectRevision: project.revision,
	});
	expect(collision.structuredContent.ok).toBe(false);
	expect(await ok(page, 'files_read', { path: workOrderPath })).toEqual(original);
	expect((await ok(page, 'projects_read', { path: projectPath })).revision).toBe(project.revision);
});

test('a person can create, edit, and prepare a shortcut before opening the saved work order', async ({
	page,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await setup(page);
	await ok(page, 'files_write', {
		path: sourcePath,
		content: '# Review procedure\n\nRetain evidence links and open questions.\n',
		createOnly: true,
	});
	await page.getByRole('button', { name: 'Launch Shortcuts app', exact: true }).click();
	const app = page.locator('[data-app-id="shortcuts"]');
	await app.getByRole('button', { name: 'New shortcut', exact: true }).first().click();
	await app.getByRole('textbox', { name: 'Shortcut name', exact: true }).fill(shortcutInput.title);
	await app
		.getByRole('textbox', { name: 'Description', exact: true })
		.fill(shortcutInput.description);
	await app.getByRole('textbox', { name: 'Procedure', exact: true }).fill(shortcutInput.procedure);
	await app
		.getByRole('textbox', { name: 'Required inputs', exact: true })
		.fill(shortcutInput.requiredInputs.join('\n'));
	await app
		.getByRole('textbox', { name: 'Template and source files', exact: true })
		.fill(sourcePath);
	await app
		.getByRole('textbox', { name: 'Expected output', exact: true })
		.fill(shortcutInput.outputGuidance);
	await app.getByRole('textbox', { name: 'Save path', exact: true }).fill(shortcutPath);
	await app.getByRole('button', { name: 'Save shortcut', exact: true }).click();
	await expect(app.getByRole('heading', { name: shortcutInput.title, exact: true })).toBeVisible();
	await app.getByRole('button', { name: 'Edit shortcut', exact: true }).click();
	await app
		.getByRole('textbox', { name: 'Shortcut name', exact: true })
		.fill('Prepare a release review');
	await app.getByRole('button', { name: 'Save shortcut', exact: true }).click();
	await expect(
		app.getByRole('heading', { name: 'Prepare a release review', exact: true }),
	).toBeVisible();
	const savedShortcut = await ok(page, 'shortcuts_read', { path: shortcutPath });
	expect(savedShortcut.data).toMatchObject({ ...shortcutInput, title: 'Prepare a release review' });

	await app.getByRole('button', { name: 'Prepare work', exact: true }).click();
	await app
		.getByRole('textbox', { name: 'Project name', exact: true })
		.fill('Reader release review');
	await app
		.getByRole('textbox', { name: 'Project objective', exact: true })
		.fill('Review the release notes for the reader team.');
	await app.getByRole('textbox', { name: 'Project file', exact: true }).fill(projectPath);
	await app
		.getByRole('textbox', { name: 'Request and input notes', exact: true })
		.fill('Review the retained offline articles for the release team.');
	await app.getByRole('textbox', { name: 'Work order file', exact: true }).fill(workOrderPath);
	await app.getByRole('button', { name: 'Prepare work order', exact: true }).click();
	const prepared = app.getByRole('region', { name: 'Prepared work', exact: true });
	await expect(prepared).toContainText(
		'Give the project brief to your connected agent to start the work.',
	);
	await expect(prepared).toBeInViewport();
	await app.screenshot({ path: '/tmp/os-webmcp-shortcuts-prepared.png' });
	const project = await ok(page, 'projects_read', { path: projectPath });
	expect(project.brief.latestRun.status).toBe('paused');
	await prepared.getByRole('button', { name: 'Open work order', exact: true }).click();
	await expect(page.locator('[data-app-id="textedit"]')).toBeVisible();
	expect((await ok(page, 'notes_get_context')).content).toContain(shortcutInput.procedure);
	await page.reload();
	await ready(page);
	expect((await ok(page, 'projects_read', { path: projectPath })).brief.latestRun.status).toBe(
		'paused',
	);
	expect((await ok(page, 'files_read', { path: workOrderPath })).content).toContain(
		'Review the retained offline articles for the release team.',
	);
	await ok(page, 'desktop_reveal', { path: shortcutPath });
	await expect(
		app.getByRole('heading', { name: 'Prepare a release review', exact: true }),
	).toBeVisible();
	expect(errors).toEqual([]);
});

test('human shortcut drafts block agent changes and survive external saved-file edits', async ({
	page,
}) => {
	await setup(page);
	const shortcut = await createShortcut(page);
	const app = page.locator('[data-app-id="shortcuts"]');
	await app.getByRole('button', { name: 'Edit shortcut', exact: true }).click();
	await app
		.getByRole('textbox', { name: 'Procedure', exact: true })
		.fill('Keep my unsaved review procedure.');
	const blocked = await call(page, 'shortcuts_update', {
		path: shortcutPath,
		expectedRevision: shortcut.revision,
		changes: { procedure: 'Replace the human draft.' },
	});
	expect(blocked.structuredContent.error.code).toBe('OPEN_DRAFT');
	await page.getByRole('button', { name: 'Close Shortcuts', exact: true }).click();
	await expect(app).toBeVisible();
	const disk = await ok(page, 'files_read', { path: shortcutPath });
	await ok(page, 'files_patch', {
		path: shortcutPath,
		expectedRevision: disk.revision,
		find: 'Read the supplied notes.',
		replace: 'Read the approved source notes.',
	});
	await expect(app.getByRole('textbox', { name: 'Procedure', exact: true })).toHaveValue(
		'Keep my unsaved review procedure.',
	);
	await expect(app.getByRole('button', { name: 'Save shortcut', exact: true })).toBeDisabled();
	await app.getByRole('button', { name: 'Discard', exact: true }).click();
	await app.getByRole('button', { name: 'Edit shortcut', exact: true }).click();
	await expect(app.getByRole('textbox', { name: 'Procedure', exact: true })).toHaveValue(
		shortcutInput.procedure.replace('Read the supplied notes.', 'Read the approved source notes.'),
	);
	await app
		.getByRole('textbox', { name: 'Procedure', exact: true })
		.fill('Keep my unsaved review procedure.');
	await app.getByRole('button', { name: 'Save shortcut', exact: true }).click();
	await expect(app.getByRole('button', { name: 'Edit shortcut', exact: true })).toBeVisible();
	expect((await ok(page, 'shortcuts_read', { path: shortcutPath })).data.procedure).toBe(
		'Keep my unsaved review procedure.',
	);
});

test('a broken saved shortcut leaves preparation inputs and cancel available', async ({ page }) => {
	await setup(page);
	const shortcut = await createShortcut(page);
	const app = page.locator('[data-app-id="shortcuts"]');
	await app.getByRole('button', { name: 'Prepare work', exact: true }).click();
	await app
		.getByRole('textbox', { name: 'Request and input notes', exact: true })
		.fill('Keep these input notes while I repair the shortcut.');
	await app.getByRole('textbox', { name: 'Project file', exact: true }).fill(projectPath);
	await app.getByRole('textbox', { name: 'Work order file', exact: true }).fill(workOrderPath);
	const broken = '{"format":"webmcp-shortcut", "procedure":';
	await ok(page, 'files_write', {
		path: shortcutPath,
		expectedRevision: shortcut.revision,
		content: broken,
	});
	await expect(
		app.getByRole('textbox', { name: 'Request and input notes', exact: true }),
	).toHaveValue('Keep these input notes while I repair the shortcut.');
	await expect(app.getByRole('textbox', { name: 'Work order file', exact: true })).toHaveValue(
		workOrderPath,
	);
	await expect(app.getByRole('button', { name: 'Prepare work order', exact: true })).toBeDisabled();
	await app.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(app.getByRole('button', { name: 'Prepare work order', exact: true })).toHaveCount(0);
	expect((await ok(page, 'files_read', { path: shortcutPath })).content).toBe(broken);
	await expectMissing(page, workOrderPath);
	await expectMissing(page, projectPath);
});
