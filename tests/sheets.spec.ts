import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
	await page.addInitScript(() => {
		const tools: Record<string, any> = {};
		Object.defineProperty(window, '__sheetTools', { value: tools });
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
	await page.waitForFunction(() => Boolean((window as any).__sheetTools.sheets_create));
}
async function call(page: Page, name: string, input: Record<string, unknown>) {
	return page.evaluate(
		async ({ name, input }) =>
			(window as any).__sheetTools[name].execute(input, { signal: new AbortController().signal }),
		{ name, input },
	);
}
async function ok(page: Page, name: string, input: Record<string, unknown>) {
	const result = await call(page, name, input);
	expect(result.structuredContent.ok, JSON.stringify(result)).toBe(true);
	return result.structuredContent;
}
async function read(page: Page, path: string, range = 'A1:C5') {
	return (await ok(page, 'sheets_read', { path, range })).workbook;
}
const workbook = [
	{
		name: 'Budget',
		values: [
			['Item', 'Quantity', 'Total'],
			['Venue', 2, { formula: '=B2*150' }],
			['Food', 30, { formula: '=B3*10' }],
			['Total', null, { formula: '=SUM(C2:C3)' }],
		],
	},
];

test('real Calc: formulas, guarded edits, charts, exports and shared persistence', async ({
	page,
}) => {
	test.setTimeout(180000);
	await setup(page);
	const path = '/Documents/Event budget.ods';
	await ok(page, 'sheets_create', { path, sheets: workbook });
	await expect(page.locator('[data-app-id="sheets"]')).toBeVisible();
	let data = await read(page, path);
	expect(data.sheets).toEqual(['Budget']);
	expect(data.cells[1][2]).toMatchObject({
		type: 'formula',
		value: 300,
		formula: '=B2*150',
		error: 0,
	});
	expect(data.cells[3][2].value).toBe(600);
	const old = data.revision;
	await ok(page, 'sheets_edit', {
		path,
		expectedRevision: old,
		operation: { type: 'cells', sheet: 'Budget', range: 'B3', values: [[50]] },
	});
	expect(
		(
			await call(page, 'sheets_edit', {
				path,
				expectedRevision: old,
				operation: { type: 'cells', range: 'B3', values: [[80]] },
			})
		).structuredContent.error.code,
	).toBe('DOCUMENT_CHANGED');
	data = await read(page, path);
	expect(data.cells[3][2].value).toBe(800);
	await ok(page, 'sheets_edit', {
		path,
		expectedRevision: data.revision,
		operation: {
			type: 'format',
			range: 'A1:C1',
			bold: true,
			background: '#e3f5e8',
			color: '#226b3b',
		},
	});
	data = await read(page, path);
	await ok(page, 'sheets_edit', {
		path,
		expectedRevision: data.revision,
		operation: { type: 'format', range: 'C2:C4', numberFormat: '"$"#,##0.00', autoFit: true },
	});
	data = await read(page, path);
	expect(data.cells[1][2].text).toBe('$300.00');
	await ok(page, 'sheets_chart', {
		path,
		expectedRevision: data.revision,
		sheet: 'Budget',
		range: 'A1:C3',
		name: 'Costs',
		title: 'Event budget',
	});
	data = await read(page, path);
	expect(data.charts).toContainEqual({ name: 'Costs', ranges: ['A1:C3'] });
	const nativeChart = await page.workers()[0].evaluate(async () => {
		// @ts-ignore -- the real ZetaOffice worker exposes Module.
		const z = await Module.zetajs;
		const model = z.uno.com.sun.star.frame.Desktop.create(
			z.getUnoComponentContext(),
		).getCurrentComponent();
		const sheet = model.getSheets().getByName('Budget');
		return {
			vertical: sheet
				.getCharts()
				.getByName('Costs')
				.getEmbeddedObject()
				.getDiagram()
				.getPropertyValue('Vertical'),
			background: sheet.getCellRangeByName('A1').getPropertyValue('CellBackColor'),
		};
	});
	expect(nativeChart).toEqual({ vertical: false, background: 0xe3f5e8 });
	await ok(page, 'sheets_export', { path, destination: '/Documents/Event budget.xlsx' });
	await ok(page, 'sheets_export', { path, destination: '/Documents/Event budget.pdf' });
	await ok(page, 'sheets_export', {
		path,
		destination: '/Pictures/Budget.png',
		sheet: 'Budget',
		chart: 'Costs',
	});
	const signatures = await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		return Promise.all(
			['/Documents/Event budget.xlsx', '/Documents/Event budget.pdf', '/Pictures/Budget.png'].map(
				async (path) => Array.from((await workspaceService.readBytes(path)).slice(0, 8)),
			),
		);
	});
	expect(signatures[0].slice(0, 2)).toEqual([80, 75]);
	expect(signatures[1].slice(0, 5)).toEqual([37, 80, 68, 70, 45]);
	expect(signatures[2]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	await ok(page, 'files_move', { source: path, destination: '/Documents/Moved budget.ods' });
	expect((await ok(page, 'sheets_read', {})).workbook.path).toBe('/Documents/Moved budget.ods');
	await page.reload();
	await page.waitForFunction(() => Boolean((window as any).__sheetTools.sheets_read));
	data = await read(page, '/Documents/Event budget.xlsx');
	expect(data.cells[3][2].value).toBe(800);
	expect(data.charts).toHaveLength(1);
	expect(
		(await call(page, 'files_write', { path: '/Documents/Event budget.xlsx', content: 'bad' }))
			.structuredContent.error.code,
	).toBe('BINARY_DOCUMENT');
});

test('invalid workbook inputs do not mutate files or overwrite destinations', async ({ page }) => {
	test.setTimeout(90000);
	await setup(page);
	for (const sheets of [
		[{ name: 'Bad/name', values: [[1]] }],
		[{ name: 'A', values: [[1], [2, 3]] }],
		[{ name: 'A', values: [[{ formula: '=WEBSERVICE("https://example.com")' }]] }],
	]) {
		expect(
			(await call(page, 'sheets_create', { path: '/Documents/Bad.ods', sheets })).structuredContent
				.ok,
		).toBe(false);
	}
	expect(
		(await call(page, 'files_stat', { path: '/Documents/Bad.ods' })).structuredContent.ok,
	).toBe(false);
	const path = '/Documents/Validation.ods';
	await ok(page, 'sheets_create', { path, sheets: workbook });
	let data = await read(page, path);
	for (const operation of [
		{ type: 'cells', range: 'A1:B2', values: [[1]] },
		{ type: 'cells', range: 'A1:XFD1048576', values: [[1]] },
		{ type: 'format', range: 'A1', background: 'red' },
	]) {
		expect(
			(await call(page, 'sheets_edit', { path, expectedRevision: data.revision, operation }))
				.structuredContent.ok,
		).toBe(false);
	}
	expect((await read(page, path)).cells[0][0].text).toBe('Item');
	expect(
		(await call(page, 'sheets_create', { path, sheets: workbook })).structuredContent.error.code,
	).toBe('PATH_EXISTS');
	expect(
		(await call(page, 'sheets_export', { path, destination: path })).structuredContent.error.code,
	).toBe('PATH_EXISTS');
});

test('human cell edits, native undo, selection and close/reopen share the agent model', async ({
	page,
}) => {
	test.setTimeout(120000);
	await setup(page);
	const path = '/Documents/Human budget.ods';
	await ok(page, 'sheets_create', { path, sheets: workbook });
	let data = await read(page, path);
	await ok(page, 'sheets_edit', {
		path,
		expectedRevision: data.revision,
		operation: { type: 'cells', range: 'B3', values: [[30]] },
	});
	const canvas = page.frameLocator('iframe[title="Spreadsheet editor"]').locator('#qtcanvas');
	await canvas.focus();
	await canvas.pressSequentially('80');
	await page.keyboard.press('Enter');
	await expect.poll(async () => (await read(page, path)).cells[3][2].value).toBe(1100);
	const selection = (await read(page, path)).selection;
	expect(selection.sheet).toBe('Budget');
	expect((await read(page, path, 'A1')).selection).toEqual(selection);
	await page.keyboard.press('ControlOrMeta+z');
	await expect.poll(async () => (await read(page, path)).cells[3][2].value).toBe(600);
	await page.keyboard.press('ControlOrMeta+y');
	await expect.poll(async () => (await read(page, path)).cells[3][2].value).toBe(1100);
	await page.getByRole('button', { name: 'Minimize Sheets', exact: true }).click();
	await expect(page.locator('[data-app-id="sheets"]')).toBeHidden();
	await page.getByRole('button', { name: 'Launch Sheets app', exact: true }).click();
	await expect(page.locator('[data-app-id="sheets"]')).toBeVisible();
	data = await read(page, path);
	await ok(page, 'sheets_edit', {
		path,
		expectedRevision: data.revision,
		operation: { type: 'cells', range: 'B3', values: [[80]] },
	});
	await canvas.focus();
	await canvas.pressSequentially('90');
	await page.keyboard.press('Enter');
	// No read or artificial idle period before close: closing must flush native input.
	await page.getByRole('button', { name: 'Close Sheets', exact: true }).click();
	await expect(page.locator('[data-app-id="sheets"]')).toHaveCount(0);
	expect((await read(page, path)).cells[3][2].value).toBe(1200);
});

test('human chart creation, multi-sheet formulas and chart-to-Documents handoff', async ({
	page,
}) => {
	test.setTimeout(180000);
	await setup(page);
	const path = '/Documents/Handoff.ods';
	await ok(page, 'sheets_create', {
		path,
		sheets: [
			...workbook,
			{ name: 'Summary', values: [['Budget total', { formula: '=Budget.C4' }]] },
		],
	});
	expect(
		(await ok(page, 'sheets_read', { path, sheet: 'Summary', range: 'A1:B1' })).workbook.cells[0][1]
			.value,
	).toBe(600);
	const window = page.locator('[data-app-id="sheets"]');
	await window.getByRole('button', { name: 'Chart…', exact: true }).click();
	await window.getByLabel('Data range').fill('A1:C3');
	await window.getByLabel('Chart name').fill('Costs');
	await window.getByLabel('Title (optional)').fill('Event costs');
	await window.getByRole('button', { name: 'Create Chart', exact: true }).click();
	await expect(window.getByRole('dialog')).toHaveCount(0);
	await ok(page, 'sheets_export', {
		path,
		destination: '/Pictures/Before.png',
		sheet: 'Budget',
		chart: 'Costs',
	});
	let data = await read(page, path);
	await ok(page, 'sheets_edit', {
		path,
		expectedRevision: data.revision,
		operation: { type: 'cells', range: 'B3', values: [[60]] },
	});
	await ok(page, 'sheets_export', {
		path,
		destination: '/Pictures/After.png',
		sheet: 'Budget',
		chart: 'Costs',
	});
	const changed = await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const before = await workspaceService.readBytes('/Pictures/Before.png');
		const after = await workspaceService.readBytes('/Pictures/After.png');
		return before.length !== after.length || before.some((byte, i) => byte !== after[i]);
	});
	expect(changed).toBe(true);
	expect(
		(await ok(page, 'sheets_read', { path, sheet: 'Summary', range: 'B1' })).workbook.cells[0][0]
			.value,
	).toBe(900);
	const report = '/Documents/Budget report.odt';
	await ok(page, 'documents_create', {
		path: report,
		blocks: [{ type: 'paragraph', text: 'Event budget', style: 'Title' }],
	});
	const doc = (await ok(page, 'documents_read', { path: report })).document;
	await ok(page, 'documents_edit', {
		path: report,
		expectedRevision: doc.revision,
		operation: {
			type: 'insert-image',
			imagePath: '/Pictures/After.png',
			description: 'Live budget chart snapshot',
		},
	});
	expect((await ok(page, 'documents_read', { path: report })).document.imageCount).toBe(1);
	// Independent editor lifecycles must not replace either app's model.
	expect((await read(page, path)).cells[3][2].value).toBe(900);
	await page.getByRole('button', { name: 'Close Sheets', exact: true }).click();
	expect((await ok(page, 'documents_read', { path: report })).document.imageCount).toBe(1);
	await ok(page, 'documents_export', { path: report, destination: '/Documents/Budget report.pdf' });
	await ok(page, 'desktop_reveal', { path: '/Documents/Budget report.pdf', target: 'documents' });
	await expect(page.locator('.pdf-preview canvas[data-rendered="true"]')).toBeVisible();
});

test('imports and compact dialogs remain usable without replacing existing workbooks', async ({
	page,
}) => {
	test.setTimeout(120000);
	await setup(page);
	const path = '/Documents/Compact.ods';
	await ok(page, 'sheets_create', {
		path,
		sheets: [{ name: 'Types', values: [['=1+2', 2, null, { formula: '=1/0' }]] }],
	});
	const types = (await read(page, path, 'A1:D1')).cells[0];
	expect(types[0]).toMatchObject({ type: 'text', text: '=1+2', formula: null });
	expect(types[2].type).toBe('empty');
	expect(types[3].error).not.toBe(0);
	const bytes = await page.evaluate(async (path) => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		return Array.from(await workspaceService.readBytes(path));
	}, path);
	const window = page.locator('[data-app-id="sheets"]');
	await window.getByRole('button', { name: 'Open…', exact: true }).click();
	await page.getByLabel('Import spreadsheet', { exact: true }).setInputFiles({
		name: 'Imported.ods',
		mimeType: 'application/vnd.oasis.opendocument.spreadsheet',
		buffer: Buffer.from(bytes),
	});
	await expect(window.getByRole('dialog')).toHaveCount(0);
	expect((await ok(page, 'sheets_read', { range: 'A1' })).workbook.path).toBe(
		'/Documents/Imported.ods',
	);
	await window.getByRole('button', { name: 'Open…', exact: true }).click();
	await page.getByLabel('Import spreadsheet', { exact: true }).setInputFiles({
		name: 'Invalid.xlsx',
		mimeType: 'application/octet-stream',
		buffer: Buffer.from('not a workbook'),
	});
	await expect(window.getByRole('dialog').getByRole('alert')).toContainText(
		'does not contain a valid',
	);
	await window.getByRole('button', { name: 'Cancel', exact: true }).click();
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 640, height: 360 },
	]) {
		await page.setViewportSize(viewport);
		await expect(
			window.getByRole('button', { name: 'Close Sheets', exact: true }),
		).toBeInViewport();
		for (const name of ['Open…', 'Save As…', 'Export…', 'Chart…']) {
			await window.getByRole('button', { name, exact: true }).click();
			const dialog = window.getByRole('dialog');
			await expect(dialog).toBeVisible();
			const box = await dialog.boundingBox();
			expect(box!.x).toBeGreaterThanOrEqual(0);
			expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
			expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
			await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
			await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		}
	}
	await page.screenshot({ path: '/tmp/webmcp-sheets-compact.png' });
});
