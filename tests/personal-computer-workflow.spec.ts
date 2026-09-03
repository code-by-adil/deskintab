import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

const requiredTools = [
	'home_get_context',
	'home_save_preferences',
	'home_save_skill',
	'inbox_create',
	'inbox_update',
	'shortcuts_prepare',
	'studio_create',
	'packs_export',
	'packs_import',
];

async function setup(page: Page, url = '/') {
	await page.addInitScript(() => {
		const tools: Record<string, any> = {};
		Object.defineProperty(window, '__computerTools', { value: tools });
		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			value: { registerTool: (tool: any) => (tools[tool.name] = tool) },
		});
	});
	await page.goto(url);
	await ready(page);
}

async function ready(page: Page) {
	await page.waitForFunction(
		(names) => names.every((name) => Boolean((window as any).__computerTools[name])),
		requiredTools,
	);
}

async function ok(page: Page, name: string, input: Record<string, unknown> = {}) {
	const result = await page.evaluate(
		async ({ name, input }) => (window as any).__computerTools[name].execute(input),
		{ name, input },
	);
	expect(result.structuredContent.ok, JSON.stringify(result).slice(0, 2000)).toBe(true);
	return result.structuredContent;
}

async function savedFiles(page: Page, paths: string[]) {
	const saved: Record<string, { content: string; revision: string }> = {};
	for (const path of paths) {
		const result = await ok(page, 'files_read', { path });
		saved[path] = { content: result.content, revision: result.revision };
	}
	return saved;
}

const preferences = {
	displayName: 'Research desk',
	instructions: 'Cite the original interview notes. Put any cost estimates in BDT.',
	language: 'English',
	timeZone: 'Asia/Dhaka',
	outputFolder: '/Projects/Customer feedback',
	referencePaths: [],
	preferredSkillPaths: ['/Home/Skills/feedback-review/SKILL.md'],
};
const shortcutPath = '/Shortcuts/Analyze interviews.shortcut.json';
const projectPath = '/Projects/Customer feedback/Feedback.project.json';
const workOrderPath = '/Projects/Customer feedback/Work order.md';
const appPath = '/Applications/Feedback/Feedback explorer.app.json';
const reportPath = '/Projects/Customer feedback/Findings.md';
const initialRows = [
	{ title: 'Read during a flight', feature: 'Offline', quote: 'Saved articles need a connection.' },
	{
		title: 'Find a saved article',
		feature: 'Search',
		quote: 'I remember a phrase, not its folder.',
	},
	{
		title: 'Show download progress',
		feature: 'Offline',
		quote: 'Tell me when the download is ready.',
	},
];

test('a personal workflow keeps its inputs, handoff, app and preferences when moved to a new browser', async ({
	page,
	browser,
}, testInfo) => {
	test.setTimeout(90_000);
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await setup(page);
	const desktopUrl = page.url();
	let inboxPath = '';
	let notePath = '';
	let dataPath = '';
	let preparedRunId = '';
	let completedRunId = '';

	await test.step('saved preferences and real incoming files provide the work context', async () => {
		const empty = await ok(page, 'home_get_context');
		expect(empty.profile.exists).toBe(false);
		await ok(page, 'home_save_skill', {
			name: 'feedback-review',
			description: 'Compare interview findings with their original quotes.',
			instructions: 'Group repeated requests. Preserve exact quotes and cite the source notes.',
			expectedRevision: null,
		});
		await page.getByRole('button', { name: 'Launch Home app', exact: true }).click();
		const form = page.getByRole('form', { name: 'Home preferences', exact: true });
		await form.getByLabel('Workspace name', { exact: true }).fill(preferences.displayName);
		await form.getByLabel('Working instructions', { exact: true }).fill(preferences.instructions);
		await form.getByLabel('Language', { exact: true }).fill(preferences.language);
		await form.getByLabel('Time zone', { exact: true }).fill(preferences.timeZone);
		await form.getByLabel('Output folder', { exact: true }).fill(preferences.outputFolder);
		await form
			.getByLabel('Preferred skills', { exact: true })
			.fill(preferences.preferredSkillPaths.join('\n'));
		await form.getByRole('button', { name: 'Save preferences', exact: true }).click();
		await expect(
			page.getByText('Preferences saved for your next agent session.', { exact: true }),
		).toBeVisible();
		const home = await ok(page, 'home_get_context');
		expect(home.profile.data.preferences).toEqual(preferences);
		expect(home.briefText).toContain(preferences.instructions);
		expect(home.skills).toContainEqual(expect.objectContaining({ name: 'feedback-review' }));

		await page.getByRole('button', { name: 'Launch Inbox app', exact: true }).click();
		const inbox = page.locator('[data-app-id="inbox"]');
		await inbox.getByRole('button', { name: 'New request', exact: true }).click();
		await inbox
			.getByRole('textbox', { name: 'Request title', exact: true })
			.fill('Reader interviews');
		await inbox
			.getByRole('textbox', { name: 'What needs doing?', exact: true })
			.fill('Find recurring problems and leave an explorer with links to the evidence.');
		await inbox
			.getByRole('textbox', { name: 'Pasted notes', exact: true })
			.fill(
				'# Interview notes\n\nMaya needs offline reading. Jon needs search. Sam needs download progress.\n',
			);
		await inbox.getByLabel('Files', { exact: true }).setInputFiles({
			name: 'feedback.json',
			mimeType: 'application/json',
			buffer: Buffer.from(JSON.stringify(initialRows, null, 2) + '\n'),
		});
		await inbox.getByRole('button', { name: 'Add to Inbox', exact: true }).click();
		await expect(inbox.getByRole('dialog')).toHaveCount(0);
		await expect.poll(async () => (await ok(page, 'inbox_list')).requests.length).toBe(1);
		const requests = await ok(page, 'inbox_list');
		expect(requests.requests).toHaveLength(1);
		inboxPath = requests.requests[0].path;
		const request = await ok(page, 'inbox_read', { path: inboxPath });
		notePath = request.data.notePath;
		dataPath = request.data.attachments[0].path;
		expect(request.data).toMatchObject({ state: 'new', title: 'Reader interviews' });
		expect(JSON.parse((await ok(page, 'files_read', { path: dataPath })).content)).toEqual(
			initialRows,
		);
		expect(request.links.every((link: any) => link.exists)).toBe(true);
	});

	await test.step('a shortcut prepares a durable project without claiming an agent is running', async () => {
		const shortcut = await ok(page, 'shortcuts_create', {
			path: shortcutPath,
			title: 'Analyze interviews',
			description: 'Turn interview notes into evidence-backed findings.',
			procedure:
				'Read the source notes. Group repeated requests. Create a feedback explorer and a concise report.',
			requiredInputs: ['Interview notes and structured feedback'],
			sourcePaths: [preferences.preferredSkillPaths[0]],
			outputGuidance:
				'Save the explorer and report. Link both outputs from the project and incoming request.',
		});
		const prepared = await ok(page, 'shortcuts_prepare', {
			path: shortcutPath,
			expectedRevision: shortcut.revision,
			projectPath,
			newProject: {
				title: 'Customer feedback',
				objective: 'Understand the reader interview findings.',
			},
			inputPaths: [notePath, dataPath],
			inputText: 'Use the original quotes. Keep the selected sources accessible from the explorer.',
			workOrderPath,
		});
		preparedRunId = prepared.runId;
		expect(prepared.status).toBe('prepared');
		const order = await ok(page, 'files_read', { path: workOrderPath });
		for (const value of [
			preferences.instructions,
			notePath,
			dataPath,
			shortcutPath,
			'feedback-review',
		]) {
			expect(order.content).toContain(value);
		}
		const project = await ok(page, 'projects_read', { path: projectPath });
		expect(project.brief.latestRun).toMatchObject({ id: preparedRunId, status: 'paused' });
		expect(project.brief.latestRun.steps.every((step: any) => step.status === 'pending')).toBe(
			true,
		);
		expect(project.brief.latestRun.evidence).toContainEqual(
			expect.objectContaining({
				target: workOrderPath,
				exists: true,
			}),
		);
		await ok(page, 'desktop_reveal', { path: projectPath });
		await expect(page.locator('[data-app-id="projects"]')).toContainText('Analyze interviews');
		const request = await ok(page, 'inbox_read', { path: inboxPath });
		await ok(page, 'inbox_update', {
			path: inboxPath,
			expectedRevision: request.revision,
			changes: { state: 'filed', projectPath },
		});
	});

	await test.step('a fresh session builds an interactive app and links the finished work', async () => {
		await page.reload();
		await ready(page);
		const handoff = await ok(page, 'projects_read', { path: projectPath });
		expect(handoff.brief.latestRun.id).toBe(preparedRunId);
		const started = await ok(page, 'projects_start', {
			path: projectPath,
			expectedRevision: handoff.revision,
			basedOn: preparedRunId,
			agent: 'Feedback analyst',
			objective: 'Create the feedback explorer and save the findings.',
			steps: ['Read the selected evidence', 'Build the explorer', 'Save the findings'],
		});
		const importedData = await ok(page, 'files_read', { path: dataPath });
		await ok(page, 'files_write', {
			path: dataPath,
			expectedRevision: importedData.revision,
			content:
				JSON.stringify(
					initialRows.map((row) => ({ ...row, source: notePath })),
					null,
					2,
				) + '\n',
		});
		await ok(page, 'studio_create', {
			path: appPath,
			title: 'Feedback explorer',
			description: 'Find repeated requests in the reader interviews.',
			view: 'cards',
			dataPath,
			columns: [
				{ key: 'title', label: 'Finding' },
				{ key: 'feature', label: 'Feature' },
				{ key: 'quote', label: 'Quote' },
			],
			titleField: 'title',
			filterField: 'feature',
			sourceField: 'source',
			sourcePaths: [notePath],
		});
		await ok(page, 'files_write', {
			path: reportPath,
			content: `# Reader findings\n\nTwo interviews request better offline support; one requests search.\n\nSource notes: ${notePath}\n\nExplorer: ${appPath}\n`,
			createOnly: true,
		});
		const completed = await ok(page, 'projects_checkpoint', {
			path: projectPath,
			expectedRevision: started.revision,
			runId: started.run.id,
			status: 'completed',
			summary: 'Created a feedback explorer and a report linked to the original interview notes.',
			nextAction: '',
			steps: started.run.steps.map((step: any) => ({ ...step, status: 'done' })),
			evidence: [
				{
					label: 'Feedback explorer',
					target: appPath,
					detail: 'Interactive view over the imported feedback.',
				},
				{
					label: 'Findings',
					target: reportPath,
					detail: 'Summary with source and explorer paths.',
				},
			],
		});
		completedRunId = completed.run.id;
		const request = await ok(page, 'inbox_read', { path: inboxPath });
		await ok(page, 'inbox_update', {
			path: inboxPath,
			expectedRevision: request.revision,
			changes: { state: 'done', outputPaths: [appPath, reportPath] },
		});
		await verifyExplorer(page, notePath);
	});

	const paths = [
		'/Home/profile.json',
		preferences.preferredSkillPaths[0],
		shortcutPath,
		inboxPath,
		notePath,
		dataPath,
		projectPath,
		workOrderPath,
		appPath,
		reportPath,
	];
	const before = await savedFiles(page, paths);
	const packFile = testInfo.outputPath('Research desk.desktop-pack.json');

	await test.step('the human downloads a portable workspace containing the actual saved files', async () => {
		await page.getByRole('button', { name: 'Launch Home app', exact: true }).click();
		const home = page.locator('[data-app-id="home"]');
		await home.getByRole('button', { name: 'Workspace', exact: true }).click();
		const downloadPromise = page.waitForEvent('download');
		await home.getByRole('button', { name: 'Export workspace', exact: true }).click();
		const download = await downloadPromise;
		await download.saveAs(packFile);
		const pack = JSON.parse(await readFile(packFile, 'utf8'));
		expect(pack.format).toBe('webmcp-desktop-pack');
		for (const path of paths) {
			const entry = pack.entries.find((entry: any) => entry.path === path);
			expect(entry?.kind, path).toBe('file');
			expect(Buffer.from(entry.data, 'base64').toString('utf8'), path).toBe(before[path].content);
		}
		expect(pack.entries.some((entry: any) => entry.path.startsWith('/System/'))).toBe(false);
	});

	await page.close();
	const restoredContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	try {
		const restored = await restoredContext.newPage();
		restored.on('pageerror', (error) => errors.push(error.message));
		await setup(restored, desktopUrl);
		await test.step('a clean browser imports the pack without collisions or hidden setup', async () => {
			expect((await ok(restored, 'home_get_context')).profile.exists).toBe(false);
			expect((await ok(restored, 'inbox_list')).requests).toEqual([]);
			await restored.getByRole('button', { name: 'Launch Home app', exact: true }).click();
			const home = restored.locator('[data-app-id="home"]');
			await home.getByRole('button', { name: 'Workspace', exact: true }).click();
			await home.getByLabel('Choose workspace pack', { exact: true }).setInputFiles(packFile);
			const importButton = home.getByRole('button', { name: 'Import workspace pack', exact: true });
			await expect(importButton).toBeEnabled();
			await importButton.click();
			await expect(home.getByRole('status').filter({ hasText: /^Imported / })).toBeVisible();
			await home.getByRole('button', { name: 'Preferences', exact: true }).click();
			await expect(home.getByLabel('Workspace name', { exact: true })).toHaveValue(
				preferences.displayName,
			);
			await expect(home.getByLabel('Working instructions', { exact: true })).toHaveValue(
				preferences.instructions,
			);
			expect(await savedFiles(restored, paths)).toEqual(before);
		});
		await test.step('reload preserves the working setup, completed handoff and interactive app', async () => {
			await restored.reload();
			await ready(restored);
			expect((await ok(restored, 'home_get_context')).profile.data.preferences).toEqual(
				preferences,
			);
			expect((await ok(restored, 'shortcuts_read', { path: shortcutPath })).sourceFiles).toEqual([
				{ path: preferences.preferredSkillPaths[0], exists: true },
			]);
			const project = await ok(restored, 'projects_read', { path: projectPath });
			expect(project.brief.latestRun).toMatchObject({
				id: completedRunId,
				basedOn: preparedRunId,
				status: 'completed',
			});
			expect(project.brief.latestRun.evidence.every((item: any) => item.exists)).toBe(true);
			const request = await ok(restored, 'inbox_read', { path: inboxPath });
			expect(request.data).toMatchObject({
				state: 'done',
				projectPath,
				outputPaths: [appPath, reportPath],
			});
			expect(request.links.every((link: any) => link.exists)).toBe(true);
			expect(await savedFiles(restored, paths)).toEqual(before);
			await verifyExplorer(restored, notePath);
		});
	} finally {
		await restoredContext.close();
	}
	expect(errors).toEqual([]);
});

async function verifyExplorer(page: Page, notePath: string) {
	await ok(page, 'desktop_reveal', { path: appPath });
	const studio = page.locator('[data-app-id="studio"]');
	await expect(studio).toBeVisible();
	const explorer = studio.frameLocator('iframe[title="App preview"]');
	await expect(explorer.getByText('Read during a flight', { exact: true })).toBeVisible();
	await expect(explorer.getByText('Find a saved article', { exact: true })).toBeVisible();
	await explorer.getByRole('combobox', { name: 'Feature', exact: true }).selectOption('Offline');
	await expect(explorer.getByText('Read during a flight', { exact: true })).toBeVisible();
	await expect(explorer.getByText('Show download progress', { exact: true })).toBeVisible();
	await expect(explorer.getByText('Find a saved article', { exact: true })).toHaveCount(0);
	await explorer.getByRole('button', { name: 'Open source', exact: true }).first().click();
	await expect(page.locator('[data-app-id="textedit"]')).toBeVisible();
	expect((await ok(page, 'notes_get_context')).path).toBe(notePath);
}

for (const viewport of [
	{ width: 375, height: 812 },
	{ width: 768, height: 900 },
]) {
	test(`new app controls remain usable at ${viewport.width}x${viewport.height}`, async ({
		page,
	}, testInfo) => {
		test.setTimeout(90_000);
		await page.setViewportSize(viewport);
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await setup(page);

		async function fits(app: Locator) {
			await expect(app).toBeInViewport({ ratio: 1 });
			const bounds = await app.boundingBox();
			expect(bounds).not.toBeNull();
			expect(bounds!.x).toBeGreaterThanOrEqual(-1);
			expect(bounds!.y).toBeGreaterThanOrEqual(-1);
			expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
			expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
			const overflow = await page.evaluate(() => ({
				body: document.body.scrollWidth > innerWidth,
				document: document.documentElement.scrollWidth > innerWidth,
			}));
			expect(overflow).toEqual({ body: false, document: false });
		}

		async function reachable(control: Locator) {
			await control.scrollIntoViewIfNeeded();
			await expect(control).toBeInViewport({ ratio: 1 });
			await expect(control).toBeEnabled();
		}

		async function launch(id: string, name: string) {
			const button = page.getByRole('button', { name: `Launch ${name} app`, exact: true });
			await reachable(button);
			await button.click();
			const app = page.locator(`[data-app-id="${id}"]`);
			await fits(app);
			return app;
		}

		await test.step('Home preferences and workspace controls remain reachable', async () => {
			const home = await launch('home', 'Home');
			await home.getByLabel('Workspace name', { exact: true }).fill('Compact workspace');
			const save = home.getByRole('button', { name: 'Save preferences', exact: true });
			await reachable(save);
			await save.click();
			await expect(
				home.getByText('Preferences saved for your next agent session.', { exact: true }),
			).toBeVisible();
			await home.getByRole('button', { name: 'Workspace', exact: true }).click();
			await reachable(home.getByRole('button', { name: 'Export workspace', exact: true }));
			await reachable(home.getByLabel('Choose workspace pack', { exact: true }));
			await fits(home);
		});

		await test.step('Inbox request fields and its submit action fit the window', async () => {
			const inbox = await launch('inbox', 'Inbox');
			await inbox.getByRole('button', { name: 'New request', exact: true }).click();
			const form = inbox.getByRole('dialog');
			await form.getByLabel('Request title', { exact: true }).fill('Compact request');
			await form.getByLabel('What needs doing?', { exact: true }).fill('Review the source notes.');
			await reachable(form.getByLabel('Files', { exact: true }));
			const save = form.getByRole('button', { name: 'Add to Inbox', exact: true });
			await reachable(save);
			await save.click();
			await expect(form).toHaveCount(0);
			await expect(inbox.getByRole('status')).toHaveText('Added to Inbox');
			await reachable(inbox.getByRole('button', { name: 'Edit request', exact: true }));
			await fits(inbox);
			await inbox.screenshot({ path: testInfo.outputPath('compact-inbox.png') });
		});

		await test.step('the long Shortcuts form scrolls to a working save action', async () => {
			const shortcuts = await launch('shortcuts', 'Shortcuts');
			await shortcuts.getByRole('button', { name: 'New shortcut', exact: true }).first().click();
			await shortcuts.getByLabel('Shortcut name', { exact: true }).fill('Compact review');
			await shortcuts
				.getByLabel('Procedure', { exact: true })
				.fill('Read the notes and write a summary.');
			await shortcuts
				.getByLabel('Expected output', { exact: true })
				.fill('A saved summary with source links.');
			const save = shortcuts.getByRole('button', { name: 'Save shortcut', exact: true });
			await reachable(save);
			await save.click();
			await expect(
				shortcuts.getByRole('heading', { name: 'Compact review', exact: true }),
			).toBeVisible();
			await fits(shortcuts);
		});

		await test.step('App Studio creates, filters and edits a real explorer', async () => {
			const studio = await launch('studio', 'App Studio');
			const create = studio.getByRole('button', { name: 'Create Feedback Explorer', exact: true });
			await reachable(create);
			await create.click();
			const explorer = studio.frameLocator('iframe[title="App preview"]');
			const filter = explorer.getByRole('combobox', { name: 'Feature', exact: true });
			await reachable(filter);
			await filter.selectOption('Offline reading');
			await expect(explorer.getByRole('status')).toHaveText('2 of 4 records');
			const search = explorer.getByRole('searchbox', { name: 'Search records', exact: true });
			await reachable(search);
			await search.fill('flight');
			await expect(explorer.getByRole('status')).toHaveText('1 of 4 records');
			await expect(
				explorer.getByRole('heading', { name: 'Keep articles for a flight', exact: true }),
			).toBeVisible();
			const settings = studio.getByRole('button', { name: 'App settings', exact: true });
			await reachable(settings);
			await settings.click();
			const form = studio.getByRole('dialog', { name: 'App settings', exact: true });
			await form.getByLabel('App title', { exact: true }).fill('Compact feedback explorer');
			const save = form.getByRole('button', { name: 'Save app', exact: true });
			await reachable(save);
			await save.click();
			await expect(form).toHaveCount(0);
			await expect(
				explorer.getByRole('heading', { name: 'Compact feedback explorer', exact: true }),
			).toBeVisible();
			await fits(studio);
			await studio.screenshot({ path: testInfo.outputPath('compact-studio.png') });
		});
		expect(errors).toEqual([]);
	});
}
