import { expect, test, type Page } from '@playwright/test';
async function setup(page: Page) {
	await page.addInitScript(() => {
		const tools: Record<string, any> = {};
		Object.defineProperty(window, '__navigationTools', { value: tools });
		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			value: { registerTool: (tool: any) => (tools[tool.name] = tool) },
		});
	});
	await page.goto('/');
	await page.waitForFunction(() => Boolean((window as any).__navigationTools.terminal_run));
}
async function call(page: Page, name: string, input: Record<string, unknown> = {}) {
	return page.evaluate(
		async ({ name, input }) => {
			const result = await (window as any).__navigationTools[name].execute(input);
			// Native WebMCP clones results; Playwright's usual serialization hides Proxy failures.
			return structuredClone(result);
		},
		{ name, input },
	);
}
async function ok(page: Page, name: string, input: Record<string, unknown> = {}) {
	const result = await call(page, name, input);
	expect(result.structuredContent.ok, JSON.stringify(result).slice(0, 3000)).toBe(true);
	return result.structuredContent;
}
test('calculator and appearance share visible controls, windows preserve their state', async ({
	page,
}) => {
	await setup(page);
	const calculated = await ok(page, 'calculator_calculate', {
		operation: 'add',
		value: 2,
		operand: 3,
	});
	expect(calculated.repeat).toEqual({ operation: 'add', operand: 3, percentRate: null });
	await expect(page.getByTestId('calculator-display')).toHaveText('5');
	await page
		.locator('[data-app-id="calculator"]')
		.getByRole('button', { name: 'Multiply', exact: true })
		.click();
	await page
		.locator('[data-app-id="calculator"]')
		.getByRole('button', { name: '4', exact: true })
		.click();
	expect((await ok(page, 'calculator_calculate', { operation: 'equals' })).value).toBe(20);
	expect((await ok(page, 'desktop_get_context')).context.calculator.repeat).toEqual({
		operation: 'multiply',
		operand: 4,
		percentRate: null,
	});
	await ok(page, 'desktop_window', { target: 'calculator', action: 'minimize' });
	expect((await ok(page, 'desktop_get_context')).context.calculator).toBeNull();
	await ok(page, 'desktop_window', { target: 'calculator', action: 'restore' });
	expect((await ok(page, 'calculator_read')).display).toBe('20');
	await page
		.locator('[data-app-id="calculator"]')
		.getByRole('button', { name: 'Add', exact: true })
		.click();
	await page
		.locator('[data-app-id="calculator"]')
		.getByRole('button', { name: '3', exact: true })
		.click();
	expect(
		(await ok(page, 'calculator_calculate', { operation: 'multiply', operand: 4 })).value,
	).toBe(12);
	await ok(page, 'calculator_calculate', { operation: 'set', value: 20 });
	await ok(page, 'desktop_window', { target: 'calculator', action: 'move', x: 100000, y: 100000 });
	const window = page.locator('[data-app-id="calculator"]');
	const box = await window.boundingBox();
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
	await ok(page, 'desktop_window', { target: 'calculator', action: 'maximize' });
	await expect(window).toHaveClass(/maximized/);
	await ok(page, 'desktop_window', { target: 'calculator', action: 'restore' });
	await expect(window).not.toHaveClass(/maximized/);
	await ok(page, 'desktop_window', { target: 'calculator', action: 'close' });
	await expect(window).toHaveCount(0);
	await ok(page, 'desktop_reveal', { target: 'calculator' });
	await expect(page.getByTestId('calculator-display')).toHaveText('20');
	const wallpapers = await ok(page, 'wallpapers_read');
	const next = wallpapers.wallpapers.find((item: any) => item.id !== wallpapers.current.id);
	const changed = await ok(page, 'wallpapers_set', {
		id: next.id,
		theme: 'dark',
		reducedMotion: true,
	});
	expect(changed.current).toMatchObject({ id: next.id, theme: 'dark', matchTheme: false });
	await expect(
		page.getByRole('button', { name: `Use ${next.name} wallpaper`, exact: true }),
	).toHaveAttribute('aria-pressed', 'true');
	await page.reload();
	await page.waitForFunction(() => Boolean((window as any).__navigationTools.wallpapers_read));
	expect((await ok(page, 'wallpapers_read')).current.id).toBe(next.id);
});
test('Finder navigation resolves visible search and downloads exact saved bytes from tool and UI', async ({
	page,
}) => {
	await setup(page);
	const path = '/Documents/Navigation download.md';
	const content = 'A complete download\nwith source bytes.';
	await ok(page, 'files_write', { path, content, createOnly: true });
	const revealed = await ok(page, 'desktop_reveal', { target: 'finder', path });
	expect(revealed.appReady).toBe(true);
	expect(revealed.view.path).toBe('/Documents');
	expect(revealed.view.loading).toBe(false);
	const found = await ok(page, 'finder_navigate', {
		query: 'Navigation download',
		selectedPath: path,
	});
	expect(found.view.visiblePaths).toEqual([path]);
	await expect(page.getByRole('textbox', { name: 'Search this folder' })).toHaveValue(
		'Navigation download',
	);
	const toolDownload = page.waitForEvent('download');
	await ok(page, 'files_download', { path });
	const first = await toolDownload;
	expect(first.suggestedFilename()).toBe('Navigation download.md');
	const stream = await first.createReadStream();
	let text = '';
	for await (const chunk of stream!) text += chunk.toString();
	expect(text).toBe(content);
	await page
		.locator('[data-app-id="finder"]')
		.getByText('Navigation download.md', { exact: true })
		.click({ button: 'right' });
	const uiDownload = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download', exact: true }).click();
	expect((await uiDownload).suggestedFilename()).toBe('Navigation download.md');
	const other = '/Documents/Another selected file.md';
	await ok(page, 'files_write', { path: other, content: 'Another file', createOnly: true });
	const shown = await ok(page, 'desktop_reveal', { target: 'finder', path: other });
	expect(shown.view.query).toBe('');
	expect(shown.view.selectedPath).toBe(other);
	const cleared = await ok(page, 'finder_navigate', { query: '' });
	expect(cleared.view.query).toBe('');
});
test('task navigation selects the intended task and respects unsaved drafts and close guards', async ({
	page,
}) => {
	await setup(page);
	const path = '/Documents/Navigation.tasks.json';
	const a = await ok(page, 'tasks_create', { path, title: 'First task' });
	const b = await ok(page, 'tasks_create', {
		path,
		title: 'Second task',
		expectedRevision: a.revision,
	});
	await ok(page, 'tasks_navigate', { path, taskId: b.task.id, filter: 'todo' });
	await expect(
		page.locator('[data-app-id="tasks"]').getByRole('textbox', { name: 'Title', exact: true }),
	).toHaveValue('Second task');
	const context = await ok(page, 'desktop_get_context');
	expect(context.context.tasks.selectedTaskId).toBe(b.task.id);
	await page
		.locator('[data-app-id="tasks"]')
		.getByRole('textbox', { name: 'Title', exact: true })
		.fill('Human unsaved task');
	expect((await call(page, 'tasks_navigate', { taskId: a.task.id })).structuredContent.ok).toBe(
		false,
	);
	expect(
		(await call(page, 'desktop_window', { target: 'tasks', action: 'close' })).structuredContent.ok,
	).toBe(false);
	await expect(page.locator('[data-app-id="tasks"]')).toBeVisible();
	await expect(
		page.locator('[data-app-id="tasks"]').getByRole('textbox', { name: 'Title', exact: true }),
	).toHaveValue('Human unsaved task');
});
test('Home and Projects navigation reaches selected skills and historical runs', async ({
	page,
}) => {
	await setup(page);
	const skill = await ok(page, 'home_save_skill', {
		name: 'navigation-test',
		description: 'A navigation skill.',
		instructions: 'Read the source.',
		expectedRevision: null,
	});
	const home = await ok(page, 'home_navigate', { pane: 'toolbox', skillPath: skill.path });
	expect(home.view.skillPath).toBe(skill.path);
	expect(home.view.pane).toBe('toolbox');
	await expect(
		page
			.locator('[data-app-id="home"]')
			.getByRole('textbox', { name: 'Instructions', exact: true }),
	).toHaveValue('Read the source.');
	expect((await ok(page, 'home_navigate', { pane: 'packs' })).view.pane).toBe('packs');
	const path = '/Projects/Launch/Navigation.project.json';
	const project = await ok(page, 'projects_create', {
		path,
		title: 'Navigation project',
		objective: 'Verify a saved handoff.',
	});
	const run = await ok(page, 'projects_start', {
		path,
		expectedRevision: project.revision,
		agent: 'Agent A',
		objective: 'Inspect navigation.',
		steps: ['Inspect'],
	});
	const stopped = await ok(page, 'projects_checkpoint', {
		path,
		runId: run.run.id,
		expectedRevision: run.revision,
		status: 'completed',
		summary: 'Inspected.',
		nextAction: 'Continue.',
		steps: run.run.steps.map((step: any) => ({ ...step, status: 'done' })),
	});
	await ok(page, 'projects_start', {
		path,
		expectedRevision: stopped.revision,
		agent: 'Agent B',
		basedOn: run.run.id,
		objective: 'Continue.',
		steps: ['Continue'],
	});
	const old = await ok(page, 'projects_navigate', { path, view: 'work', runId: run.run.id });
	expect(old.view.runId).toBe(run.run.id);
	expect(old.view.view).toBe('work');
	expect((await ok(page, 'projects_navigate', { view: 'overview' })).view.view).toBe('overview');
});
test('Review navigation selects versions and summaries and preserves summary forms', async ({
	page,
}) => {
	await setup(page);
	const path = '/Documents/Review-navigation.tasks.json';
	const a = await ok(page, 'tasks_create', { path, title: 'Review first' });
	const b = await ok(page, 'tasks_update', {
		path,
		id: a.task.id,
		expectedRevision: a.revision,
		changes: { status: 'done' },
	});
	await ok(page, 'activity_navigate', { versionId: b.entry.versionId });
	expect((await ok(page, 'desktop_get_context')).context.review.selectedVersionId).toBe(
		b.entry.versionId,
	);
	const c = await ok(page, 'tasks_update', {
		path,
		id: a.task.id,
		expectedRevision: b.revision,
		changes: { title: 'Review revised' },
	});
	await ok(page, 'activity_navigate', { versionId: c.entry.versionId });
	expect((await ok(page, 'desktop_get_context')).context.review.selectedVersionId).toBe(
		c.entry.versionId,
	);
	await expect(
		page.locator('[data-app-id="activity"]').getByRole('region', { name: 'Changes in this save' }),
	).toContainText('Review revised');
	await ok(page, 'activity_navigate', { tab: 'activity', filter: 'agent' });
	expect((await ok(page, 'desktop_get_context')).context.review).toMatchObject({
		tab: 'activity',
		filter: 'agent',
	});
	const summary = await ok(page, 'review_session', {
		title: 'Navigation summary',
		status: 'completed',
		summary: 'Reviewed the task changes.',
	});
	await ok(page, 'activity_navigate', { sessionId: summary.session.id });
	expect((await ok(page, 'desktop_get_context')).context.review.selectedSessionId).toBe(
		summary.session.id,
	);
	await page
		.locator('[data-app-id="activity"]')
		.getByRole('button', { name: 'New Summary…', exact: true })
		.click();
	expect((await call(page, 'activity_navigate', { tab: 'activity' })).structuredContent.ok).toBe(
		false,
	);
	expect(
		(await call(page, 'desktop_window', { target: 'activity', action: 'close' })).structuredContent
			.ok,
	).toBe(false);
});
test('Notepad navigation selects exact source text and changes the visible mode', async ({
	page,
}) => {
	await setup(page);
	const path = '/Documents/Navigation note.md';
	await ok(page, 'files_write', {
		path,
		content: '# Heading\n\nThe selected text.',
		createOnly: true,
	});
	const selected = await ok(page, 'notepad_navigate', {
		path,
		selection: { start: 11, end: 14 },
		sidebar: false,
	});
	expect(selected.view.mode).toBe('markdown');
	expect(selected.view.selection.text).toBe('The');
	expect((await ok(page, 'desktop_get_context')).context.notepad.selection.sourceStart).toBe(11);
	await ok(page, 'notepad_navigate', { mode: 'formatted' });
	await expect(page.locator('[data-app-id="textedit"] .milkdown')).toBeVisible();
	expect(
		(await call(page, 'notepad_navigate', { selection: { start: 4, end: 9999 } })).structuredContent
			.ok,
	).toBe(false);
});
test('Canvas selection, layers and styles survive a saved edit and reload', async ({ page }) => {
	test.setTimeout(60000);
	await setup(page);
	const path = '/Documents/Navigation.excalidraw';
	const created = await ok(page, 'canvas_edit', {
		path,
		create: { title: 'Navigation' },
		operations: [
			{ op: 'add', object: { id: 'first', type: 'rectangle', text: 'First', x: 20, y: 20 } },
			{ op: 'add', object: { id: 'second', type: 'rectangle', x: 200, y: 20 } },
		],
	});
	await ok(page, 'canvas_select', { path, ids: ['second'], fit: true });
	expect(
		(await ok(page, 'canvas_read', { path, scope: 'selection' })).data.elements.map(
			(item: any) => item.id,
		),
	).toEqual(['second']);
	const read = await ok(page, 'canvas_read', { path });
	const result = await ok(page, 'canvas_edit', {
		path,
		expectedRevision: read.revision,
		operations: [
			{
				op: 'update',
				id: 'first',
				changes: { fillStyle: 'hachure', strokeStyle: 'dashed', textAlign: 'right' },
			},
			{ op: 'reorder', ids: ['second', 'first'] },
		],
	});
	expect(result.data.elements.map((item: any) => item.id).slice(0, 2)).toEqual(['second', 'first']);
	expect(result.data.elements.find((item: any) => item.id === 'first')).toMatchObject({
		fillStyle: 'hachure',
		strokeStyle: 'dashed',
	});
	expect(result.data.elements.find((item: any) => item.type === 'text').textAlign).toBe('right');
	await page.reload();
	await page.waitForFunction(() => Boolean((window as any).__navigationTools.canvas_read));
	const persisted = await ok(page, 'canvas_read', { path });
	expect(persisted.data.elements.map((item: any) => item.id)).toEqual(
		result.data.elements.map((item: any) => item.id),
	);
});

test('Inbox filter and Preview text/zoom controls report the visible app state', async ({
	page,
}) => {
	await setup(page);
	const request = await ok(page, 'inbox_create', {
		title: 'A visible request',
		request: 'Inspect the brief.',
	});
	const inbox = await ok(page, 'inbox_navigate', { path: request.path, filter: 'all' });
	expect(inbox.view.visiblePaths).toContain(request.path);
	await page
		.locator('[data-app-id="inbox"]')
		.getByRole('button', { name: /^Done \d+$/ })
		.first()
		.click();
	expect((await ok(page, 'desktop_get_context')).context.inbox.filter).toBe('done');
	await ok(page, 'inbox_navigate', { filter: 'new' });
	expect((await ok(page, 'desktop_get_context')).context.inbox.filter).toBe('new');
	const pdf =
		'%PDF-1.1\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n2 0 obj<< /Type /Pages /Count 1 /Kids [3 0 R] >>endobj\n3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n4 0 obj<< /Length 46 >>stream\nBT /F1 12 Tf 10 100 Td (Preview controls) Tj ET\nendstream\nendobj\n5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF';
	await page.evaluate(async (pdf) => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		await workspaceService.writeBytes(
			'/Documents/Navigation preview.pdf',
			new TextEncoder().encode(pdf),
		);
	}, pdf);
	const preview = await ok(page, 'preview_navigate', {
		path: '/Documents/Navigation preview.pdf',
		zoom: 1.5,
		textView: true,
	});
	expect(preview.view).toMatchObject({ zoom: 1.5, textView: true });
	await expect(
		page.locator('[data-app-id="preview"]').getByRole('button', { name: 'Text', exact: true }),
	).toHaveAttribute('aria-pressed', 'true');
	await expect(
		page.locator('[data-app-id="preview"]').getByText('Preview controls', { exact: true }),
	).toBeVisible();
	const graphical = await ok(page, 'preview_navigate', { textView: false, zoom: 1 });
	expect(graphical.view).toMatchObject({ zoom: 1, textView: false });
});
