import { expect, test, type Page } from '@playwright/test';

// Real, multi-page PDF fixture; only WebMCP registration is replaced by a test harness.
function pdfBytes(
	pages = [
		'Proposal A: attendance 100. Cost 1200.',
		'Proposal B: attendance 150. Cost 1800.',
		'Recommendation: compare the attendance assumptions.',
	],
) {
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
	];
	for (const [i, text] of pages.entries()) {
		const stream = `BT /F1 14 Tf 50 700 Td (${text.replace(/[\\()]/g, '\\$&')}) Tj ET`;
		objects.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
			`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		);
	}
	let text = '%PDF-1.4\n';
	const offsets: number[] = [];
	for (const [i, body] of objects.entries()) {
		offsets.push(text.length);
		text += `${i + 1} 0 obj\n${body}\nendobj\n`;
	}
	const xref = text.length;
	text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
	return Array.from(new TextEncoder().encode(text));
}
const sourcePath = '/Documents/Proposals.pdf';
async function setup(page: Page) {
	await page.addInitScript(() => {
		const tools: Record<string, any> = {};
		Object.defineProperty(window, '__previewTools', { value: tools });
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
	await page.waitForFunction(() => Boolean((window as any).__previewTools.preview_read));
	await writePdf(page);
}
async function writePdf(page: Page, bytes = pdfBytes(), path = sourcePath) {
	await page.evaluate(
		async ({ bytes, path }) => {
			const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
			await workspaceService.writeBytes(path, new Uint8Array(bytes));
		},
		{ bytes, path },
	);
}
async function call(page: Page, name: string, input: Record<string, unknown> = {}) {
	return page.evaluate(
		async ({ name, input }) =>
			(window as any).__previewTools[name].execute(input, { signal: new AbortController().signal }),
		{ name, input },
	);
}
async function ok(page: Page, name: string, input: Record<string, unknown> = {}) {
	const result = await call(page, name, input);
	expect(result.structuredContent.ok, JSON.stringify(result)).toBe(true);
	return result.structuredContent;
}
const win = (page: Page) => page.locator('[data-app-id="preview"]');

test('Preview returns PDF page pixels and restores the remembered page before app launch', async ({
	page,
}) => {
	await setup(page);
	const result = await call(page, 'preview_read', {
		path: sourcePath,
		page: 2,
		pageCount: 2,
		includeImage: true,
	});
	expect(result.structuredContent.ok).toBe(true);
	expect(result.content.map((part: any) => part.type)).toEqual(['text', 'image']);
	expect(result.content[1].mimeType).toBe('image/png');
	expect(result.structuredContent.source.rendered.page).toBe(2);
	expect(result.structuredContent.source.rendered.width).toBeLessThanOrEqual(1600);
	expect(result.structuredContent.source.rendered.height).toBeLessThanOrEqual(1600);
	expect(result.structuredContent.source.pageTexts.map((p: any) => p.page)).toEqual([2, 3]);
	expect(JSON.stringify(result.structuredContent)).not.toContain('base64');
	await page.reload();
	await page.waitForFunction(() => Boolean((window as any).__previewTools.preview_read));
	const restored = (await ok(page, 'preview_read')).source;
	expect(restored).toMatchObject({
		path: sourcePath,
		page: 2,
		revision: result.structuredContent.source.revision,
	});
	expect(restored.pageTexts[0].text).toContain('Proposal B');
});

test('PDF pages, bounded text/search, human selection, default routing and no Office startup', async ({
	page,
}) => {
	await setup(page);
	const officeRequests: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/office/')) officeRequests.push(r.url());
	});
	await ok(page, 'desktop_reveal', { path: sourcePath });
	await expect(win(page).locator('canvas')).toHaveAttribute('data-rendered', 'true');
	const first = (await ok(page, 'preview_read', { pageCount: 2 })).source;
	expect(first.warning).toBe(null);
	expect(first.pages).toBe(3);
	expect(first.pageTexts.map((p: any) => p.page)).toEqual([1, 2]);
	expect(first.pageTexts[1].text).toContain('Proposal B');
	expect(first.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
	expect(first.citation).toMatchObject({ path: sourcePath, page: 1, revision: first.revision });
	const clipped = (await ok(page, 'preview_read', { maxChars: 8, pageCount: 3 })).source;
	expect(clipped.truncated).toBe(true);
	expect(clipped.pageTexts[0].text.length).toBeLessThanOrEqual(8);
	const found = await ok(page, 'preview_search', { query: 'ATTENDANCE', maxPages: 1 });
	expect(found.matches.map((m: any) => m.page)).toEqual([1]);
	expect(found.nextPage).toBe(2);
	const next = await ok(page, 'preview_search', { query: 'attendance', startPage: found.nextPage });
	expect(next.matches.map((m: any) => m.page)).toEqual([2, 3]);
	expect(next.nextPage).toBe(null);
	await win(page).getByRole('searchbox', { name: 'Find in PDF' }).fill('Proposal B');
	await win(page).getByRole('button', { name: 'Find', exact: true }).click();
	await win(page)
		.getByRole('button', { name: /Page 2 Proposal B/ })
		.click();
	await expect(win(page).getByRole('spinbutton', { name: 'Page number' })).toHaveValue('2');
	await win(page).getByRole('button', { name: 'Text', exact: true }).click();
	await expect(win(page).locator('pre')).toContainText('Proposal B');
	await win(page)
		.locator('pre')
		.evaluate((node) => {
			const range = document.createRange();
			range.selectNodeContents(node);
			document.getSelection()!.removeAllRanges();
			document.getSelection()!.addRange(range);
		});
	await expect
		.poll(async () => (await ok(page, 'preview_read')).source.selection?.text)
		.toContain('Proposal B');
	const selected = (await ok(page, 'preview_read')).source;
	expect(
		JSON.parse((await ok(page, 'files_read', { path: '/System/preview.json' })).content),
	).toEqual({ path: sourcePath, page: 2 });
	expect(selected.selection).toMatchObject({ page: 2, revision: first.revision });
	await win(page).getByRole('button', { name: 'Next page', exact: true }).click();
	expect((await ok(page, 'preview_read')).source.selection).toBe(null);
	expect(officeRequests).toEqual([]);
	await expect(page.locator('iframe[title="Office document editor"]')).toHaveCount(0);
});

test('source revisions, live refresh without focus theft, moves, reload and invalid inputs', async ({
	page,
}) => {
	await setup(page);
	const old = (await ok(page, 'preview_read', { path: sourcePath, page: 3 })).source;
	await ok(page, 'desktop_reveal', { target: 'finder' });
	await writePdf(page, pdfBytes(['Updated proposal.']));
	await expect
		.poll(async () =>
			page.evaluate(async () => {
				const { previewService } = await import('/src/lib/preview/preview.ts');
				return previewService.context();
			}),
		)
		.toMatchObject({ pages: 1, page: 1, isFocused: false });
	const changed = await call(page, 'preview_reveal', {
		path: sourcePath,
		page: 3,
		expectedRevision: old.revision,
	});
	expect(changed.structuredContent.error.code).toBe('SOURCE_CHANGED');
	await expect(win(page).getByRole('alert')).toContainText('changed since it was cited');
	for (const input of [
		{ page: 0 },
		{ page: 2 },
		{ pageCount: 21 },
		{ maxChars: 0 },
		{ path: 'https://example.com/file.pdf' },
	])
		expect((await call(page, 'preview_read', input)).structuredContent.ok).toBe(false);
	expect(
		(await call(page, 'preview_reveal', { path: sourcePath, expectedRevision: 'bad' }))
			.structuredContent.error.code,
	).toBe('INVALID_INPUT');
	await ok(page, 'files_move', { source: sourcePath, destination: '/Documents/Moved.pdf' });
	expect((await ok(page, 'preview_read')).source.path).toBe('/Documents/Moved.pdf');
	await win(page).getByRole('button', { name: 'Close Preview', exact: true }).click();
	await expect(win(page)).toHaveCount(0);
	await page.reload();
	await page.waitForFunction(() => Boolean((window as any).__previewTools.preview_read));
	await ok(page, 'desktop_reveal', { target: 'preview' });
	await expect(win(page).locator('canvas')).toHaveAttribute('data-rendered', 'true');
	expect((await ok(page, 'preview_read')).source.path).toBe('/Documents/Moved.pdf');
	await writePdf(page, [37, 80, 68, 70, 45, 98, 97, 100], '/Documents/Invalid.pdf');
	expect(
		(await call(page, 'preview_read', { path: '/Documents/Invalid.pdf' })).structuredContent.ok,
	).toBe(false);
	expect((await ok(page, 'preview_read')).source.path).toBe('/Documents/Moved.pdf');
});

test('PNG/JPEG metadata, Finder destination, download, import and no-OCR contract', async ({
	page,
}) => {
	await setup(page);
	await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const canvas = document.createElement('canvas');
		canvas.width = 320;
		canvas.height = 180;
		canvas.getContext('2d')!.fillRect(0, 0, 320, 180);
		for (const [ext, mime] of [
			['png', 'image/png'],
			['jpg', 'image/jpeg'],
		]) {
			const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), mime));
			await workspaceService.writeBytes(
				`/Pictures/Image.${ext}`,
				new Uint8Array(await blob.arrayBuffer()),
			);
		}
	});
	await ok(page, 'desktop_reveal', { target: 'finder', path: '/Pictures/Image.png' });
	await page
		.locator('[data-app-id="finder"]')
		.locator('[data-path="/Pictures/Image.png"]')
		.dblclick();
	await expect(win(page).locator('.image-scroll img')).toBeVisible();
	for (const path of ['/Pictures/Image.png', '/Pictures/Image.jpg']) {
		const image = (await ok(page, 'preview_read', { path })).source;
		expect(image).toMatchObject({
			kind: 'image',
			width: 320,
			height: 180,
			page: 1,
			pages: 1,
			pageTexts: [],
			truncated: false,
		});
		expect(image.note).toContain('No OCR');
	}
	expect(
		(await call(page, 'preview_search', { query: 'anything' })).structuredContent.error.code,
	).toBe('TEXT_UNAVAILABLE');
	const download = page.waitForEvent('download');
	await win(page).getByRole('link', { name: 'Download', exact: true }).click();
	expect((await download).suggestedFilename()).toBe('Image.jpg');
	await win(page)
		.getByLabel('Import PDF or image')
		.setInputFiles({
			name: 'Imported.pdf',
			mimeType: 'application/pdf',
			buffer: Buffer.from(pdfBytes(['Imported evidence.'])),
		});
	await expect(win(page).locator('.file-title strong')).toHaveText('Imported.pdf');
	await expect(win(page).locator('canvas')).toHaveAttribute('data-rendered', 'true');
	await win(page)
		.getByLabel('Import PDF or image')
		.setInputFiles({ name: 'Bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
	await expect(win(page).getByRole('alert')).toContainText('contents do not match');
	await expect(win(page).locator('.file-title strong')).toHaveText('Imported.pdf');
	await writePdf(page, pdfBytes(['']), '/Documents/Scan.pdf');
	const scan = (await ok(page, 'preview_read', { path: '/Documents/Scan.pdf' })).source;
	expect(scan.pageTexts[0].text).toBe('');
	expect(scan.note).toContain('OCR');
});

test('a report keeps its editable Writer model while Sources opens and verifies a page', async ({
	page,
}) => {
	test.setTimeout(120000);
	await setup(page);
	const source = (await ok(page, 'preview_read', { path: sourcePath, page: 2 })).source;
	const report = '/Documents/Recommendation.odt';
	await ok(page, 'documents_create', {
		path: report,
		blocks: [
			{ type: 'paragraph', style: 'Title', text: 'Recommendation' },
			{ type: 'paragraph', text: 'Compare attendance before choosing a venue. See [1].' },
		],
	});
	await ok(page, 'files_write', {
		path: `${report}.sources.json`,
		content: JSON.stringify({
			version: 1,
			sources: [
				{
					id: '1',
					label: 'Proposal B attendance',
					...source.citation,
					quote: source.pageTexts[0].text,
				},
			],
		}),
	});
	const docs = page.locator('[data-app-id="documents"]');
	await docs.getByRole('button', { name: 'Sources', exact: true }).click();
	await docs.getByRole('button', { name: /Open source 1:/ }).click();
	await expect(win(page).getByRole('spinbutton', { name: 'Page number' })).toHaveValue('2');
	await expect(docs.locator('iframe[title="Office document editor"]')).toBeVisible();
	expect((await ok(page, 'documents_read', { path: report })).document.text).toContain(
		'Compare attendance',
	);
	await writePdf(page, pdfBytes(['Revised first page.', 'Revised attendance 200.']));
	await page.getByRole('button', { name: 'Launch Documents app', exact: true }).click();
	await docs.getByRole('button', { name: /Open source 1:/ }).click();
	await expect(
		docs.getByRole('complementary', { name: 'Report sources' }).getByRole('alert'),
	).toContainText('changed since it was cited');
	await ok(page, 'files_write', {
		path: `${report}.sources.json`,
		expectedRevision: (await ok(page, 'files_read', { path: `${report}.sources.json` })).revision,
		content: JSON.stringify({
			version: 1,
			sources: [{ id: '1', label: 'External', path: 'https://example.com/source.pdf', page: 1 }],
		}),
	});
	await expect(
		docs.getByRole('complementary', { name: 'Report sources' }).getByRole('alert'),
	).toContainText('workspace PDFs/images');
});

test('a checkpoint failure stays visible to the person and the agent without losing the source', async ({
	page,
}) => {
	await setup(page);
	await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const write = workspaceService.writeText.bind(workspaceService);
		workspaceService.writeText = async (path, ...args) => {
			if (path === '/System/preview.json') throw new Error('Simulated checkpoint storage failure');
			return write(path, ...args);
		};
	});
	const source = (await ok(page, 'preview_read', { path: sourcePath, page: 2 })).source;
	expect(source.pageTexts[0].text).toContain('Proposal B');
	expect(source.warning).toContain('last-viewed page could not be saved');
	await expect(win(page).getByRole('alert')).toContainText(source.warning);
	await expect(win(page).locator('canvas')).toHaveAttribute('data-rendered', 'true');
});

test('closing while the PDF worker loads cancels promptly and reopening still works', async ({
	page,
}) => {
	await setup(page);
	let release!: () => void;
	let reached!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const requested = new Promise<void>((resolve) => {
		reached = resolve;
	});
	await page.route('**/pdf.worker.min.mjs', async (route) => {
		reached();
		await held;
		await route.continue().catch(() => {});
	});
	const opening = call(page, 'desktop_reveal', { path: sourcePath });
	await requested;
	await win(page).getByRole('button', { name: 'Close Preview', exact: true }).click();
	await expect(win(page)).toHaveCount(0);
	try {
		const result = await Promise.race([
			opening,
			new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
		]);
		expect(result).not.toBe(null);
		expect(result!.structuredContent.ok).toBe(false);
	} finally {
		release();
	}
	await page.unroute('**/pdf.worker.min.mjs');
	await ok(page, 'preview_reveal', { path: sourcePath, page: 2 });
	await expect(win(page).locator('canvas')).toHaveAttribute('data-rendered', 'true');
	await win(page).getByRole('button', { name: 'Close Preview', exact: true }).click();
	await expect
		.poll(() => page.workers().filter((worker) => worker.url().includes('pdf.worker')).length)
		.toBe(0);
});

for (const viewport of [
	{ width: 390, height: 844 },
	{ width: 640, height: 360 },
])
	test(`Preview controls and import footer fit ${viewport.width}x${viewport.height}`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		await setup(page);
		await ok(page, 'preview_reveal', { path: sourcePath, page: 2 });
		await expect(win(page).locator('canvas')).toHaveAttribute('data-rendered', 'true');
		await win(page).getByRole('button', { name: 'Next page', exact: true }).click();
		await expect(win(page).getByRole('spinbutton', { name: 'Page number' })).toHaveValue('3');
		await win(page).getByRole('button', { name: 'Open…', exact: true }).click();
		const footer = win(page).getByRole('button', { name: 'Import from Computer…', exact: true });
		await expect(footer).toBeVisible();
		const bounds = await footer.boundingBox();
		expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
		await page.screenshot({ path: `/tmp/os-webmcp-preview-${viewport.width}.png` });
	});
