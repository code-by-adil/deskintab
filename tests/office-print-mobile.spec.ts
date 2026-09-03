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

// Read the real UNO command status used by the native menus/toolbars. No mock
// dispatches or test-only application APIs are involved.
async function printCommandStates(page: Page) {
	const worker = page.workers()[0];
	return worker.evaluate(async () => {
		// @ts-ignore -- the actual Emscripten worker exposes Module.
		const z = await Module.zetajs;
		const css = z.uno.com.sun.star;
		const frame = css.frame.Desktop.create(z.getUnoComponentContext())
			.getCurrentComponent()
			.getCurrentController()
			.getFrame();
		return [
			'Print',
			'PrintDefault',
			'PrinterSetup',
			'PrintPreview',
			'PrintPagePreview',
			'MailMergePrintDocuments',
			'ExportToPDF',
			'Save',
		].map((name) => {
			const url = new css.util.URL({ Complete: '.uno:' + name });
			const dispatch = frame.queryDispatch(url, '', 0);
			let enabled: boolean | null = null;
			const listener = z.unoObject([css.frame.XStatusListener], {
				statusChanged(event: { IsEnabled: boolean }) {
					enabled = event.IsEnabled;
				},
				disposing() {},
			});
			dispatch?.addStatusListener(listener, url);
			dispatch?.removeStatusListener(listener, url);
			return { name, enabled };
		});
	});
}

test('native printing is disabled, while print shortcuts lead to a real PDF download', async ({
	page,
}) => {
	test.setTimeout(60000);
	await setup(page);
	const path = '/Documents/Printing.odt';
	expect(
		(
			await call(page, 'documents_create', {
				path,
				blocks: [{ type: 'paragraph', text: 'Print this document using its PDF download.' }],
			})
		).structuredContent.ok,
	).toBe(true);
	const expected = [
		'Print',
		'PrintDefault',
		'PrinterSetup',
		'PrintPreview',
		'PrintPagePreview',
		'MailMergePrintDocuments',
	].map((name) => ({ name, enabled: false }));
	expected.push({ name: 'ExportToPDF', enabled: true }, { name: 'Save', enabled: true });
	expect(await printCommandStates(page)).toEqual(expected);
	const canvas = page.frameLocator('iframe[title="Office document editor"]').locator('#qtcanvas');
	for (const modifier of ['Control', 'Meta']) {
		await canvas.press(`${modifier}+p`);
		await expect(page.locator('.download-hint')).toBeVisible();
		await expect(page.getByRole('button', { name: 'PDF (.pdf)', exact: true })).toBeFocused();
		await page.locator('.downloads summary').click();
	}
	// Check the outer app path as well as key events inside Writer's iframe.
	await page.getByRole('button', { name: 'New', exact: true }).focus();
	await page.keyboard.press('Control+p');
	await expect(page.locator('.download-hint')).toBeVisible();
	const downloadEvent = page.waitForEvent('download');
	await page.getByRole('button', { name: 'PDF (.pdf)', exact: true }).click();
	const download = await downloadEvent;
	expect(download.suggestedFilename()).toBe('Printing.pdf');
	const stream = await download.createReadStream();
	const chunks: Buffer[] = [];
	for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
	expect(Buffer.concat(chunks).subarray(0, 5).toString()).toBe('%PDF-');
	expect((await read(page, path)).text).toContain('Print this document');
	await page.getByRole('button', { name: 'Close Documents', exact: true }).click();
	await read(page, path);
	expect(await printCommandStates(page)).toEqual(expected);
});

test('compact Documents keeps dialogs, cancellation, PDF viewing and downloads usable', async ({
	page,
}) => {
	test.setTimeout(90000);
	await setup(page);
	const path = '/Documents/Compact.odt';
	expect(
		(
			await call(page, 'documents_create', {
				path,
				blocks: [{ type: 'paragraph', text: 'A document to view and download on a small screen.' }],
			})
		).structuredContent.ok,
	).toBe(true);
	for (let i = 0; i < 10; i++)
		await call(page, 'files_copy', { source: path, destination: `/Documents/Copy-${i}.odt` });
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 320, height: 568 },
		{ width: 640, height: 360 },
		{ width: 390, height: 450 },
	]) {
		await page.setViewportSize(viewport);
		const window = page.locator('[data-app-id="documents"]');
		await expect(
			window.getByRole('button', { name: 'Close Documents', exact: true }),
		).toBeInViewport();
		if (viewport.width <= 390) await expect(page.locator('.desktop-editing-notice')).toBeVisible();
		for (const name of ['Open…', 'Save As…', 'Export…', 'Insert Image…']) {
			await window.getByRole('button', { name, exact: true }).click();
			const dialog = page.getByRole('dialog');
			await expect(dialog).toBeVisible();
			const box = await dialog.boundingBox();
			expect(box!.x).toBeGreaterThanOrEqual(0);
			expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
			expect(box!.y).toBeGreaterThanOrEqual(0);
			expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
			const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
			if (name === 'Insert Image…') {
				const description = dialog.getByLabel('Image description (optional)', { exact: true });
				await description.click();
				await description.fill('A description entered in a compact dialog.');
				await expect(description).toBeInViewport();
				const field = await description.boundingBox();
				const body = await dialog.locator('.sheet-body').boundingBox();
				expect(field!.y).toBeGreaterThanOrEqual(body!.y);
				expect(field!.y + field!.height).toBeLessThanOrEqual(body!.y + body!.height);
			}
			await expect(cancel).toBeInViewport();
			await cancel.click();
			await expect(dialog).toHaveCount(0);
		}
	}
	await page.getByRole('button', { name: 'Save As…', exact: true }).click();
	await page.getByLabel('Workspace path').fill('/Documents/Invalid.txt');
	await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
		'Use an .odt or .docx filename',
	);
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
	await page.getByRole('button', { name: 'Open…', exact: true }).click();
	await page.getByLabel('Search workspace documents').press('Escape');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	expect(
		(await call(page, 'documents_export', { path, destination: '/Documents/Compact.pdf' }))
			.structuredContent.ok,
	).toBe(true);
	await page.getByRole('button', { name: 'Close Documents', exact: true }).click();
	await expect(page.locator('[data-app-id="documents"]')).toHaveCount(0);
	await call(page, 'desktop_reveal', { path: '/Documents/Compact.pdf', target: 'documents' });
	await expect(page.locator('canvas[data-rendered="true"]')).toBeVisible();
	await expect(page.locator('iframe[title="Office document editor"]')).toHaveCount(0);
	await expect(page.locator('.desktop-editing-notice')).toHaveCount(0);
	await page.getByRole('link', { name: 'Download PDF', exact: true }).focus();
	await page.keyboard.press('Control+p');
	await expect(
		page.getByRole('status').filter({ hasText: 'To print, use Download PDF' }),
	).toBeVisible();
	await page.getByRole('button', { name: 'Dismiss printing guidance', exact: true }).click();
	const downloadEvent = page.waitForEvent('download');
	await page.getByRole('link', { name: 'Download PDF', exact: true }).click();
	expect((await downloadEvent).suggestedFilename()).toBe('Compact.pdf');
	await page.getByRole('button', { name: 'Close Documents', exact: true }).click();
	await expect(page.locator('[data-app-id="documents"]')).toHaveCount(0);
});

test('opening a PDF while Close is saving keeps the newer request visible', async ({ page }) => {
	test.setTimeout(60000);
	await setup(page);
	const path = '/Documents/Close-race.odt';
	await call(page, 'documents_create', { path, blocks: [] });
	await call(page, 'documents_export', { path, destination: '/Documents/Close-race.pdf' });
	const frame = page.frames().find((frame) => frame.url().includes('/office/index.html'))!;
	// Hold just the close-time state query; all document processing still runs
	// in the actual engine. This makes the overlapping request deterministic.
	await frame.evaluate(() => {
		const host = window as any;
		const bridge = host.officeBridge;
		const request = bridge.request.bind(bridge);
		const gate = new Promise<void>((resolve) => (host.__releaseClose = resolve));
		let held = false;
		bridge.request = async (command: string, input: unknown) => {
			if (command === 'state' && !held) {
				held = true;
				host.__closeWaiting = true;
				await gate;
			}
			return request(command, input);
		};
	});
	await page.getByRole('button', { name: 'Close Documents', exact: true }).click();
	await frame.waitForFunction(() => (window as any).__closeWaiting);
	await page.evaluate(async () => {
		// @ts-ignore -- Vite serves the shared service; enqueue before releasing Close.
		const { officeService } = await import('/src/lib/office/office.ts');
		const opening = officeService.open('/Documents/Close-race.pdf');
		const iframe = document.querySelector<HTMLIFrameElement>(
			'iframe[title="Office document editor"]',
		)!;
		(iframe.contentWindow as any).__releaseClose();
		await opening;
	});
	await expect(page.locator('[data-app-id="documents"] .document-title strong')).toHaveText(
		'Close-race.pdf',
	);
	await expect(page.locator('canvas[data-rendered="true"]')).toBeVisible();
	await page.getByRole('button', { name: 'Close Documents', exact: true }).click();
	await expect(page.locator('[data-app-id="documents"]')).toHaveCount(0);
});
