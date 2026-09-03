import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
	await page.addInitScript(() => {
		const tools: Record<string, any> = {};
		Object.defineProperty(window, '__contextTools', { value: tools });
		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			value: { registerTool: (tool: any) => (tools[tool.name] = tool) },
		});
	});
	await page.goto('/');
	await page.waitForFunction(() => Boolean((window as any).__contextTools.desktop_get_context));
}
async function ok(page: Page, name: string, input: Record<string, unknown> = {}) {
	const result = await page.evaluate(
		async ({ name, input }) =>
			(window as any).__contextTools[name].execute(input, { signal: new AbortController().signal }),
		{ name, input },
	);
	expect(result.structuredContent.ok, JSON.stringify(result)).toBe(true);
	return result.structuredContent;
}

test('desktop context reads Finder selection without opening or saving anything', async ({
	page,
}) => {
	await setup(page);
	const path = '/Documents/Selected.md';
	await ok(page, 'files_write', { path, content: 'A selected source', createOnly: true });
	await ok(page, 'desktop_reveal', { target: 'finder', path });
	const files = await ok(page, 'files_list', { path: '/System' });
	const activity = await ok(page, 'activity_list', { limit: 100 });
	const context = await ok(page, 'desktop_get_context');
	expect(context.activeApp).toBe('finder');
	expect(context.context.finder).toMatchObject({ path: '/Documents', selectedPath: path });
	expect(context.context.tasks).toBeNull();
	expect(context.context.canvas).toBeNull();
	expect(await ok(page, 'files_list', { path: '/System' })).toEqual(files);
	expect(await ok(page, 'activity_list', { limit: 100 })).toEqual(activity);
	await page.evaluate(async () => {
		const { minimizeApp } = await import('/src/state/apps.svelte.ts');
		minimizeApp('finder');
	});
	const minimized = await ok(page, 'desktop_get_context');
	expect(minimized.context.finder).toBeNull();
	expect(minimized.openApps.find((app: any) => app.id === 'finder')).toMatchObject({
		minimized: true,
		focused: false,
	});
	expect(minimized.activeApp).toBeNull();
});

test('task selection and draft context follow human edits and clear while hidden', async ({
	page,
}) => {
	await setup(page);
	const path = '/Documents/Context.tasks.json';
	const first = await ok(page, 'tasks_create', { path, title: 'Prepare the brief' });
	const second = await ok(page, 'tasks_create', {
		path,
		title: 'Review the sketch',
		expectedRevision: first.revision,
	});
	const tasks = page.locator('[data-app-id="tasks"]');
	await tasks.locator(`[data-task-id="${second.task.id}"]`).click();
	const context = await ok(page, 'desktop_get_context');
	expect(context.activeApp).toBe('tasks');
	expect(context.context.tasks).toMatchObject({
		path,
		revision: second.revision,
		selectedTaskId: second.task.id,
		selectedTaskTitle: 'Review the sketch',
		draft: { dirty: false, stale: false, isNew: false },
	});
	await tasks.getByRole('textbox', { name: 'Title', exact: true }).fill('A human draft');
	expect((await ok(page, 'desktop_get_context')).context.tasks.draft).toMatchObject({
		dirty: true,
		stale: false,
		baseRevision: second.revision,
	});
	expect((await ok(page, 'tasks_list', { path })).tasks[1].title).toBe('Review the sketch');
	await page.evaluate(async () => {
		const { minimizeApp } = await import('/src/state/apps.svelte.ts');
		minimizeApp('tasks');
	});
	expect((await ok(page, 'desktop_get_context')).context.tasks).toBeNull();
	await ok(page, 'desktop_reveal', { target: 'tasks' });
	expect((await ok(page, 'desktop_get_context')).context.tasks.draft.dirty).toBe(true);
});

test('Review exposes the selected version and session and shows readable task changes', async ({
	page,
}) => {
	await setup(page);
	const path = '/Documents/Review context.tasks.json';
	const created = await ok(page, 'tasks_create', { path, title: 'Prepare the brief' });
	const updated = await ok(page, 'tasks_update', {
		path,
		id: created.task.id,
		expectedRevision: created.revision,
		changes: { status: 'done' },
	});
	const versionId = updated.entry.versionId;
	await ok(page, 'desktop_reveal', { target: 'activity' });
	const activity = page.locator('[data-app-id="activity"]');
	await activity.getByRole('button', { name: 'Review', exact: true }).click();
	await activity
		.getByRole('button', { name: /Review context\.tasks\.json/ })
		.first()
		.click();
	await expect(activity.getByRole('region', { name: 'Changes in this save' })).toContainText(
		'Prepare the brief',
	);
	await expect(activity.getByRole('region', { name: 'Changes in this save' })).toContainText(
		/done/i,
	);
	await expect(activity.locator('.raw-change')).not.toHaveAttribute('open');
	await activity.getByText('Raw file changes', { exact: true }).click();
	await expect(activity.getByRole('table')).toBeVisible();
	const context = await ok(page, 'desktop_get_context');
	expect(context.context.review).toMatchObject({
		tab: 'review',
		selectedVersionId: versionId,
		selectedSessionId: null,
		path,
	});
	await activity.getByRole('button', { name: 'New Summary…', exact: true }).click();
	expect((await ok(page, 'desktop_get_context')).context.review.summaryDraft).toEqual({
		sessionId: null,
		isNew: true,
	});
	const form = activity.getByRole('dialog', { name: 'New work summary' });
	await form.getByRole('textbox', { name: 'Title', exact: true }).fill('Brief ready');
	await form.getByRole('button', { name: 'Save Summary', exact: true }).click();
	await expect(activity.getByRole('heading', { name: 'Brief ready', exact: true })).toBeVisible();
	const selectedSession = (await ok(page, 'desktop_get_context')).context.review;
	expect(selectedSession.selectedSessionId).toBeTruthy();
	expect(selectedSession.selectedVersionId).toBeNull();
	expect(selectedSession.summaryDraft).toBeNull();
	await activity.getByRole('button', { name: 'Activity', exact: true }).click();
	expect((await ok(page, 'desktop_get_context')).context.review).toMatchObject({
		tab: 'activity',
		selectedVersionId: null,
		selectedSessionId: null,
	});
});
