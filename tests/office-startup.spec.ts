import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
	await page.addInitScript(() => {
		const tools: Record<string, any> = {};
		Object.defineProperty(window, '__officeTools', { value: tools });
		Object.defineProperty(document, 'modelContext', {
			value: {
				async registerTool(tool: any) {
					tools[tool.name] = tool;
				},
			},
			configurable: true,
		});
	});
	await page.goto('/');
	await page.waitForFunction(() => Boolean((window as any).__officeTools.documents_create));
}
async function call(page: Page, name: string, input: Record<string, unknown>) {
	return page.evaluate(
		async ({ name, input }) =>
			(window as any).__officeTools[name].execute(input, { signal: new AbortController().signal }),
		{ name, input },
	);
}
async function read(page: Page, path: string) {
	const result = await call(page, 'documents_read', { path });
	expect(result.structuredContent.ok, JSON.stringify(result)).toBe(true);
	return result.structuredContent.document;
}

function simplePdf() {
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
	];
	const stream = 'BT /F1 18 Tf 50 700 Td (PDF viewing without Writer) Tj ET';
	objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
	let text = '%PDF-1.4\n';
	const offsets = [0];
	for (const [i, body] of objects.entries()) {
		offsets.push(text.length);
		text += `${i + 1} 0 obj\n${body}\nendobj\n`;
	}
	const xref = text.length;
	text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
	return Array.from(
		new TextEncoder().encode(
			text + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,
		),
	);
}

test('PDF-only viewing skips Writer, and New and Back to document start it when needed', async ({
	page,
}) => {
	test.setTimeout(90000);
	await setup(page);
	await page.evaluate(async (bytes) => {
		// @ts-ignore -- Vite serves the shared workspace service.
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		await workspaceService.writeBytes('/Documents/Preview.pdf', new Uint8Array(bytes));
	}, simplePdf());
	const requests: string[] = [];
	page.on('request', (request) => {
		if (request.url().includes('/office/')) requests.push(request.url());
	});
	const win = page.locator('[data-app-id="documents"]');
	for (let i = 0; i < 2; i++) {
		expect(
			(await call(page, 'desktop_reveal', { path: '/Documents/Preview.pdf', target: 'documents' }))
				.structuredContent.ok,
		).toBe(true);
		await expect(
			page.getByRole('region', { name: 'PDF preview' }).locator('canvas'),
		).toHaveAttribute('data-rendered', 'true');
		await expect(page.locator('iframe[title="Office document editor"]')).toHaveCount(0);
		expect(requests).toEqual([]);
		if (i === 0) {
			await win.getByRole('button', { name: 'Close Documents', exact: true }).click();
			await expect(win).toHaveCount(0);
		}
	}
	await win.getByRole('button', { name: 'New', exact: true }).click();
	// This is the first actual Writer launch; the PDF-only checks deliberately left its assets cold.
	await expect(win.locator('.document-title strong')).toHaveText('Untitled.odt', {
		timeout: 30000,
	});
	const canvas = page.frameLocator('iframe[title="Office document editor"]').locator('#qtcanvas');
	await canvas.pressSequentially('A draft after a PDF');
	await expect
		.poll(async () => (await read(page, '/Documents/Untitled.odt')).text)
		.toContain('A draft after a PDF');
	await win.getByRole('button', { name: 'Close Documents', exact: true }).click();
	await expect(win).toHaveCount(0);
	await call(page, 'desktop_reveal', { path: '/Documents/Preview.pdf', target: 'documents' });
	await expect(page.getByRole('region', { name: 'PDF preview' }).locator('canvas')).toHaveAttribute(
		'data-rendered',
		'true',
	);
	await expect(page.locator('iframe[title="Office document editor"]')).toHaveCount(0);
	await win.getByRole('button', { name: 'Back to document', exact: true }).click();
	await expect(win.locator('.document-title strong')).toHaveText('Untitled.odt', {
		timeout: 30000,
	});
	expect((await read(page, '/Documents/Untitled.odt')).text).toContain('A draft after a PDF');
});

for (const failure of [
	{ name: 'bootstrap', url: '**/office/bootstrap.js?*', status: 503, body: 'Unavailable' },
	{
		name: 'metadata HTTP error',
		url: '**/office/runtime/soffice.data.js.metadata',
		status: 503,
		body: 'Unavailable',
	},
	{
		name: 'metadata invalid JSON',
		url: '**/office/runtime/soffice.data.js.metadata',
		status: 200,
		body: 'not json',
	},
	{ name: 'runtime script', url: '**/office/runtime/soffice.js', status: 503, body: 'Unavailable' },
	{ name: 'worker script', url: '**/office/office-thread.js?*', status: 503, body: 'Unavailable' },
])
	test(`startup failure: ${failure.name} releases the engine and Retry opens a document`, async ({
		page,
	}) => {
		test.setTimeout(90000);
		await setup(page);
		await page.route(failure.url, (route) =>
			route.fulfill({ status: failure.status, body: failure.body, contentType: 'text/javascript' }),
		);
		// A normal dock launch must get the same error/retry lifecycle as an agent call.
		await page.getByRole('button', { name: 'Launch Documents app', exact: true }).click();
		await expect(page.getByText('Documents could not start', { exact: true })).toBeVisible({
			timeout: 15000,
		});
		await expect(page.getByRole('button', { name: 'Try Again', exact: true })).toBeEnabled();
		await expect(page.locator('iframe[title="Office document editor"]')).toHaveCount(0);
		await expect.poll(() => page.workers().length).toBe(0);
		await page.unroute(failure.url);
		await page.getByRole('button', { name: 'Try Again', exact: true }).click();
		await expect(page.locator('[data-app-id="documents"] .document-title strong')).toHaveText(
			'Untitled.odt',
			{ timeout: 30000 },
		);
		expect((await read(page, '/Documents/Untitled.odt')).text).toBe('');
	});

test('a silent worker gets a bounded ready deadline and can be retried', async ({ page }) => {
	test.setTimeout(90000);
	await page.clock.install();
	await setup(page);
	await page.route('**/office/office-thread.js?*', (route) =>
		route.fulfill({ contentType: 'text/javascript', body: 'Module.zetajs.then(() => {});' }),
	);
	const pending = call(page, 'documents_create', { path: '/Documents/Timed-out.odt', blocks: [] });
	await expect(page.getByText('Starting Writer…', { exact: true }).first()).toBeVisible({
		timeout: 30000,
	});
	await page.clock.fastForward(61000);
	expect((await pending).structuredContent.ok).toBe(false);
	await expect(page.getByText('Documents could not start', { exact: true })).toBeVisible();
	await expect(page.getByRole('alert')).toContainText('did not become ready');
	await expect(page.locator('iframe[title="Office document editor"]')).toHaveCount(0);
	await page.unroute('**/office/office-thread.js?*');
	await page.getByRole('button', { name: 'Try Again', exact: true }).click();
	await expect(page.locator('[data-app-id="documents"] .document-title strong')).toHaveText(
		'Untitled.odt',
		{ timeout: 30000 },
	);
});

test('reopening uses compressed asset cache and closing releases every Office worker', async ({
	page,
}) => {
	test.setTimeout(90000);
	await setup(page);
	const chunks: string[] = [];
	page.on('request', (r) => {
		if (r.url().endsWith('.chunk')) chunks.push(r.url());
	});
	for (let i = 0; i < 5; i++) {
		const previous = chunks.length;
		const result = await call(page, 'documents_create', {
			path: `/Documents/Cycle-${i}.odt`,
			blocks: [{ type: 'paragraph', text: `Cycle ${i}` }],
		});
		expect(result.structuredContent.ok, JSON.stringify(result)).toBe(true);
		if (i === 0) expect(chunks.length).toBeGreaterThan(0);
		else expect(chunks.length).toBe(previous);
		expect((await read(page, `/Documents/Cycle-${i}.odt`)).text).toBe(`Cycle ${i}`);
		await page.getByRole('button', { name: 'Close Documents', exact: true }).click();
		await expect(page.locator('[data-app-id="documents"]')).toHaveCount(0);
		await expect.poll(() => page.workers().length).toBe(0);
	}
});

test('cache denial falls back to ordinary asset loading', async ({ page }) => {
	test.setTimeout(90000);
	await setup(page);
	await page.addInitScript(() => {
		Object.defineProperty(window, 'caches', {
			value: {
				open: async () => {
					throw new DOMException('Denied', 'SecurityError');
				},
			},
		});
	});
	expect(
		(await call(page, 'documents_create', { path: '/Documents/Without-cache.odt', blocks: [] }))
			.structuredContent.ok,
	).toBe(true);
	await page.getByRole('button', { name: 'Close Documents', exact: true }).click();
});

test('corrupt cached font data is removed so Try Again can recover', async ({ page }) => {
	test.setTimeout(90000);
	await setup(page);
	await page.evaluate(async () => {
		const manifest = await (await fetch('/office/runtime/manifest.json')).json();
		const cache = await caches.open('desktop-office-assets-v1');
		await cache.put(
			'/office/runtime/' + manifest.packages['NotoSerifBengali-Regular.ttf'].parts[0],
			new Response('broken gzip'),
		);
	});
	expect(
		(await call(page, 'documents_create', { path: '/Documents/Bad-cache.odt', blocks: [] }))
			.structuredContent.ok,
	).toBe(false);
	await expect(page.getByText('Documents could not start', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Try Again', exact: true }).click();
	await expect(page.locator('[data-app-id="documents"] .document-title strong')).toHaveText(
		'Untitled.odt',
		{ timeout: 30000 },
	);
});

test('failed Writer launch from a PDF keeps viewing usable and exposes Retry', async ({ page }) => {
	test.setTimeout(60000);
	await setup(page);
	await page.evaluate(async (bytes) => {
		// @ts-ignore -- Vite serves the shared workspace service.
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		await workspaceService.writeBytes('/Documents/Preview.pdf', new Uint8Array(bytes));
	}, simplePdf());
	await call(page, 'desktop_reveal', { path: '/Documents/Preview.pdf', target: 'documents' });
	await expect(page.getByRole('region', { name: 'PDF preview' }).locator('canvas')).toHaveAttribute(
		'data-rendered',
		'true',
	);
	await page.route('**/office/runtime/soffice.data.js.metadata', (route) =>
		route.fulfill({ status: 503, body: 'Unavailable' }),
	);
	await page
		.locator('[data-app-id="documents"]')
		.getByRole('button', { name: 'New', exact: true })
		.click();
	await expect(page.getByRole('alert')).toContainText('metadata');
	await expect(page.getByRole('link', { name: 'Download PDF', exact: true })).toBeVisible();
	await page.unroute('**/office/runtime/soffice.data.js.metadata');
	await page.getByRole('button', { name: 'Try Again', exact: true }).click();
	await expect(page.locator('[data-app-id="documents"] .document-title strong')).toHaveText(
		'Untitled.odt',
		{ timeout: 30000 },
	);
});

for (const [phase, url] of [
	['asset download', '**/office/runtime/soffice.wasm-*.chunk'],
	['runtime script', '**/office/runtime/soffice.js'],
	['worker script', '**/office/office-thread.js?*'],
])
	test(`Close during ${phase} cancels startup without reviving it`, async ({ page }) => {
		test.setTimeout(60000);
		await setup(page);
		let release!: () => void, entered!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const reached = new Promise<void>((resolve) => (entered = resolve));
		await page.route(url, async (route) => {
			entered();
			await gate;
			await route.continue().catch(() => {});
		});
		const pending = call(page, 'documents_create', {
			path: '/Documents/Cancelled.odt',
			blocks: [],
		});
		await reached;
		await page.getByRole('button', { name: 'Close Documents', exact: true }).click();
		expect((await pending).structuredContent.ok).toBe(false);
		await expect(page.locator('[data-app-id="documents"]')).toHaveCount(0);
		await expect.poll(() => page.workers().length).toBe(0);
		release();
		await page.unroute(url);
		expect(
			(await call(page, 'files_stat', { path: '/Documents/Cancelled.odt' })).structuredContent.ok,
		).toBe(false);
		const created = await call(page, 'documents_create', {
			path: '/Documents/Recovered.odt',
			blocks: [],
		});
		expect(created.structuredContent.ok, JSON.stringify(created)).toBe(true);
	});

test('readiness handshake works even when the iframe load callback is missed', async ({ page }) => {
	test.setTimeout(60000);
	await page.addInitScript(() => {
		const add = EventTarget.prototype.addEventListener;
		HTMLIFrameElement.prototype.addEventListener = function (
			type: string,
			listener: any,
			options?: any,
		) {
			if (type !== 'load') add.call(this, type, listener, options);
		};
	});
	await setup(page);
	const created = await call(page, 'documents_create', {
		path: '/Documents/Handshake.odt',
		blocks: [],
	});
	expect(created.structuredContent.ok, JSON.stringify(created)).toBe(true);
	expect((await read(page, '/Documents/Handshake.odt')).text).toBe('');
});

test('an asset download that never finishes has a bounded deadline', async ({ page }) => {
	test.setTimeout(30000);
	await page.clock.install();
	await setup(page);
	let release!: () => void, entered!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const reached = new Promise<void>((resolve) => (entered = resolve));
	await page.route('**/office/runtime/manifest.json', async (route) => {
		entered();
		await gate;
		await route.continue().catch(() => {});
	});
	const pending = call(page, 'documents_create', {
		path: '/Documents/No-download.odt',
		blocks: [],
	});
	await reached;
	await page.clock.fastForward(181000);
	expect((await pending).structuredContent.ok).toBe(false);
	await expect(page.getByRole('alert')).toContainText('assets took too long');
	await expect(page.getByRole('button', { name: 'Try Again', exact: true })).toBeEnabled();
	await expect(page.locator('iframe[title="Office document editor"]')).toHaveCount(0);
	release();
});

test('agent cancellation during startup releases the frame and a later request can recover', async ({
	page,
}) => {
	test.setTimeout(60000);
	await setup(page);
	let release!: () => void, entered!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const reached = new Promise<void>((resolve) => (entered = resolve));
	const url = '**/office/runtime/manifest.json';
	await page.route(url, async (route) => {
		entered();
		await gate;
		await route.continue().catch(() => {});
	});
	const pending = page.evaluate(async () => {
		const controller = new AbortController();
		(window as any).__startupAbort = controller;
		try {
			await (window as any).__officeTools.documents_create.execute(
				{ path: '/Documents/Aborted.odt', blocks: [] },
				{ signal: controller.signal },
			);
			return 'unexpected success';
		} catch (error) {
			return (error as Error).name;
		}
	});
	await reached;
	await page.evaluate(() => (window as any).__startupAbort.abort());
	// WebMCP cancellation rejects with the signal reason, unlike ordinary tool errors.
	expect(await pending).toBe('AbortError');
	await expect(page.locator('iframe[title="Office document editor"]')).toHaveCount(0);
	release();
	await page.unroute(url);
	const result = await call(page, 'documents_create', {
		path: '/Documents/After-abort.odt',
		blocks: [],
	});
	expect(result.structuredContent.ok, JSON.stringify(result)).toBe(true);
});
