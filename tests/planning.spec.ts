import { expect, test, type Page } from '@playwright/test';
async function setup(page: Page) {
	await page.addInitScript(() => {
		const tools: Record<string, any> = {};
		Object.defineProperty(window, '__planning', { value: tools });
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
	await page.waitForFunction(() => Boolean((window as any).__planning.canvas_export));
}
async function call(page: Page, name: string, input: Record<string, unknown> = {}) {
	return page.evaluate(
		async ({ name, input }) =>
			(window as any).__planning[name].execute(input, { signal: new AbortController().signal }),
		{ name, input },
	);
}
async function ok(page: Page, name: string, input: Record<string, unknown> = {}) {
	const result = await call(page, name, input);
	expect(result.structuredContent.ok, JSON.stringify(result)).toBe(true);
	return result.structuredContent;
}
const taskPath = '/Documents/Launch.tasks.json';
const scenePath = '/Documents/Launch.canvas.json';

test('bound-label edits preserve formatting, apply size changes, and can clear text', async ({
	page,
}) => {
	await setup(page);
	const created = await scene(page);
	const label = created.data.elements.find((e: any) => e.containerId === 'notes');
	const styled = await ok(page, 'canvas_edit', {
		path: scenePath,
		expectedRevision: created.revision,
		operations: [{ op: 'update', id: label.id, changes: { color: '#e03131', fontSize: 18 } }],
	});
	const renamed = await ok(page, 'canvas_edit', {
		path: scenePath,
		expectedRevision: styled.revision,
		operations: [{ op: 'update', id: 'notes', changes: { text: 'Human styling kept' } }],
	});
	expect(renamed.data.elements.find((e: any) => e.id === label.id)).toMatchObject({
		text: 'Human styling kept',
		strokeColor: '#e03131',
		fontSize: 18,
	});
	const resized = await ok(page, 'canvas_edit', {
		path: scenePath,
		expectedRevision: renamed.revision,
		operations: [{ op: 'update', id: 'notes', changes: { fontSize: 32 } }],
	});
	expect(resized.data.elements.find((e: any) => e.id === label.id).fontSize).toBe(32);
	const cleared = await ok(page, 'canvas_edit', {
		path: scenePath,
		expectedRevision: resized.revision,
		operations: [{ op: 'update', id: 'notes', changes: { text: '' } }],
	});
	expect(cleared.data.elements.some((e: any) => e.id === label.id)).toBe(false);
	expect(cleared.data.elements.some((e: any) => e.id === 'notes')).toBe(true);
	expect(cleared.data.elements.some((e: any) => e.id === 'arrow')).toBe(true);
});

test('Canvas readiness waits for an already-opening document before mounting the editor', async ({
	page,
}) => {
	await setup(page);
	const result = await page.evaluate(async (target) => {
		const { canvasDocument, canvasService } = await import('/src/lib/canvas/canvas.ts');
		await canvasService.edit(
			target,
			[
				{
					op: 'add',
					object: { id: 'held', type: 'rectangle', x: 30, y: 40, text: 'Load before mounting' },
				},
			],
			{ create: { title: 'Pending scene' } },
		);
		const originalRead = canvasDocument.read.bind(canvasDocument);
		const originalEnsure = canvasDocument.ensure.bind(canvasDocument);
		let releaseRead!: () => void, enteredRead!: () => void, ensuredDocument!: () => void;
		const readGate = new Promise<void>((resolve) => {
			releaseRead = resolve;
		});
		const readStarted = new Promise<void>((resolve) => {
			enteredRead = resolve;
		});
		const documentEnsured = new Promise<void>((resolve) => {
			ensuredDocument = resolve;
		});
		canvasDocument.read = async (path) => {
			if (path === target) {
				enteredRead();
				await readGate;
			}
			return originalRead(path);
		};
		canvasDocument.ensure = async () => {
			await originalEnsure();
			ensuredDocument();
		};
		let settled = false;
		let ensureError = '';
		const opening = canvasDocument.open(target);
		try {
			await readStarted;
			const ensuring = Promise.all([canvasService.ensure(), canvasService.ensure()]).then(
				() => {
					settled = true;
				},
				(cause) => {
					settled = true;
					ensureError = String(cause);
				},
			);
			await documentEnsured;
			// Drain promise continuations while the document read remains deliberately blocked.
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			const settledBeforeRead = settled;
			const loadingBeforeRead = canvasDocument.snapshot().loading;
			releaseRead();
			await Promise.all([opening, ensuring]);
			return { settledBeforeRead, loadingBeforeRead, ensureError, scene: canvasService.snapshot() };
		} finally {
			releaseRead();
			canvasDocument.read = originalRead;
			canvasDocument.ensure = originalEnsure;
		}
	}, scenePath);
	expect(result.loadingBeforeRead).toBe(true);
	expect(result.settledBeforeRead).toBe(false);
	expect(result.ensureError).toBe('');
	expect(result.scene).toMatchObject({ path: scenePath, title: 'Pending scene', status: 'saved' });
	await ok(page, 'desktop_reveal', { target: 'canvas' });
	await expect(page.locator('[data-app-id="canvas"] .excalidraw')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Retry editor', exact: true })).toHaveCount(0);
});

test('Canvas readiness rejects a failed pending open instead of reusing the previous scene', async ({
	page,
}) => {
	await setup(page);
	const result = await page.evaluate(async (target) => {
		const { canvasDocument, canvasService } = await import('/src/lib/canvas/canvas.ts');
		await canvasService.edit(
			target,
			[{ op: 'add', object: { id: 'original', type: 'rectangle', x: 10, y: 20 } }],
			{ create: { title: 'Original scene' } },
		);
		await canvasDocument.open(target);
		await canvasService.ensure();
		const originalRead = canvasDocument.read.bind(canvasDocument);
		let releaseRead!: () => void, enteredRead!: () => void;
		const gate = new Promise<void>((resolve) => {
			releaseRead = resolve;
		});
		const started = new Promise<void>((resolve) => {
			enteredRead = resolve;
		});
		canvasDocument.read = async (path) => {
			if (path === '/Documents/Unavailable.canvas.json') {
				enteredRead();
				await gate;
				throw new Error('Injected canvas read failure');
			}
			return originalRead(path);
		};
		try {
			const opening = canvasDocument.open('/Documents/Unavailable.canvas.json').catch(String);
			await started;
			const readiness = canvasService.ensure().then(() => 'unexpected success', String);
			releaseRead();
			const [openError, readinessError] = await Promise.all([opening, readiness]);
			return { openError, readinessError, previousTitle: canvasService.snapshot().title };
		} finally {
			releaseRead();
			canvasDocument.read = originalRead;
		}
	}, scenePath);
	expect(result.openError).toContain('Injected canvas read failure');
	expect(result.readinessError).toContain('Injected canvas read failure');
	expect(result.previousTitle).toBe('Original scene');
});

test('drawing engine loads on demand and its fonts stay on the local origin', async ({ page }) => {
	const requests: string[] = [],
		errors: string[] = [];
	page.on('request', (r) => requests.push(r.url()));
	page.on('pageerror', (e) => errors.push(e.message));
	await setup(page);
	expect(requests.some((url) => /@excalidraw|excalidraw\/fonts/.test(url))).toBe(false);
	const created = await scene(page);
	await ok(page, 'canvas_read', { path: scenePath, includeImage: true });
	expect(created.data.elements.length).toBeGreaterThan(0);
	expect(requests.some((url) => url.includes('/excalidraw/fonts/'))).toBe(true);
	expect(
		requests.filter(
			(url) => url.startsWith('http') && !url.startsWith(`${test.info().project.use.baseURL}/`),
		),
	).toEqual([]);
	expect(errors).toEqual([]);
});

test('resize and native focus cannot scroll the desktop toolbar offscreen', async ({ page }) => {
	await setup(page);
	await ok(page, 'canvas_edit', {
		path: scenePath,
		create: { title: 'Resize safety' },
		operations: [],
	});
	const { app } = await draw(page, 'Rectangle');
	await page.setViewportSize({ width: 390, height: 720 });
	await app.getByRole('button', { name: 'Fit', exact: true }).click();
	const frame = (await app.boundingBox())!;
	expect(frame.y).toBeGreaterThanOrEqual(28);
	expect(frame.y + frame.height).toBeLessThanOrEqual(641);
	expect(await page.locator('#windows-area').evaluate((el) => el.scrollTop)).toBe(0);
	await app.getByRole('button', { name: 'New', exact: true }).click();
	await expect(app.getByLabel('Canvas title', { exact: true })).toBeVisible();
	await app.getByRole('button', { name: 'Cancel', exact: true }).click();
	await page.setViewportSize({ width: 1280, height: 800 });
	await app.getByRole('button', { name: 'Fit', exact: true }).click();
	const before = (await app.boundingBox())!;
	await draw(page);
	expect(await app.boundingBox()).toEqual(before);
});

test('simultaneous agent scene edits commit only one revision', async ({ page }) => {
	await setup(page);
	const base = await scene(page);
	const results = await Promise.all(
		['First', 'Second'].map((text) =>
			call(page, 'canvas_edit', {
				path: scenePath,
				expectedRevision: base.revision,
				operations: [{ op: 'update', id: 'notes', changes: { text } }],
			}),
		),
	);
	expect(results.filter((r) => r.structuredContent.ok)).toHaveLength(1);
	expect(results.find((r) => !r.structuredContent.ok).structuredContent.error.code).toBe(
		'FILE_CHANGED',
	);
});

test('queued agent commit checks again after a new human stroke', async ({ page }) => {
	await setup(page);
	const base = await ok(page, 'canvas_edit', {
		path: scenePath,
		create: { title: 'Queued safety' },
		operations: [],
	});
	const app = page.locator('[data-app-id="canvas"]');
	await expect(app.locator('canvas.interactive')).toBeVisible();
	await app
		.locator('label')
		.filter({ has: page.getByRole('radio', { name: 'Draw', exact: true }) })
		.click();
	await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const { canvasDocument } = await import('/src/lib/canvas/canvas.ts');
		void workspaceService.mutate(
			() =>
				new Promise<void>((resolve) => {
					(window as any).__releaseCanvasQueue = resolve;
				}),
		);
		const write = canvasDocument.write.bind(canvasDocument);
		canvasDocument.write = (...args) => {
			(window as any).__canvasWriteQueued = true;
			canvasDocument.write = write;
			return write(...args);
		};
	});
	await page.waitForFunction(() => Boolean((window as any).__releaseCanvasQueue));
	const pending = call(page, 'canvas_edit', {
		path: scenePath,
		expectedRevision: base.revision,
		operations: [{ op: 'add', object: { id: 'agent', type: 'rectangle' } }],
	});
	await page.waitForFunction(() => Boolean((window as any).__canvasWriteQueued));
	const box = (await app.locator('canvas.interactive').boundingBox())!;
	await page.mouse.move(box.x + 600, box.y + 250);
	await page.mouse.down();
	await page.mouse.move(box.x + 700, box.y + 280, { steps: 8 });
	await page.mouse.up();
	await page.evaluate(() => (window as any).__releaseCanvasQueue());
	expect((await pending).structuredContent.error.code).toBe('FILE_CHANGED');
	const saved = await ok(page, 'canvas_read', { path: scenePath });
	expect(saved.data.elements).toHaveLength(1);
	expect(saved.data.elements[0].type).toBe('freedraw');
});

test('stroke point edits preserve native freehand export and reject malformed points', async ({
	page,
}) => {
	await setup(page);
	const base = await ok(page, 'canvas_edit', {
		path: scenePath,
		create: { title: 'Editable stroke' },
		operations: [
			{
				op: 'add',
				object: {
					id: 'stroke',
					type: 'freedraw',
					points: [
						[0, 0],
						[40, 30],
						[80, 0],
					],
				},
			},
		],
	});
	const next = await ok(page, 'canvas_edit', {
		path: scenePath,
		expectedRevision: base.revision,
		operations: [
			{
				op: 'update',
				id: 'stroke',
				changes: {
					points: [
						[0, 0],
						[40, -30],
						[100, 20],
					],
					x: 150,
				},
			},
		],
	});
	expect(next.data.elements[0].width).toBe(100);
	expect(next.data.elements[0].height).toBe(50);
	const image = await call(page, 'canvas_read', { path: scenePath, includeImage: true });
	expect(image.content.some((c: any) => c.type === 'image')).toBe(true);
	expect(
		(
			await call(page, 'canvas_edit', {
				path: scenePath,
				expectedRevision: next.revision,
				operations: [
					{
						op: 'update',
						id: 'stroke',
						changes: {
							points: [
								[null, 0],
								[1, 2],
							],
						},
					},
				],
			})
		).structuredContent.ok,
	).toBe(false);
});

test('legacy scenes open without rewriting, then migrate on the first deliberate edit', async ({
	page,
}) => {
	await setup(page);
	const content = JSON.stringify({
		format: 'webmcp-canvas',
		version: 1,
		title: 'Legacy sketch',
		width: 1200,
		height: 700,
		objects: [
			{
				id: 'legacy',
				type: 'sticky',
				x: 80,
				y: 80,
				width: 240,
				height: 140,
				text: 'Original idea',
				fill: '#fff2b3',
				color: '#243247',
				fontSize: 22,
				link: null,
			},
		],
	});
	await ok(page, 'files_write', { path: scenePath, content, createOnly: true });
	const before = await ok(page, 'files_read', { path: scenePath });
	await ok(page, 'desktop_reveal', { path: scenePath });
	await expect(page.locator('[data-app-id="canvas"] canvas.interactive')).toBeVisible();
	await page
		.locator('[data-app-id="canvas"]')
		.getByRole('button', { name: 'Fit', exact: true })
		.click();
	expect((await ok(page, 'files_read', { path: scenePath })).content).toBe(content);
	const read = await ok(page, 'canvas_read', { path: scenePath });
	expect(read.revision).toBe(before.revision);
	expect(read.data.elements.some((e: any) => e.id === 'legacy')).toBe(true);
	const changed = await ok(page, 'canvas_edit', {
		path: scenePath,
		expectedRevision: read.revision,
		operations: [{ op: 'update', id: 'legacy', changes: { text: 'Continued idea' } }],
	});
	expect(JSON.parse((await ok(page, 'files_read', { path: scenePath })).content).type).toBe(
		'excalidraw',
	);
	expect(
		(await ok(page, 'review_read', { versionId: changed.entry.versionId })).review.canRestore,
	).toBe(true);
});

test('native additions preserve unrelated labels and strokes, and arrows follow node moves', async ({
	page,
}) => {
	await setup(page);
	const created = await scene(page);
	const label = created.data.elements.find((e: any) => e.containerId === 'notes');
	const node = created.data.elements.find((e: any) => e.id === 'notes');
	expect(label.x).toBeGreaterThan(node.x);
	expect(label.x + label.width).toBeLessThan(node.x + node.width);
	const arrow = created.data.elements.find((e: any) => e.id === 'arrow');
	expect(arrow.x).toBeGreaterThan(node.x + node.width);
	const added = await ok(page, 'canvas_edit', {
		path: scenePath,
		expectedRevision: created.revision,
		operations: [
			{
				op: 'add',
				object: {
					id: 'stroke',
					type: 'freedraw',
					x: 80,
					y: 330,
					points: [
						[0, 0],
						[20, 20],
						[50, 0],
					],
				},
			},
		],
	});
	expect(added.data.elements.find((e: any) => e.id === label.id)).toEqual(label);
	const moved = await ok(page, 'canvas_edit', {
		path: scenePath,
		expectedRevision: added.revision,
		operations: [{ op: 'update', id: 'notes', changes: { y: 120 } }],
	});
	expect(moved.data.elements.find((e: any) => e.id === 'stroke')).toEqual(
		added.data.elements.find((e: any) => e.id === 'stroke'),
	);
	const movedArrow = moved.data.elements.find((e: any) => e.id === 'arrow');
	expect(movedArrow.y + movedArrow.points[0][1]).toBe(arrow.y + arrow.points[0][1] + 50);
});

test('external writes during drawing retain the draft and offer a safe copy', async ({ page }) => {
	await setup(page);
	await ok(page, 'canvas_edit', {
		path: scenePath,
		create: { title: 'Conflict original' },
		operations: [],
	});
	const app = page.locator('[data-app-id="canvas"]');
	await expect(app.locator('canvas.interactive')).toBeVisible();
	await app
		.locator('label')
		.filter({ has: page.getByRole('radio', { name: 'Draw', exact: true }) })
		.click();
	const original = await ok(page, 'files_read', { path: scenePath });
	const box = (await app.locator('canvas.interactive').boundingBox())!;
	await page.mouse.move(box.x + 600, box.y + 250);
	await page.mouse.down();
	await page.mouse.move(box.x + 700, box.y + 290, { steps: 10 });
	const external = JSON.parse(original.content);
	external.title = 'External version';
	const write = await ok(page, 'files_write', {
		path: scenePath,
		content: JSON.stringify(external),
		expectedRevision: original.revision,
	});
	await page.mouse.up();
	await expect(app).toContainText('Changes need review');
	expect(
		(await ok(page, 'review_read', { versionId: write.entry.versionId })).review.canRestore,
	).toBe(false);
	await app.getByRole('button', { name: 'Save Copy', exact: true }).first().click();
	await app
		.getByLabel('Save to workspace', { exact: true })
		.fill('/Documents/Recovered sketch.excalidraw');
	await app.getByRole('button', { name: 'Save copy', exact: true }).click();
	await expect(app.getByRole('heading', { level: 1 })).toHaveAttribute(
		'title',
		'/Documents/Recovered sketch.excalidraw',
	);
	expect(
		(await ok(page, 'canvas_read', { path: '/Documents/Recovered sketch.excalidraw' })).data
			.elements[0].type,
	).toBe('freedraw');
	expect(JSON.parse((await ok(page, 'files_read', { path: scenePath })).content).title).toBe(
		'External version',
	);
});

test('native scene import preserves embedded raster data and exports an editable download', async ({
	page,
}) => {
	await setup(page);
	const created = await scene(page);
	await ok(page, 'canvas_export', {
		path: scenePath,
		destination: '/Documents/Reference.png',
		expectedRevision: created.revision,
	});
	const bytes = await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		return Array.from(await workspaceService.readBytes('/Documents/Reference.png'));
	});
	const dataURL = 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
	const imported = {
		type: 'excalidraw',
		version: 2,
		title: 'Image sketch',
		appState: { viewBackgroundColor: '#ffffff' },
		elements: [
			{
				id: 'photo',
				type: 'image',
				x: 100,
				y: 100,
				width: 300,
				height: 120,
				fileId: 'image-file',
				status: 'saved',
				scale: [1, 1],
			},
		],
		files: { 'image-file': { id: 'image-file', mimeType: 'image/png', created: 0, dataURL } },
	};
	const app = page.locator('[data-app-id="canvas"]');
	await app.getByRole('button', { name: 'Import', exact: true }).click();
	await app.getByLabel('Choose a canvas file').setInputFiles({
		name: 'Image sketch.excalidraw',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(imported)),
	});
	await app.getByRole('button', { name: 'Import into workspace', exact: true }).click();
	await expect(app.getByRole('heading', { level: 1 })).toHaveAttribute(
		'title',
		'/Documents/Image sketch.excalidraw',
	);
	const read = await ok(page, 'canvas_read', {
		path: '/Documents/Image sketch.excalidraw',
		includeImage: true,
	});
	expect(read.data.elements[0].type).toBe('image');
	const downloadEvent = page.waitForEvent('download');
	await app.getByRole('button', { name: 'Download .excalidraw', exact: true }).click();
	const download = await downloadEvent;
	const stream = await download.createReadStream();
	const chunks: Buffer[] = [];
	for await (const chunk of stream!) chunks.push(chunk);
	const saved = JSON.parse(Buffer.concat(chunks).toString());
	expect(saved.files['image-file'].dataURL).toBe(dataURL);
	expect(saved.elements[0].id).toBe('photo');
});

test('invalid imports and unsupported embeds cannot replace the active saved scene', async ({
	page,
}) => {
	await setup(page);
	const before = await scene(page);
	const app = page.locator('[data-app-id="canvas"]');
	await app.getByRole('button', { name: 'Import', exact: true }).click();
	await app.getByLabel('Choose a canvas file').setInputFiles({
		name: 'Bad.excalidraw',
		mimeType: 'application/json',
		buffer: Buffer.from(
			JSON.stringify({
				type: 'excalidraw',
				version: 2,
				elements: [
					{
						id: 'remote',
						type: 'embeddable',
						x: 0,
						y: 0,
						width: 100,
						height: 100,
						link: 'https://example.com',
					},
				],
			}),
		),
	});
	await app.getByRole('button', { name: 'Import into workspace', exact: true }).click();
	await expect(app.getByRole('alert')).toContainText('Unsupported');
	expect((await ok(page, 'canvas_read', { path: scenePath })).revision).toBe(before.revision);
	expect(
		(await call(page, 'files_stat', { path: '/Documents/Bad.excalidraw' })).structuredContent.ok,
	).toBe(false);
});
async function task(page: Page) {
	await ok(page, 'files_write', {
		path: '/Documents/Source.md',
		content: 'Prepare sponsor brief',
		createOnly: true,
	});
	return ok(page, 'tasks_create', {
		path: taskPath,
		listTitle: 'Launch plan',
		title: 'Prepare sponsor brief',
		dueDate: '2026-09-04',
		sourcePath: '/Documents/Source.md',
	});
}
async function scene(page: Page) {
	return ok(page, 'canvas_edit', {
		path: scenePath,
		create: { title: 'Launch flow', width: 1200, height: 700 },
		operations: [
			{
				op: 'add',
				object: { id: 'notes', type: 'rectangle', x: 50, y: 70, text: 'Read the notes' },
			},
			{
				op: 'add',
				object: { id: 'brief', type: 'sticky', x: 430, y: 70, text: 'Prepare the brief' },
			},
			{ op: 'add', object: { id: 'arrow', type: 'connector', from: 'notes', to: 'brief' } },
		],
	});
}

test('tasks connect evidence to outputs, filter, persist, and route from Finder', async ({
	page,
}) => {
	await setup(page);
	const created = await task(page);
	await ok(page, 'files_write', {
		path: '/Documents/Brief.md',
		content: '# Sponsor brief',
		createOnly: true,
	});
	const updated = await ok(page, 'tasks_update', {
		path: taskPath,
		id: created.task.id,
		expectedRevision: created.revision,
		changes: { status: 'done', outputPath: '/Documents/Brief.md' },
	});
	expect(updated.entry.versionId).toBeTruthy();
	const list = await ok(page, 'tasks_list', { path: taskPath, status: 'done', query: 'sponsor' });
	expect(list.tasks).toHaveLength(1);
	expect(list.tasks[0]).toMatchObject({ sourceExists: true, outputExists: true, status: 'done' });
	expect((await ok(page, 'tasks_list', { path: taskPath, status: 'todo' })).tasks).toHaveLength(0);
	await page.reload();
	await page.waitForFunction(() => Boolean((window as any).__planning.tasks_list));
	expect((await ok(page, 'tasks_list', { path: taskPath })).revision).toBe(updated.revision);
	await ok(page, 'desktop_reveal', { target: 'finder', path: taskPath });
	await page.locator(`[data-path="${taskPath}"]`).dblclick();
	await expect(page.locator('[data-app-id="tasks"]')).toBeVisible();
	await expect(page.locator('[data-app-id="tasks"]')).toContainText('Prepare sponsor brief');
});

test('tasks reject stale and simultaneous edits without lost updates', async ({ page }) => {
	await setup(page);
	const created = await task(page);
	const results = await Promise.all(
		['Human', 'Agent'].map((title) =>
			call(page, 'tasks_update', {
				path: taskPath,
				id: created.task.id,
				expectedRevision: created.revision,
				changes: { title },
			}),
		),
	);
	expect(results.filter((r) => r.structuredContent.ok)).toHaveLength(1);
	expect(results.find((r) => !r.structuredContent.ok).structuredContent.error.code).toBe(
		'FILE_CHANGED',
	);
	const denied = await call(page, 'tasks_create', { path: taskPath, title: 'No revision' });
	expect(denied.structuredContent.error.code).toBe('FILE_CHANGED');
});

test('task dates and evidence validate, while a broken old link does not block completion', async ({
	page,
}) => {
	await setup(page);
	for (const bad of [
		{ dueDate: '2026-02-30' },
		{ sourcePath: '/Documents/Missing.md' },
		{ status: 'finished' },
		{ title: '' },
	]) {
		expect(
			(await call(page, 'tasks_create', { path: taskPath, title: 'Task', ...bad }))
				.structuredContent.ok,
		).toBe(false);
	}
	const created = await task(page);
	await ok(page, 'files_trash', { path: '/Documents/Source.md' });
	expect((await ok(page, 'tasks_list', { path: taskPath })).tasks[0].sourceExists).toBe(false);
	await ok(page, 'tasks_update', {
		path: taskPath,
		id: created.task.id,
		expectedRevision: created.revision,
		changes: { status: 'done', dueDate: null },
	});
});

test('malformed task and canvas files are not silently replaced', async ({ page }) => {
	await setup(page);
	for (const [path, tool] of [
		[taskPath, 'tasks_list'],
		[scenePath, 'canvas_read'],
	]) {
		await ok(page, 'files_write', { path, content: '{ broken', createOnly: true });
		expect((await call(page, tool, { path })).structuredContent.error.code).toBe('INVALID_DATA');
		expect((await ok(page, 'files_read', { path })).content).toBe('{ broken');
	}
});

test('canvas scene, attached connectors, atomic validation and revision checks', async ({
	page,
}) => {
	await setup(page);
	const created = await scene(page);
	const moved = await ok(page, 'canvas_edit', {
		path: scenePath,
		expectedRevision: created.revision,
		operations: [{ op: 'update', id: 'notes', changes: { x: 100, text: 'Review notes' } }],
	});
	await expect(page.locator('[data-app-id="canvas"]')).toBeVisible();
	expect(moved.data.elements.find((o: any) => o.id === 'notes').x).toBe(100);
	const invalid = await call(page, 'canvas_edit', {
		path: scenePath,
		expectedRevision: moved.revision,
		operations: [
			{ op: 'update', id: 'notes', changes: { text: 'Must not save' } },
			{ op: 'add', object: { id: 'bad', type: 'connector', from: 'absent', to: 'brief' } },
		],
	});
	expect(invalid.structuredContent.error.code).toBe('INVALID_CONNECTOR');
	expect((await ok(page, 'canvas_read', { path: scenePath })).revision).toBe(moved.revision);
	expect(
		(
			await call(page, 'canvas_edit', {
				path: scenePath,
				expectedRevision: created.revision,
				operations: [],
			})
		).structuredContent.error.code,
	).toBe('FILE_CHANGED');
	const removed = await ok(page, 'canvas_edit', {
		path: scenePath,
		expectedRevision: moved.revision,
		operations: [{ op: 'delete', id: 'notes' }],
	});
	expect(removed.data.elements.filter((o: any) => o.type !== 'text').map((o: any) => o.id)).toEqual(
		['brief'],
	);
});

test('canvas rejects invalid geometry, IDs, colors, missing file links and overwrites', async ({
	page,
}) => {
	await setup(page);
	const created = await scene(page);
	for (const changes of [
		{ x: -1000001 },
		{ width: -1 },
		{ color: 'url(https://example.com)' },
		{ type: 'text' },
		{ link: '/Missing.md' },
	]) {
		expect(
			(
				await call(page, 'canvas_edit', {
					path: scenePath,
					expectedRevision: created.revision,
					operations: [{ op: 'update', id: 'notes', changes }],
				})
			).structuredContent.ok,
		).toBe(false);
	}
	expect(
		(
			await call(page, 'canvas_edit', {
				path: scenePath,
				create: { title: 'Overwrite' },
				operations: [],
			})
		).structuredContent.error.code,
	).toBe('PATH_EXISTS');
	expect((await ok(page, 'canvas_read', { path: scenePath })).revision).toBe(created.revision);
});

test('task and canvas saved versions restore into live apps', async ({ page }) => {
	await setup(page);
	const t = await task(page),
		c = await scene(page);
	const taskEdit = await ok(page, 'tasks_update', {
		path: taskPath,
		id: t.task.id,
		expectedRevision: t.revision,
		changes: { title: 'Changed task' },
	});
	const canvasEdit = await ok(page, 'canvas_edit', {
		path: scenePath,
		expectedRevision: c.revision,
		operations: [{ op: 'update', id: 'brief', changes: { text: 'Changed idea' } }],
	});
	for (const changed of [taskEdit, canvasEdit]) {
		const review = (await ok(page, 'review_read', { versionId: changed.entry.versionId })).review;
		expect(
			review.suggestedCopy.endsWith(
				changed.path.endsWith('.tasks.json') ? '.tasks.json' : '.canvas.json',
			),
		).toBe(true);
		await ok(page, 'review_restore', {
			versionId: changed.entry.versionId,
			mode: 'replace',
			expectedCurrentToken: review.current.token,
		});
	}
	expect((await ok(page, 'tasks_list', { path: taskPath })).tasks[0].title).toBe(
		'Prepare sponsor brief',
	);
	expect(
		(await ok(page, 'canvas_read', { path: scenePath })).data.elements.find(
			(o: any) => o.containerId === 'brief',
		).text,
	).toBe('Prepare the brief');
	await expect(page.locator('[data-app-id="canvas"] .excalidraw')).toBeVisible();
});

test('canvas PNG is real, source remains editable, export collision is safe', async ({ page }) => {
	await setup(page);
	const created = await scene(page);
	const exported = await ok(page, 'canvas_export', {
		path: scenePath,
		destination: '/Documents/Flow.png',
		expectedRevision: created.revision,
	});
	expect(exported.sourceRevision).toBe(created.revision);
	expect(exported.width).toBeGreaterThan(600);
	expect(exported.width).toBeLessThanOrEqual(1600);
	const source = (await ok(page, 'preview_read', { path: exported.path })).source;
	expect(source).toMatchObject({ kind: 'image', width: exported.width, height: exported.height });
	expect((await ok(page, 'canvas_read', { path: scenePath })).revision).toBe(created.revision);
	expect(
		(
			await call(page, 'canvas_export', {
				path: scenePath,
				destination: exported.path,
				expectedRevision: created.revision,
			})
		).structuredContent.error.code,
	).toBe('PATH_EXISTS');
});

test('canvas PNG embeds in the real Documents runtime', async ({ page }) => {
	test.setTimeout(180000);
	await setup(page);
	const created = await scene(page);
	await ok(page, 'canvas_export', {
		path: scenePath,
		destination: '/Documents/Flow.png',
		expectedRevision: created.revision,
	});
	await ok(page, 'documents_create', {
		path: '/Documents/Plan.odt',
		blocks: [{ type: 'paragraph', text: 'Launch workflow' }],
	});
	const before = (await ok(page, 'documents_read', { path: '/Documents/Plan.odt' })).document;
	await ok(page, 'documents_edit', {
		path: '/Documents/Plan.odt',
		expectedRevision: before.revision,
		operation: {
			type: 'insert-image',
			imagePath: '/Documents/Flow.png',
			description: 'Launch workflow diagram',
		},
	});
	const doc = await ok(page, 'documents_read', { path: '/Documents/Plan.odt' });
	expect(doc.document.imageCount).toBe(1);
});

test('active task and canvas files follow moves and reopen after reload', async ({ page }) => {
	await setup(page);
	await task(page);
	await scene(page);
	for (const path of [taskPath, scenePath])
		await ok(page, 'files_move', { source: path, destination: path.replace('Launch', 'Moved') });
	await expect
		.poll(async () => (await ok(page, 'tasks_list')).path)
		.toBe('/Documents/Moved.tasks.json');
	await expect
		.poll(async () => (await ok(page, 'canvas_read')).path)
		.toBe('/Documents/Moved.canvas.json');
	await page.reload();
	await page.waitForFunction(() => Boolean((window as any).__planning.tasks_list));
	await page.getByRole('button', { name: 'Launch Tasks app' }).click();
	await expect(page.locator('[data-app-id="tasks"] h1')).toHaveAttribute(
		'title',
		'/Documents/Moved.tasks.json',
	);
	await page.getByRole('button', { name: 'Launch Canvas app' }).click();
	await expect(page.locator('[data-app-id="canvas"] h1')).toHaveAttribute(
		'title',
		'/Documents/Moved.canvas.json',
	);
});

test('human task drafts survive agent edits and closing; Review refuses draft overwrite', async ({
	page,
}) => {
	await setup(page);
	const created = await task(page);
	const app = page.locator('[data-app-id="tasks"]');
	await app.getByLabel('Title', { exact: true }).fill('My unsaved wording');
	await page.getByRole('button', { name: 'Close Tasks', exact: true }).click();
	await expect(app).toBeVisible();
	const changed = await ok(page, 'tasks_update', {
		path: taskPath,
		id: created.task.id,
		expectedRevision: created.revision,
		changes: { status: 'in-progress' },
	});
	await expect(app.getByLabel('Title', { exact: true })).toHaveValue('My unsaved wording');
	const review = (await ok(page, 'review_read', { versionId: changed.entry.versionId })).review;
	expect(review.canRestore).toBe(false);
	await expect(app.getByRole('button', { name: 'Save Task', exact: true })).toBeDisabled();
	await expect(app).toContainText('changed');
	expect((await ok(page, 'tasks_list', { path: taskPath })).tasks[0].title).toBe(
		'Prepare sponsor brief',
	);
	await app.getByRole('button', { name: /Discard.*Reload/ }).click();
	await app.getByLabel('Title', { exact: true }).fill('Human approved brief');
	await app.getByRole('button', { name: 'Save Task', exact: true }).click();
	await expect
		.poll(async () => (await ok(page, 'tasks_list', { path: taskPath })).tasks[0].title)
		.toBe('Human approved brief');
});

async function draw(page: Page, tool = 'Draw') {
	const app = page.locator('[data-app-id="canvas"]');
	await expect(app.locator('canvas.interactive')).toBeVisible();
	await app
		.locator('label')
		.filter({ has: page.getByRole('radio', { name: tool, exact: true }) })
		.click();
	const box = (await app.locator('canvas.interactive').boundingBox())!;
	// Stay clear of the floating palette and native style inspector.
	const x = box.x + box.width * 0.58,
		y = box.y + box.height * 0.55;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 55, y - 25, { steps: 8 });
	await page.mouse.move(x + 100, y + 30, { steps: 8 });
	await page.mouse.up();
	return { app, x, y };
}

test('changing appearance preserves native canvas selection, saved content, and undo history', async ({
	page,
}) => {
	await page.addInitScript(() => {
		localStorage.setItem(
			'macos:preferences',
			JSON.stringify({ theme: { scheme: 'light' }, wallpaper: { canControlTheme: false } }),
		);
	});
	await setup(page);
	await ok(page, 'canvas_edit', {
		path: scenePath,
		create: { title: 'Appearance and drawing' },
		operations: [],
	});
	const { app } = await draw(page, 'Rectangle');
	const before = await ok(page, 'canvas_read', { path: scenePath });
	expect(before.data.elements).toHaveLength(1);
	expect(before.selectedIds).toEqual([before.data.elements[0].id]);

	await page.getByRole('button', { name: 'Control Center', exact: true }).click();
	await page
		.locator('#control-center')
		.getByRole('button', { name: 'Dark mode', exact: true })
		.click();
	await expect(app.locator('.excalidraw').first()).toHaveClass(/theme--dark/);
	await page.keyboard.press('Escape');
	await expect(page.locator('#control-center')).toHaveCount(0);

	const dark = await ok(page, 'canvas_read', { path: scenePath });
	expect(dark.revision).toBe(before.revision);
	expect(dark.selectedIds).toEqual(before.selectedIds);
	expect(dark.data).toEqual(before.data);

	await expect(app.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
	await app.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect
		.poll(async () => (await ok(page, 'canvas_read', { path: scenePath })).data.elements.length)
		.toBe(0);
	await expect(app.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
	await app.getByRole('button', { name: 'Redo', exact: true }).click();
	const rectangle = before.data.elements[0];
	await expect
		.poll(async () => (await ok(page, 'canvas_read', { path: scenePath })).data.elements)
		.toEqual([
			expect.objectContaining({
				id: rectangle.id,
				type: 'rectangle',
				x: rectangle.x,
				y: rectangle.y,
				width: rectangle.width,
				height: rectangle.height,
				strokeColor: rectangle.strokeColor,
			}),
		]);
});

test('human freehand remains editable, agent can see it, and targeted edits enter native undo', async ({
	page,
}) => {
	await setup(page);
	await ok(page, 'canvas_edit', {
		path: scenePath,
		create: { title: 'Shared sketch' },
		operations: [],
	});
	const { app } = await draw(page);
	const read = await ok(page, 'canvas_read', { path: scenePath, includePoints: true });
	expect(read.data.elements).toHaveLength(1);
	const stroke = read.data.elements[0];
	expect(stroke.type).toBe('freedraw');
	expect(stroke.points.length).toBeGreaterThan(8);
	const pictured = await call(page, 'canvas_read', { path: scenePath, includeImage: true });
	expect(pictured.content.find((c: any) => c.type === 'image').data).toMatch(/^iVBOR/);
	const changed = await ok(page, 'canvas_edit', {
		path: scenePath,
		expectedRevision: read.revision,
		operations: [{ op: 'update', id: stroke.id, changes: { color: '#1971c2' } }],
	});
	expect(changed.data.elements[0].strokeColor).toBe('#1971c2');
	await expect(app.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
	await app.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect
		.poll(
			async () =>
				(await ok(page, 'canvas_read', { path: scenePath })).data.elements[0]?.strokeColor,
		)
		.toBe(stroke.strokeColor);
	await app.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect
		.poll(
			async () =>
				(await ok(page, 'canvas_read', { path: scenePath })).data.elements[0]?.strokeColor,
		)
		.toBe('#1971c2');
	await page.getByRole('button', { name: 'Close Canvas', exact: true }).click();
	await page.getByRole('button', { name: 'Launch Canvas app', exact: true }).click();
	await expect(app.locator('canvas.interactive')).toBeVisible();
	expect(
		(await ok(page, 'canvas_read', { path: scenePath, includePoints: true })).data.elements[0]
			.points,
	).toEqual(stroke.points);
	await page.reload();
	await page.waitForFunction(() => Boolean((window as any).__planning.canvas_read));
	expect((await ok(page, 'canvas_read', { path: scenePath })).data.elements[0].id).toBe(stroke.id);
});

test('agent writes reject an active human stroke without losing the sketch', async ({ page }) => {
	await setup(page);
	const created = await ok(page, 'canvas_edit', {
		path: scenePath,
		create: { title: 'Stroke safety' },
		operations: [],
	});
	const app = page.locator('[data-app-id="canvas"]');
	await app
		.locator('label')
		.filter({ has: page.getByRole('radio', { name: 'Draw', exact: true }) })
		.click();
	const box = (await app.locator('canvas.interactive').boundingBox())!;
	await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 5 });
	const result = await call(page, 'canvas_edit', {
		path: scenePath,
		expectedRevision: created.revision,
		operations: [
			{ op: 'add', object: { id: 'nope', type: 'text', text: 'Must not replace active drawing' } },
		],
	});
	expect(result.structuredContent.error.code).toBe('CANVAS_BUSY');
	await page.mouse.up();
	const read = await ok(page, 'canvas_read', { path: scenePath });
	expect(read.data.elements).toHaveLength(1);
	expect(read.data.elements[0].type).toBe('freedraw');
	expect(
		(
			await call(page, 'canvas_edit', {
				path: scenePath,
				expectedRevision: created.revision,
				operations: [],
			})
		).structuredContent.error.code,
	).toBe('FILE_CHANGED');
});

test('human native shapes, selection, links and workspace PNG export', async ({ page }) => {
	await setup(page);
	await ok(page, 'canvas_edit', {
		path: scenePath,
		create: { title: 'Human shapes' },
		operations: [],
	});
	const { app } = await draw(page, 'Rectangle');
	const read = await ok(page, 'canvas_read', { path: scenePath });
	expect(read.data.elements).toHaveLength(1);
	expect(read.selectedIds).toEqual([read.data.elements[0].id]);
	await ok(page, 'files_write', {
		path: '/Documents/Evidence.md',
		content: '# Source',
		createOnly: true,
	});
	await app.getByRole('button', { name: 'Link selection', exact: true }).click();
	await app.getByLabel('Workspace file link', { exact: true }).fill('/Documents/Evidence.md');
	await app.getByRole('button', { name: 'Apply link', exact: true }).click();
	await expect
		.poll(async () => (await ok(page, 'canvas_read', { path: scenePath })).data.elements[0].link)
		.toBe('/Documents/Evidence.md');
	const selected = await ok(page, 'canvas_read', { path: scenePath, scope: 'selection' });
	expect(selected.total).toBe(1);
	const output = await ok(page, 'canvas_export', {
		path: scenePath,
		destination: '/Documents/Human.png',
		expectedRevision: selected.revision,
	});
	expect((await ok(page, 'preview_read', { path: output.path })).source.kind).toBe('image');
});

test('compact task creation and native drawing controls stay reachable', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 720 });
	await setup(page);
	await task(page);
	const tasks = page.locator('[data-app-id="tasks"]');
	await tasks.getByRole('button', { name: 'New Task', exact: true }).click();
	await tasks.getByLabel('Title', { exact: true }).fill('Compact task');
	await tasks.getByRole('button', { name: 'Save Task', exact: true }).click();
	await expect
		.poll(async () => (await ok(page, 'tasks_list', { path: taskPath })).tasks.length)
		.toBe(2);
	await ok(page, 'canvas_edit', {
		path: scenePath,
		create: { title: 'Compact canvas' },
		operations: [],
	});
	const canvas = page.locator('[data-app-id="canvas"]');
	await expect(canvas.locator('canvas.interactive')).toBeVisible();
	await canvas
		.locator('label')
		.filter({ has: page.getByRole('radio', { name: 'Draw', exact: true }) })
		.click();
	const box = (await canvas.locator('canvas.interactive').boundingBox())!;
	await page.mouse.move(box.x + 200, box.y + 180);
	await page.mouse.down();
	await page.mouse.move(box.x + 270, box.y + 230, { steps: 10 });
	await page.mouse.up();
	expect((await ok(page, 'canvas_read', { path: scenePath })).data.elements[0].type).toBe(
		'freedraw',
	);
	for (const app of [tasks, canvas]) {
		const bounds = (await app.boundingBox())!;
		expect(bounds.x).toBeGreaterThanOrEqual(0);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
	}
	await page.screenshot({ path: '/tmp/os-webmcp-excalidraw-compact.png' });
});
