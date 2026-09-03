import { expect, test } from '@playwright/test';

test('Office validates every service entry point before opening an editor', async ({ page }) => {
	await page.goto('/');
	const result = await page.evaluate(async () => {
		const { officeService, sheetsService } = await import('/src/lib/office/office.ts');
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const invalid = [
			() => officeService.newDocument('/Documents/Invalid.odt', [{ type: 'paragraph' }]),
			() => officeService.edit('/Documents/Missing.odt', 0, { type: 'paragraph', index: -1 }),
			() => officeService.edit('/Documents/Missing.odt', -1, { type: 'append', blocks: [] }),
			() =>
				sheetsService.newWorkbook('/Documents/Invalid.ods', [{ name: 'Bad/name', values: [[1]] }]),
			() => sheetsService.readWorkbook('/Documents/Missing.ods', { range: 'A1:XFD1048576' }),
			() =>
				sheetsService.editWorkbook('/Documents/Missing.ods', 0, {
					type: 'cells',
					range: 'A1:B1',
					values: [[1]],
				}),
			() =>
				sheetsService.chartWorkbook('/Documents/Missing.ods', 0, { range: 'A1', name: 'Chart' }),
		];
		const codes: string[] = [];
		for (const call of invalid) {
			try {
				await call();
				codes.push('ACCEPTED');
			} catch (error) {
				codes.push(error.code);
			}
		}
		return {
			codes,
			documentsRequested: officeService.snapshot().engineRequested,
			sheetsRequested: sheetsService.snapshot().engineRequested,
			filesCreated: await Promise.all([
				workspaceService.exists('/Documents/Invalid.odt'),
				workspaceService.exists('/Documents/Invalid.ods'),
			]),
		};
	});
	expect(result.codes).toEqual(Array(7).fill('INVALID_INPUT'));
	expect(result.filesCreated).toEqual([false, false]);
	expect(result.documentsRequested).toBe(false);
	expect(result.sheetsRequested).toBe(false);
	await expect(page.locator('iframe')).toHaveCount(0);
});

test('Writer reports clipped table cells and bounds all structured text together', async ({
	page,
}) => {
	test.setTimeout(120000);
	await page.goto('/');
	const result = await page.evaluate(async () => {
		const { officeService } = await import('/src/lib/office/office.ts');
		const path = '/Documents/Long cell.odt';
		await officeService.newDocument(path, [{ type: 'table', rows: [['x'.repeat(6000)]] }]);
		const cell = await officeService.read(path);
		const budgetPath = '/Documents/Read budget.odt';
		await officeService.newDocument(budgetPath, [
			...Array.from({ length: 10 }, () => ({ type: 'paragraph', text: 'word '.repeat(1000) })),
			{ type: 'table', rows: Array.from({ length: 2 }, () => Array(6).fill('cell '.repeat(1000))) },
		]);
		const document = await officeService.read(budgetPath);
		return {
			cell: {
				bodyLength: cell.text.length,
				truncated: cell.truncated,
				tableTruncated: cell.tables[0].truncated,
				cellTruncated: cell.tables[0].cells[0].truncated,
				length: cell.tables[0].cells[0].text.length,
			},
			structuredLength:
				document.paragraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0) +
				document.tables
					.flatMap((table) => table.cells)
					.reduce((sum, cell) => sum + cell.text.length, 0) +
				document.images.reduce((sum, image) => sum + image.description.length, 0),
			truncated: document.truncated,
			tableTruncated: document.tables[0].truncated,
		};
	});
	expect(result.cell).toEqual({
		bodyLength: 0,
		truncated: true,
		tableTruncated: true,
		cellTruncated: true,
		length: 5000,
	});
	expect(result.structuredLength).toBe(100000);
	expect(result.truncated).toBe(true);
	expect(result.tableTruncated).toBe(true);
});

test('queued Save As and Export reject a dialog for a document that has changed', async ({
	page,
}) => {
	test.setTimeout(90000);
	await page.goto('/');
	const result = await page.evaluate(async () => {
		const { officeService } = await import('/src/lib/office/office.ts');
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const first = '/Documents/First.odt',
			second = '/Documents/Second.odt';
		await officeService.newDocument(first, [{ type: 'paragraph', text: 'First document' }]);
		await officeService.newDocument(second, [{ type: 'paragraph', text: 'Second document' }]);
		await officeService.open(first);
		let release!: () => void;
		let reached!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const reading = new Promise<void>((resolve) => {
			reached = resolve;
		});
		const read = workspaceService.readBytes.bind(workspaceService);
		workspaceService.readBytes = async (path) => {
			if (path === second) {
				reached();
				await held;
			}
			return read(path);
		};
		const opening = officeService.open(second);
		await reading;
		const save = officeService
			.saveAs('/Documents/Wrong copy.odt', first)
			.catch((error) => error.code);
		const exporting = officeService
			.exportDocument('/Documents/Wrong export.pdf', { expectedSourcePath: first })
			.catch((error) => error.code);
		release();
		await opening;
		const codes = await Promise.all([save, exporting]);
		return {
			codes,
			path: officeService.snapshot().path,
			created: await Promise.all([
				workspaceService.exists('/Documents/Wrong copy.odt'),
				workspaceService.exists('/Documents/Wrong export.pdf'),
			]),
		};
	});
	expect(result).toEqual({
		codes: ['DOCUMENT_CHANGED', 'DOCUMENT_CHANGED'],
		path: '/Documents/Second.odt',
		created: [false, false],
	});
});
