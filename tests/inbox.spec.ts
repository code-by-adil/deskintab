import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
	await page.waitForFunction(() => Boolean((window as any).__inboxTools.inbox_update));
}

async function setup(page: Page) {
	await page.addInitScript(() => {
		const tools: Record<string, any> = {};
		Object.defineProperty(window, '__inboxTools', { value: tools });
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

async function call(page: Page, name: string, input: Record<string, unknown> = {}) {
	return page.evaluate(
		async ({ name, input }) => (window as any).__inboxTools[name].execute(input),
		{ name, input },
	);
}

async function ok(page: Page, name: string, input: Record<string, unknown> = {}) {
	const result = await call(page, name, input);
	expect(result.structuredContent.ok, JSON.stringify(result).slice(0, 2000)).toBe(true);
	return result.structuredContent;
}

async function createRequest(page: Page, title = 'Client research') {
	return ok(page, 'inbox_create', {
		title,
		request: 'Compare the interview notes and prepare a client update.',
	});
}

async function openInbox(page: Page) {
	await page.getByRole('button', { name: 'Launch Inbox app', exact: true }).click();
	const app = page.locator('[data-app-id="inbox"]');
	await expect(app).toBeVisible();
	return app;
}

test('Inbox discovery and opening an empty Inbox leave workspace files unchanged', async ({
	page,
}) => {
	await setup(page);
	const activity = await ok(page, 'activity_list');
	const files = await ok(page, 'files_list', { path: '/' });
	expect(await ok(page, 'inbox_list')).toMatchObject({
		requests: [],
		errors: [],
		truncated: false,
	});
	const app = await openInbox(page);
	const initial = await app.boundingBox();
	const header = await app.locator('.app-window-drag-handle').boundingBox();
	await page.mouse.move(header!.x + 160, header!.y + 20);
	await page.mouse.down();
	await page.mouse.move(header!.x + 200, header!.y + 45, { steps: 4 });
	await page.mouse.up();
	await expect.poll(async () => (await app.boundingBox())!.x).toBeGreaterThan(initial!.x + 20);
	expect((await ok(page, 'inbox_list')).requests).toEqual([]);
	expect(await ok(page, 'files_list', { path: '/' })).toEqual(files);
	expect(await ok(page, 'activity_list')).toEqual(activity);
});

test('a human captures notes, a source URL, and binary files that survive reload', async ({
	page,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await setup(page);
	const app = await openInbox(page);
	await app.getByRole('button', { name: 'New request', exact: true }).click();
	await app.getByLabel('Request title', { exact: true }).fill('Interview synthesis');
	await app
		.getByLabel('What needs doing?', { exact: true })
		.fill('Compare the interviews and identify the three most common problems.');
	const note = '# Interview notes\n\nবাংলা notes and café feedback remain intact.\n';
	await app.getByLabel('Pasted notes', { exact: true }).fill(note);
	const sourceUrl = 'https://example.com/interviews?batch=2#notes';
	await app.getByLabel('Source URL', { exact: true }).fill(sourceUrl);
	const binary = Buffer.from(Array.from({ length: 256 }, (_, value) => value));
	const csv = 'interview,problem\nA,search\nB,search\n';
	await app.getByLabel('Files', { exact: true }).setInputFiles([
		{ name: 'Interview recording.bin', mimeType: 'application/octet-stream', buffer: binary },
		{ name: 'Findings.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) },
	]);
	await app.getByRole('button', { name: 'Add to Inbox', exact: true }).click();
	await expect(app.getByRole('button', { name: 'Edit request', exact: true })).toBeVisible();
	await app.screenshot({ path: '/tmp/webmcp-inbox-capture.png' });
	const listed = await ok(page, 'inbox_list');
	expect(listed.requests).toHaveLength(1);
	expect(listed.requests[0]).toMatchObject({
		title: 'Interview synthesis',
		state: 'new',
		attachmentCount: 3,
	});
	const path = listed.requests[0].path;
	const captured = await ok(page, 'inbox_read', { path });
	expect(captured.data).toMatchObject({
		title: 'Interview synthesis',
		request: 'Compare the interviews and identify the three most common problems.',
		sourceUrl,
		state: 'new',
		outputPaths: [],
	});
	expect((await ok(page, 'files_read', { path: captured.data.notePath })).content).toBe(note);
	const attachment = captured.data.attachments.find(
		(item: any) => item.name === 'Interview recording.bin',
	);
	expect(attachment).toMatchObject({ size: binary.length });
	expect((await ok(page, 'files_stat', { path: attachment.path })).entry.size).toBe(binary.length);
	const csvFile = captured.data.attachments.find((item: any) => item.name === 'Findings.csv');
	expect((await ok(page, 'files_read', { path: csvFile.path })).content).toBe(csv);
	await page.reload();
	await ready(page);
	const saved = await ok(page, 'inbox_read', { path });
	expect(saved.data).toEqual(captured.data);
	expect(saved.revision).toBe(captured.revision);
	expect(saved.links).toEqual(
		expect.arrayContaining([
			{ path: attachment.path, exists: true },
			{ path: csvFile.path, exists: true },
			{ path: captured.data.notePath, exists: true },
		]),
	);
	const storedBytes = await page.evaluate(async (filePath) => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		return Array.from(await workspaceService.readBytes(filePath));
	}, attachment.path);
	expect(storedBytes).toEqual(Array.from(binary));
	expect((await ok(page, 'files_read', { path: saved.data.notePath })).content).toBe(note);
	expect(errors).toEqual([]);
});

test('requests with the same title retain independent files and metadata', async ({ page }) => {
	await setup(page);
	const first = await ok(page, 'inbox_create', {
		title: 'Client update',
		request: 'Use the first interview.',
		files: [{ name: 'Interview.txt', content: 'First interview', encoding: 'utf8' }],
	});
	const second = await ok(page, 'inbox_create', {
		title: 'Client update',
		request: 'Use the second interview.',
		files: [{ name: 'Interview.txt', content: 'Second interview', encoding: 'utf8' }],
	});
	expect(second.path).not.toBe(first.path);
	expect(second.data.attachments[0].path).not.toBe(first.data.attachments[0].path);
	expect((await ok(page, 'files_read', { path: first.data.attachments[0].path })).content).toBe(
		'First interview',
	);
	expect((await ok(page, 'files_read', { path: second.data.attachments[0].path })).content).toBe(
		'Second interview',
	);
	expect((await ok(page, 'inbox_list')).requests).toHaveLength(2);
	await page.reload();
	await ready(page);
	expect((await ok(page, 'inbox_read', { path: first.path })).data.request).toBe(
		'Use the first interview.',
	);
	expect((await ok(page, 'inbox_read', { path: second.path })).data.request).toBe(
		'Use the second interview.',
	);
});

test('filing and completing an intake request require real project and output files', async ({
	page,
}) => {
	await setup(page);
	const captured = await createRequest(page);
	for (const changes of [
		{ state: 'filed' },
		{ state: 'filed', projectPath: '/Projects/Missing.project.json' },
		{ state: 'done', outputPaths: [] },
		{ state: 'done', outputPaths: ['/Documents/Missing report.md'] },
	]) {
		const rejected = await call(page, 'inbox_update', {
			path: captured.path,
			expectedRevision: captured.revision,
			changes,
		});
		expect(rejected.structuredContent.ok, JSON.stringify(rejected)).toBe(false);
		expect((await ok(page, 'inbox_read', { path: captured.path })).revision).toBe(
			captured.revision,
		);
	}
	const projectPath = '/Projects/Research/Client.project.json';
	await ok(page, 'projects_create', {
		path: projectPath,
		title: 'Client research',
		objective: 'Prepare a useful synthesis of customer interviews.',
	});
	const filed = await ok(page, 'inbox_update', {
		path: captured.path,
		expectedRevision: captured.revision,
		changes: { state: 'filed', projectPath },
	});
	expect(filed.data).toMatchObject({ state: 'filed', projectPath });
	const outputPath = '/Documents/Client findings.md';
	await ok(page, 'files_write', {
		path: outputPath,
		content: '# Client findings\n\nTwo interviews identify search as the main problem.\n',
		createOnly: true,
	});
	const app = await openInbox(page);
	await app.getByRole('button', { name: 'Edit request', exact: true }).click();
	await app.getByRole('combobox', { name: 'Status', exact: true }).selectOption('done');
	await app.getByLabel('Output files', { exact: true }).fill(outputPath);
	await app.getByRole('button', { name: 'Save request', exact: true }).click();
	await expect(app.getByRole('dialog')).toHaveCount(0);
	await expect(app.getByRole('status')).toHaveText('Request saved');
	const completed = await ok(page, 'inbox_read', { path: captured.path });
	expect(completed.data).toMatchObject({ state: 'done', projectPath, outputPaths: [outputPath] });
	expect(completed.links).toEqual(
		expect.arrayContaining([
			{ path: projectPath, exists: true },
			{ path: outputPath, exists: true },
		]),
	);
	expect(completed.revision).not.toBe(filed.revision);
	await page.reload();
	await ready(page);
	expect((await ok(page, 'inbox_read', { path: captured.path })).data).toEqual(completed.data);
	expect((await ok(page, 'files_read', { path: outputPath })).content).toContain(
		'Two interviews identify search',
	);
});

test('concurrent request updates reject stale revisions and retain the accepted edit', async ({
	page,
}) => {
	await setup(page);
	const initial = await createRequest(page);
	const updates = await Promise.all(
		['Summarize the interviews.', 'Compare the proposals.'].map((request) =>
			call(page, 'inbox_update', {
				path: initial.path,
				expectedRevision: initial.revision,
				changes: { request },
			}),
		),
	);
	const accepted = updates.filter((result) => result.structuredContent.ok);
	expect(accepted).toHaveLength(1);
	expect(updates.find((result) => !result.structuredContent.ok).structuredContent.error.code).toBe(
		'FILE_CHANGED',
	);
	const saved = await ok(page, 'inbox_read', { path: initial.path });
	expect(saved.data.request).toBe(accepted[0].structuredContent.data.request);
	expect(saved.revision).toBe(accepted[0].structuredContent.revision);
	await page.reload();
	await ready(page);
	expect((await ok(page, 'inbox_read', { path: initial.path })).data).toEqual(saved.data);
});

test('invalid requests and attachment names fail before leaving partial intake records', async ({
	page,
}) => {
	await setup(page);
	const before = await ok(page, 'files_list', { path: '/' });
	for (const input of [
		{ title: '', request: 'Write a report.' },
		{ title: 'Empty request', request: '   ' },
		{ title: 'Unsafe URL', request: 'Read this.', sourceUrl: 'javascript:alert(1)' },
		{
			title: 'Escaping attachment',
			request: 'Read this.',
			files: [{ name: '../outside.txt', content: 'Do not write this.', encoding: 'utf8' }],
		},
		{
			title: 'Absolute attachment',
			request: 'Read this.',
			files: [{ name: '/Documents/outside.txt', content: 'Do not write this.', encoding: 'utf8' }],
		},
		{
			title: 'Invalid binary',
			request: 'Read this.',
			files: [{ name: 'broken.bin', content: 'not valid base64!', encoding: 'base64' }],
		},
		{ title: 'Unknown option', request: 'Read this.', execute: 'arbitrary command' },
	]) {
		const rejected = await call(page, 'inbox_create', input);
		expect(rejected.structuredContent.ok, JSON.stringify(rejected)).toBe(false);
		expect((await ok(page, 'inbox_list')).requests).toEqual([]);
	}
	expect(await ok(page, 'files_list', { path: '/' })).toEqual(before);
	const captured = await createRequest(page);
	for (const changes of [{ state: 'running' }, { attachmentPaths: ['/private/secret'] }]) {
		const rejected = await call(page, 'inbox_update', {
			path: captured.path,
			expectedRevision: captured.revision,
			changes,
		});
		expect(rejected.structuredContent.ok).toBe(false);
	}
	expect((await ok(page, 'inbox_read', { path: captured.path })).data).toEqual(captured.data);
});

test('binary decoding accepts the full file limit and rejects an extra byte', async ({ page }) => {
	await setup(page);
	const decoded = await page.evaluate(async () => {
		const { decodeInboxUploads, INBOX_MAX_FILE_BYTES } = await import('/src/lib/inbox/inbox.ts');
		// Four slashes encode three 0xff bytes. The suffix adds the final byte for 10 MB.
		const prefix = '////'.repeat(Math.floor(INBOX_MAX_FILE_BYTES / 3));
		const accepted = decodeInboxUploads([
			{ name: 'Full-size.bin', content: prefix + '/w==', encoding: 'base64' },
		])[0];
		let oversizedCode = '';
		try {
			decodeInboxUploads([{ name: 'Too-large.bin', content: prefix + '//8=', encoding: 'base64' }]);
		} catch (error) {
			oversizedCode = (error as { code: string }).code;
		}
		return {
			length: accepted.bytes.length,
			allBytesPreserved: accepted.bytes.every((byte) => byte === 255),
			oversizedCode,
		};
	});
	expect(decoded).toEqual({
		length: 10_000_000,
		allBytesPreserved: true,
		oversizedCode: 'FILE_TOO_LARGE',
	});
});

test('cancelling an import queued behind another mutation writes no attachment or request', async ({
	page,
}) => {
	await setup(page);
	const result = await page.evaluate(async () => {
		const { inboxService } = await import('/src/lib/inbox/inbox.ts');
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const controller = new AbortController();
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		const blocker = workspaceService.mutate(() => held);
		let signalQueued!: (path: string) => void;
		const enqueued = new Promise<string>((resolve) => (signalQueued = resolve));
		const originalWrite = workspaceService.writeBytes;
		workspaceService.writeBytes = function (...args) {
			const pending = originalWrite.apply(this, args);
			signalQueued(args[0]);
			return pending;
		};
		try {
			const creation = inboxService
				.create(
					{
						title: 'Cancelled import',
						request: 'Read these input files.',
						files: [{ name: 'Input.bin', bytes: new Uint8Array([0, 1, 2, 255]) }],
					},
					{ actor: 'agent', signal: controller.signal },
				)
				.then(
					() => ({ code: 'UNEXPECTED_SUCCESS' }),
					(error) => ({
						code: error instanceof DOMException ? error.name : (error.code ?? error.name),
					}),
				);
			const attachmentPath = await Promise.race([
				enqueued,
				creation.then(() => {
					throw new Error('The import finished before its write entered the queue.');
				}),
			]);
			controller.abort(new DOMException('Cancelled intake', 'AbortError'));
			release();
			const outcome = await creation;
			await blocker;
			return {
				outcome,
				attachmentExists: await workspaceService.exists(attachmentPath),
				requests: (await inboxService.list()).requests,
			};
		} finally {
			release();
			workspaceService.writeBytes = originalWrite;
		}
	});
	expect(result.attachmentExists).toBe(false);
	expect(result.requests).toEqual([]);
	expect(result.outcome.code).toBe('AbortError');
});

test('malformed Inbox files remain intact and do not hide valid incoming requests', async ({
	page,
}) => {
	await setup(page);
	const valid = await createRequest(page);
	const path = '/Inbox/Broken.inbox.json';
	const content = '{"format":"webmcp-inbox","version":1,"title":"Broken request"';
	await ok(page, 'files_write', { path, content, createOnly: true });
	const listed = await ok(page, 'inbox_list');
	expect(listed.requests).toHaveLength(1);
	expect(listed.requests[0].path).toBe(valid.path);
	expect(listed.errors).toEqual([expect.objectContaining({ path, message: expect.any(String) })]);
	const rejected = await call(page, 'inbox_read', { path });
	expect(rejected.structuredContent.error.code).toBe('INVALID_DATA');
	expect((await ok(page, 'files_read', { path })).content).toBe(content);
	await page.reload();
	await ready(page);
	expect((await ok(page, 'inbox_read', { path: valid.path })).data).toEqual(valid.data);
	expect((await ok(page, 'files_read', { path })).content).toBe(content);
});

test('a human draft is protected from agent edits and survives an external file change', async ({
	page,
}) => {
	await setup(page);
	const captured = await createRequest(page);
	const app = await openInbox(page);
	await app.getByRole('button', { name: 'Edit request', exact: true }).click();
	const draft = 'My unsaved instructions for the client update.';
	await app.getByLabel('What needs doing?', { exact: true }).fill(draft);
	const beforeUnload = page.waitForEvent('dialog');
	await page.evaluate(() => {
		setTimeout(() => location.reload(), 0);
	});
	const confirmation = await beforeUnload;
	expect(confirmation.type()).toBe('beforeunload');
	await confirmation.dismiss();
	await expect(app.getByLabel('What needs doing?', { exact: true })).toHaveValue(draft);
	await page.getByRole('button', { name: 'Close Inbox', exact: true }).click();
	await expect(app).toBeVisible();
	const rejected = await call(page, 'inbox_update', {
		path: captured.path,
		expectedRevision: captured.revision,
		changes: { request: 'Overwrite the human instructions.' },
	});
	expect(rejected.structuredContent.error.code).toBe('OPEN_DRAFT');
	const stored = await ok(page, 'files_read', { path: captured.path });
	await ok(page, 'files_patch', {
		path: captured.path,
		expectedRevision: stored.revision,
		find: captured.data.request,
		replace: 'A newer request saved from the file editor.',
	});
	await expect(app.getByLabel('What needs doing?', { exact: true })).toHaveValue(draft);
	await expect(app.getByRole('button', { name: 'Save request', exact: true })).toBeDisabled();
	await app.getByRole('button', { name: 'Discard changes', exact: true }).click();
	await app.getByRole('button', { name: 'Edit request', exact: true }).click();
	await expect(app.getByLabel('What needs doing?', { exact: true })).toHaveValue(
		'A newer request saved from the file editor.',
	);
	await app.getByLabel('What needs doing?', { exact: true }).fill(draft);
	await app.getByRole('button', { name: 'Save request', exact: true }).click();
	await expect(app.getByRole('dialog')).toHaveCount(0);
	await expect(app.getByRole('status')).toHaveText('Request saved');
	expect((await ok(page, 'inbox_read', { path: captured.path })).data.request).toBe(draft);
	await page.getByRole('button', { name: 'Close Inbox', exact: true }).click();
	await expect(app).toHaveCount(0);
});
