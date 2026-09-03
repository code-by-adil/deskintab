import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
	await page.addInitScript(() => {
		const tools: Record<string, any> = {};
		Object.defineProperty(window, '__agentTools', { value: tools });
		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			value: {
				registerTool: (tool: any) => {
					tools[tool.name] = tool;
				},
			},
		});
	});
	await page.goto('/');
	await page.waitForFunction(() => Boolean((window as any).__agentTools.desktop_get_context));
}
async function call(page: Page, name: string, input: Record<string, unknown> = {}) {
	return page.evaluate(
		async ({ name, input }) => (window as any).__agentTools[name].execute(input),
		{ name, input },
	);
}
async function ok(page: Page, name: string, input: Record<string, unknown> = {}) {
	const result = await call(page, name, input);
	expect(result.structuredContent.ok, JSON.stringify(result).slice(0, 1000)).toBe(true);
	return result.structuredContent;
}
async function imageFile(page: Page, path: string, large = false) {
	return page.evaluate(
		async ({ path, large }) => {
			const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
			const canvas = document.createElement('canvas');
			canvas.width = large ? 1100 : 80;
			canvas.height = large ? 1000 : 40;
			const context = canvas.getContext('2d')!;
			if (large) {
				const data = context.createImageData(canvas.width, canvas.height);
				let seed = 73913;
				for (let i = 0; i < data.data.length; i++) {
					seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
					data.data[i] = seed >>> 24;
				}
				context.putImageData(data, 0, 0);
			} else {
				context.fillStyle = '#1971c2';
				context.fillRect(0, 0, 80, 40);
			}
			const blob = await new Promise<Blob>((resolve) =>
				canvas.toBlob((b) => resolve(b!), 'image/png'),
			);
			await workspaceService.writeBytes(path, new Uint8Array(await blob.arrayBuffer()), {
				createOnly: true,
			});
			return blob.size;
		},
		{ path, large },
	);
}
const path = '/Documents/Agent sketch.excalidraw';
async function diagram(page: Page) {
	return ok(page, 'canvas_edit', {
		path,
		create: { title: 'Shared diagram' },
		operations: [
			{ op: 'add', object: { id: 'a', type: 'rectangle', x: 20, y: 20, text: 'Idea' } },
			{ op: 'add', object: { id: 'b', type: 'rectangle', x: 400, y: 20, text: 'Plan' } },
			{ op: 'add', object: { id: 'c', type: 'ellipse', x: 750, y: 220, text: 'Deliver' } },
			{
				op: 'add',
				object: {
					id: 'arrow',
					type: 'connector',
					from: 'a',
					to: 'b',
					text: 'Next',
					color: '#1971c2',
				},
			},
		],
	});
}

test('task reads discover empty workspaces and remember a saved list before opening the app', async ({
	page,
}) => {
	await setup(page);
	const empty = await ok(page, 'tasks_list');
	expect(empty).toMatchObject({ path: null, revision: null, tasks: [], availableLists: [] });
	expect(
		(await call(page, 'files_stat', { path: '/Documents/My tasks.tasks.json' })).structuredContent
			.ok,
	).toBe(false);
	const list = '/Documents/Remembered.tasks.json';
	const created = await ok(page, 'tasks_create', { path: list, title: 'Remember this' });
	await page.reload();
	await page.waitForFunction(() => Boolean((window as any).__agentTools.tasks_list));
	const before = await ok(page, 'activity_list');
	const read = await ok(page, 'tasks_list');
	expect(read).toMatchObject({ path: list, revision: created.revision });
	expect(read.tasks[0].id).toBe(created.task.id);
	expect((await ok(page, 'desktop_get_context')).context.tasks).toBeNull();
	expect(await ok(page, 'activity_list')).toEqual(before);
	await ok(page, 'files_move', { source: list, destination: '/Documents/Moved.tasks.json' });
	const missing = await ok(page, 'tasks_list');
	expect(missing.availableLists).toContain('/Documents/Moved.tasks.json');
	expect(missing.path).toBeNull();
});

test('agent inserts workspace image bytes, exports them, and native undo preserves the source', async ({
	page,
}) => {
	await setup(page);
	await imageFile(page, '/Documents/Source.png');
	const created = await diagram(page);
	await expect(
		page.locator('[data-app-id="canvas"]').getByRole('button', { name: 'Undo', exact: true }),
	).toBeVisible();
	const saved = await ok(page, 'canvas_edit', {
		path,
		expectedRevision: created.revision,
		operations: [
			{
				op: 'add',
				object: {
					id: 'image',
					type: 'image',
					imagePath: '/Documents/Source.png',
					x: 30,
					y: 300,
					width: 240,
				},
			},
		],
	});
	const read = await ok(page, 'canvas_read', { path });
	const image = read.data.elements.find((e: any) => e.id === 'image');
	expect(image).toMatchObject({ type: 'image', width: 240, height: 120, status: 'saved' });
	expect(read.data.files[image.fileId]).toMatchObject({ mimeType: 'image/png' });
	expect(JSON.stringify(read)).not.toContain('data:image');
	await ok(page, 'canvas_export', {
		path,
		expectedRevision: saved.revision,
		destination: '/Documents/Agent export.png',
	});
	const preview = await call(page, 'preview_read', {
		path: '/Documents/Agent export.png',
		includeImage: true,
	});
	expect(preview.content.map((part: any) => part.type)).toEqual(['text', 'image']);
	expect(preview.structuredContent.source.rendered.width).toBeLessThanOrEqual(1600);
	expect(JSON.stringify(preview.structuredContent)).not.toContain('base64');
	await ok(page, 'desktop_reveal', { path });
	const editor = page.locator('[data-app-id="canvas"]');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	expect(
		(await ok(page, 'canvas_read', { path })).data.elements.some((e: any) => e.id === 'image'),
	).toBe(false);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	expect(
		(await ok(page, 'canvas_read', { path })).data.elements.find((e: any) => e.id === 'image')
			.fileId,
	).toBe(image.fileId);
	await page.reload();
	await page.waitForFunction(() => Boolean((window as any).__agentTools.canvas_read));
	expect((await ok(page, 'canvas_read')).data.elements.some((e: any) => e.id === 'image')).toBe(
		true,
	);
});

test('reconnect keeps arrow and label IDs, repairs endpoint membership, and rejects stale edits', async ({
	page,
}) => {
	await setup(page);
	const created = await diagram(page);
	const label = created.data.elements.find((e: any) => e.containerId === 'arrow');
	const updated = await ok(page, 'canvas_edit', {
		path,
		expectedRevision: created.revision,
		operations: [{ op: 'update', id: 'arrow', changes: { to: 'c' } }],
	});
	const arrow = updated.data.elements.find((e: any) => e.id === 'arrow');
	expect(arrow).toMatchObject({
		startBinding: { elementId: 'a' },
		endBinding: { elementId: 'c' },
		strokeColor: '#1971c2',
	});
	expect(updated.data.elements.find((e: any) => e.containerId === 'arrow').id).toBe(label.id);
	expect(
		updated.data.elements
			.find((e: any) => e.id === 'b')
			.boundElements?.some((e: any) => e.id === 'arrow') ?? false,
	).toBe(false);
	expect(updated.data.elements.find((e: any) => e.id === 'c').boundElements).toContainEqual({
		id: 'arrow',
		type: 'arrow',
	});
	const rejected = await call(page, 'canvas_edit', {
		path,
		expectedRevision: created.revision,
		operations: [{ op: 'update', id: 'arrow', changes: { to: 'b' } }],
	});
	expect(rejected.structuredContent.error.code).toBe('FILE_CHANGED');
	const invalid = await call(page, 'canvas_edit', {
		path,
		expectedRevision: updated.revision,
		operations: [{ op: 'update', id: 'arrow', changes: { from: 'missing' } }],
	});
	expect(invalid.structuredContent.error.code).toBe('INVALID_CONNECTOR');
	expect((await ok(page, 'canvas_read', { path })).revision).toBe(updated.revision);
	const reviewed = (await ok(page, 'review_read', { versionId: updated.entry.versionId })).review;
	expect(reviewed.semantic.changes.find((e: any) => e.id === 'arrow').fields).toContain('bindings');
	expect(reviewed.diff).toBeNull();
	expect(
		(await ok(page, 'review_read', { versionId: updated.entry.versionId, includeRawDiff: true }))
			.review.diff,
	).not.toBeNull();
});

test('invalid image insertion is atomic and leaves no embedded file or partial object', async ({
	page,
}) => {
	await setup(page);
	const created = await diagram(page);
	await ok(page, 'files_write', {
		path: '/Documents/Bad.png',
		content: '<svg>not PNG</svg>',
		createOnly: true,
	});
	const failed = await call(page, 'canvas_edit', {
		path,
		expectedRevision: created.revision,
		operations: [
			{ op: 'add', object: { id: 'temporary', type: 'text', text: 'Must not survive' } },
			{ op: 'add', object: { id: 'bad-image', type: 'image', imagePath: '/Documents/Bad.png' } },
		],
	});
	expect(failed.structuredContent.error.code).toBe('INVALID_IMAGE');
	expect((await ok(page, 'canvas_read', { path })).revision).toBe(created.revision);
});

test('image-rich canvas above 5 MiB retains complete recovery bytes', async ({ page }) => {
	test.setTimeout(90000);
	await setup(page);
	await imageFile(page, '/Documents/Large.png', true);
	const created = await ok(page, 'canvas_edit', {
		path,
		create: { title: 'Large scene' },
		operations: [
			{ op: 'add', object: { id: 'large', type: 'image', imagePath: '/Documents/Large.png' } },
		],
	});
	expect(created.entry.size).toBeGreaterThan(5 * 1024 * 1024);
	const updated = await ok(page, 'canvas_edit', {
		path,
		expectedRevision: created.revision,
		operations: [{ op: 'update', id: 'large', changes: { x: 500 } }],
	});
	const review = (await ok(page, 'review_read', { versionId: updated.entry.versionId })).review;
	expect(review.version.recovery).toBe(true);
	expect(review.semantic.changes).toEqual([
		expect.objectContaining({ id: 'large', fields: ['position'] }),
	]);
	const restored = await ok(page, 'review_restore', {
		versionId: updated.entry.versionId,
		mode: 'copy',
		destination: '/Documents/Large restored.excalidraw',
	});
	const copy = await ok(page, 'canvas_read', { path: restored.entry.path });
	expect(copy.revision).toBe(created.revision);
});
