import { test, expect, type Page } from '@playwright/test';
async function setup(page: Page) {
	await page.addInitScript(() => {
		const tools: Record<string, any> = {};
		(window as any).__coverageTools = tools;
		Object.defineProperty(document, 'modelContext', {
			value: {
				registerTool(t: any) {
					tools[t.name] = t;
				},
			},
		});
	});
	await page.goto('/');
	await page.waitForFunction(() => Boolean((window as any).__coverageTools.documents_read));
}
async function call(page: Page, name: string, input: Record<string, unknown>) {
	const r = await page.evaluate(
		async ({ name, input }) =>
			(window as any).__coverageTools[name].execute(input, {
				signal: new AbortController().signal,
			}),
		{ name, input },
	);
	expect(r.structuredContent.ok, JSON.stringify(r)).toBe(true);
	return r.structuredContent;
}
test('Writer reads all content and applies structural edits with real UNO', async ({ page }) => {
	test.setTimeout(180000);
	await setup(page);
	const path = '/Documents/Coverage.odt';
	await call(page, 'documents_create', {
		path,
		blocks: [
			{ type: 'paragraph', text: 'a'.repeat(40000) },
			{ type: 'paragraph', text: 'b'.repeat(40000) },
			{ type: 'paragraph', text: 'c'.repeat(30000) + 'END_MARKER' },
			{
				type: 'table',
				rows: [
					['Name', 'Value'],
					['A', '1'],
				],
			},
		],
	});
	const overview = (await call(page, 'documents_read', { path })).document;
	expect(overview.truncated).toBe(true);
	const first = (await call(page, 'documents_read', { path, scope: 'text', maxChars: 50000 }))
		.document;
	const second = (
		await call(page, 'documents_read', {
			path,
			scope: 'text',
			offset: first.page.nextOffset,
			expectedRevision: first.revision,
		})
	).document;
	expect(second.text).toContain('END_MARKER');
	expect(second.page.nextOffset).toBeNull();
	const paragraph = (
		await call(page, 'documents_read', {
			path,
			scope: 'paragraphs',
			offset: 2,
			limit: 1,
			textOffset: 30000,
			maxChars: 20,
		})
	).document;
	expect(paragraph.paragraphs[0].text).toBe('END_MARKER');
	const small = '/Documents/Structure.odt';
	await call(page, 'documents_create', {
		path: small,
		blocks: [
			{ type: 'paragraph', text: 'Alpha Beta' },
			{ type: 'paragraph', text: 'Second' },
			{ type: 'paragraph', text: 'Third' },
			{
				type: 'table',
				rows: [
					['Name', 'Value'],
					['A', '1'],
				],
			},
		],
	});
	const edit = async (operation: Record<string, unknown>) => {
		const read = (await call(page, 'documents_read', { path: small })).document;
		return call(page, 'documents_edit', {
			path: small,
			expectedRevision: read.revision,
			operation,
		});
	};
	await edit({
		type: 'text-range',
		index: 0,
		start: 0,
		end: 5,
		bold: true,
		italic: true,
		underline: true,
		fontSize: 18,
		color: '#123456',
		link: 'https://example.com',
	});
	const formatted = (
		await call(page, 'documents_read', {
			path: small,
			scope: 'paragraphs',
			offset: 0,
			limit: 1,
			includeFormatting: true,
		})
	).document;
	expect(formatted.paragraphs[0].runs[0]).toMatchObject({
		bold: true,
		italic: true,
		underline: true,
		fontSize: 18,
		link: 'https://example.com',
	});
	await call(page, 'documents_select', {
		path: small,
		expectedRevision: formatted.revision,
		index: 0,
		start: 0,
		end: 5,
	});
	expect((await call(page, 'documents_read', { path: small })).document.selection.text).toBe(
		'Alpha',
	);
	await edit({ type: 'text-range', index: 0, start: 6, end: 10, text: 'Gamma' });
	await edit({ type: 'insert-paragraph', index: 1, text: 'Inserted' });
	let read = (await call(page, 'documents_read', { path: small })).document;
	expect(read.paragraphs.map((p: any) => p.text)).toContain('Inserted');
	expect(read.text).toContain('Alpha Gamma');
	await edit({ type: 'move-paragraph', index: 1, delta: 1 });
	read = (await call(page, 'documents_read', { path: small })).document;
	expect(read.paragraphs[2].text).toBe('Inserted');
	await edit({ type: 'move-paragraph', index: 0, delta: 1 });
	const moved = (
		await call(page, 'documents_read', {
			path: small,
			scope: 'paragraphs',
			offset: 1,
			limit: 1,
			includeFormatting: true,
		})
	).document;
	expect(moved.paragraphs[0].runs[0]).toMatchObject({ bold: true, link: 'https://example.com' });
	await edit({ type: 'move-paragraph', index: 1, delta: -1 });
	const table = read.tables[0].name;
	await edit({
		type: 'table-structure',
		table,
		axis: 'rows',
		action: 'insert',
		index: 1,
		count: 1,
	});
	await edit({
		type: 'table-structure',
		table,
		axis: 'columns',
		action: 'insert',
		index: 1,
		count: 1,
	});
	read = (await call(page, 'documents_read', { path: small, scope: 'table', table, limit: 500 }))
		.document;
	expect(read.tables[0].cells.length).toBe(9);
	await edit({
		type: 'table-structure',
		table,
		axis: 'rows',
		action: 'remove',
		index: 1,
		count: 1,
	});
	await edit({ type: 'page-layout', widthMm: 297, heightMm: 210, marginMm: 15 });
	await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const canvas = document.createElement('canvas');
		canvas.width = 100;
		canvas.height = 50;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = 'red';
		ctx.fillRect(0, 0, 100, 50);
		const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!)));
		await workspaceService.writeBytes(
			'/Pictures/Coverage.png',
			new Uint8Array(await blob.arrayBuffer()),
		);
	});
	await edit({ type: 'insert-image', imagePath: '/Pictures/Coverage.png', position: 'end' });
	const image = (await call(page, 'documents_read', { path: small })).document.images[0];
	await edit({ type: 'image', name: image.name, action: 'resize', widthMm: 40, heightMm: 20 });
	const resized = (await call(page, 'documents_read', { path: small })).document.images[0];
	expect(resized.widthMm).toBeCloseTo(40, 1);
	expect(resized.heightMm).toBeCloseTo(20, 1);
	await edit({ type: 'image', name: image.name, action: 'remove' });
	expect((await call(page, 'documents_read', { path: small })).document.imageCount).toBe(0);
	const stale = await page.evaluate(
		async ({ path, revision }) =>
			(window as any).__coverageTools.documents_edit.execute(
				{
					path,
					expectedRevision: revision,
					operation: { type: 'paragraph', index: 0, text: 'Stale' },
				},
				{ signal: new AbortController().signal },
			),
		{ path: small, revision: formatted.revision },
	);
	expect(stale.structuredContent.error.code).toBe('DOCUMENT_CHANGED');
	await page.reload();
	await page.waitForFunction(() => Boolean((window as any).__coverageTools.documents_read));
	read = (await call(page, 'documents_read', { path: small })).document;
	expect(read.text).toContain('Alpha Gamma');
	expect(read.tables[0].cells).toHaveLength(6);
});
test('Calc controls workbook structure sorting filtering formatting and chart lifecycle', async ({
	page,
}) => {
	test.setTimeout(180000);
	await setup(page);
	const path = '/Documents/Coverage.ods';
	await call(page, 'sheets_create', {
		path,
		sheets: [
			{
				name: 'Data',
				values: [
					['Name', 'Value'],
					['B', 2],
					['A', 1],
				],
			},
		],
	});
	const read = async (sheet = 'Data', range = 'A1:B3') =>
		(await call(page, 'sheets_read', { path, sheet, range })).workbook;
	const edit = async (operation: Record<string, unknown>) =>
		call(page, 'sheets_edit', {
			path,
			expectedRevision: (await read()).revision,
			operation: { sheet: 'Data', ...operation },
		});
	await edit({ type: 'sheet', action: 'add', name: 'Extra', index: 1 });
	await edit({ type: 'sheet', sheet: 'Extra', action: 'rename', name: 'Renamed' });
	await edit({ type: 'sheet', sheet: 'Renamed', action: 'move', index: 0 });
	expect((await read()).sheets).toEqual(['Renamed', 'Data']);
	await edit({ type: 'sheet', sheet: 'Renamed', action: 'remove' });
	await edit({ type: 'structure', axis: 'rows', action: 'insert', index: 1, count: 1 });
	expect((await read('Data', 'A1:B4')).cells[2][0].text).toBe('B');
	await edit({ type: 'structure', axis: 'rows', action: 'remove', index: 1, count: 1 });
	await edit({ type: 'structure', axis: 'columns', action: 'insert', index: 1, count: 1 });
	expect((await read('Data', 'A1:C3')).cells[1][2].value).toBe(2);
	await edit({ type: 'structure', axis: 'columns', action: 'remove', index: 1, count: 1 });
	await edit({ type: 'sort', range: 'A1:B3', column: 1, ascending: true, header: true });
	expect((await read()).cells[1][0].text).toBe('A');
	await edit({ type: 'filter', range: 'A1:B3', column: 0, value: 'A' });
	expect((await read()).cells[2][0].visible).toBe(false);
	await edit({ type: 'filter', range: 'A1:B3', value: null });
	await edit({
		type: 'format',
		range: 'A1:B3',
		italic: true,
		underline: true,
		fontSize: 14,
		fontName: 'Liberation Sans',
		wrap: true,
		align: 'center',
		columnWidthMm: 35,
		rowHeightMm: 12,
	});
	const formatting = (
		await call(page, 'sheets_read', { path, sheet: 'Data', range: 'A1', includeFormatting: true })
	).workbook;
	expect(formatting.cells[0][0].format).toMatchObject({ italic: true, fontSize: 14, wrap: true });
	await call(page, 'sheets_select', {
		path,
		sheet: 'Data',
		range: 'B2:B3',
		expectedRevision: formatting.revision,
	});
	expect((await read()).selection.range).toBe('B2:B3');
	await edit({ type: 'merge', range: 'D1:E1' });
	await edit({ type: 'merge', range: 'D1:E1', merge: false });
	const chart = async (input: Record<string, unknown>) =>
		call(page, 'sheets_chart', {
			path,
			sheet: 'Data',
			expectedRevision: (await read()).revision,
			name: 'MyChart',
			...input,
		});
	await chart({ range: 'A1:B3', kind: 'line' });
	await chart({ action: 'update', kind: 'pie', title: 'Updated' });
	expect((await read()).charts).toHaveLength(1);
	await chart({ action: 'remove' });
	expect((await read()).charts).toHaveLength(0);
	await page.reload();
	await page.waitForFunction(() => Boolean((window as any).__coverageTools.sheets_read));
	expect((await read()).cells[1][0].text).toBe('A');
});

test('paragraph moves preserve boundaries at the end of the document', async ({ page }) => {
	test.setTimeout(90000);
	await setup(page);
	const path = '/Documents/Move-boundaries.odt';
	await call(page, 'documents_create', {
		path,
		blocks: ['First', 'Middle', 'Last'].map((text) => ({ type: 'paragraph', text })),
	});
	const move = async (index: number, delta: number) => {
		const read = (await call(page, 'documents_read', { path })).document;
		await call(page, 'documents_edit', {
			path,
			expectedRevision: read.revision,
			operation: { type: 'move-paragraph', index, delta },
		});
		return (await call(page, 'documents_read', { path })).document.paragraphs.map(
			(p: any) => p.text,
		);
	};
	expect(await move(2, -2)).toEqual(['Last', 'First', 'Middle']);
	expect(await move(0, 2)).toEqual(['First', 'Middle', 'Last']);
});
