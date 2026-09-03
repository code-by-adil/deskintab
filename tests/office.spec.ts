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

// The harness only supplies tool registration. All document operations use the
// actual ZetaOffice WASM engine, IndexedDB filesystem, and visible Writer UI.
test('first typing, native undo/redo, and clipboard survive agent reads', async ({
	page,
	context,
}) => {
	test.setTimeout(60_000);
	await setup(page);
	const path = '/Documents/Keyboard.odt';
	await call(page, 'documents_create', {
		path,
		blocks: [{ type: 'paragraph', text: 'Original content' }],
	});
	const canvas = page.frameLocator('iframe[title="Office document editor"]').locator('#qtcanvas');
	await canvas.focus();
	await page.keyboard.press('x');
	await expect.poll(async () => (await read(page, path)).text).toContain('x');
	await page.keyboard.press('ControlOrMeta+z');
	await expect.poll(async () => (await read(page, path)).text).not.toContain('x');
	await page.keyboard.press('ControlOrMeta+y');
	await expect.poll(async () => (await read(page, path)).text).toContain('x');

	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.evaluate(() => navigator.clipboard.writeText('Pasted from clipboard '));
	await page.keyboard.press('ControlOrMeta+v');
	await expect.poll(async () => (await read(page, path)).text).toContain('Pasted from clipboard');
	const original = (await read(page, path)).text;
	await page.keyboard.press('ControlOrMeta+a');
	await expect.poll(async () => (await read(page, path)).selection.text).toBe(original);
	await page.keyboard.press('ControlOrMeta+c');
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toContain('Original content');
	await page.keyboard.press('ArrowRight');
	// Qt/WASM applies navigation asynchronously. Wait for the actual selection
	// change before Enter; otherwise Enter can replace the still-selected text.
	await expect.poll(async () => (await read(page, path)).selection.collapsed).toBe(true);
	await page.keyboard.press('Enter');
	await expect.poll(async () => (await read(page, path)).text).toBe(`${original}\n`);
	await page.keyboard.press('ControlOrMeta+v');
	await expect.poll(async () => (await read(page, path)).text).toBe(`${original}\n${original}`);
});

test('typing immediately before switching or closing is saved', async ({ page }) => {
	test.setTimeout(90_000);
	await setup(page);
	for (const path of ['/Documents/First.odt', '/Documents/Second.docx']) {
		const created = await call(page, 'documents_create', {
			path,
			blocks: [{ type: 'paragraph', text: 'Original paragraph' }],
		});
		expect(created.structuredContent.ok).toBe(true);
	}
	await read(page, '/Documents/First.odt');
	const canvas = page.frameLocator('iframe[title="Office document editor"]').locator('#qtcanvas');
	await canvas.focus();
	await canvas.pressSequentially('Immediate switch edit ');
	// Do not read, sleep, or wait for the parent dirty flag before switching.
	await call(page, 'desktop_reveal', { path: '/Documents/Second.docx' });
	expect((await read(page, '/Documents/First.odt')).text).toContain('Immediate switch edit');
	await canvas.focus();
	await canvas.pressSequentially('Immediate close edit ');
	await page.getByRole('button', { name: 'Close Documents', exact: true }).click();
	await expect(page.locator('[data-app-id="documents"]')).toHaveCount(0);
	expect((await read(page, '/Documents/First.odt')).text).toContain('Immediate close edit');
});

test('closing during a cold agent request cancels startup without reopening', async ({ page }) => {
	await setup(page);
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	await page.route('**/office/runtime/manifest.json', async (route) => {
		await gate;
		await route.continue().catch(() => {});
	});
	const pending = call(page, 'documents_create', { path: '/Documents/Pending.odt', blocks: [] });
	await expect(page.locator('[data-app-id="documents"]')).toBeVisible();
	await page.getByRole('button', { name: 'Close Documents', exact: true }).click();
	try {
		await expect(page.locator('[data-app-id="documents"]')).toHaveCount(0, { timeout: 2500 });
	} finally {
		release();
	}
	expect((await pending).structuredContent.ok).toBe(false);
	expect(
		(await call(page, 'files_stat', { path: '/Documents/Pending.odt' })).structuredContent.ok,
	).toBe(false);
	await expect(page.locator('[data-app-id="documents"]')).toHaveCount(0);
});

test('empty and mislabeled imports preserve the active document', async ({ page }) => {
	test.setTimeout(60_000);
	await setup(page);
	await call(page, 'documents_create', {
		path: '/Documents/Retained.odt',
		blocks: [{ type: 'paragraph', text: 'Keep this document' }],
	});
	const window = page.locator('[data-app-id="documents"]');
	for (const [name, content] of [
		['Empty.odt', ''],
		['Fake.odt', 'Plain text'],
		['Fake.docx', 'Plain text'],
	]) {
		await window.getByRole('button', { name: 'Open…', exact: true }).click();
		await page.getByLabel('Import office document').setInputFiles({
			name,
			mimeType: 'application/octet-stream',
			buffer: Buffer.from(content),
		});
		await expect(window.getByRole('dialog').getByRole('alert')).toContainText(
			'does not contain a valid',
		);
		await window.getByRole('button', { name: 'Cancel', exact: true }).click();
		expect((await read(page, '/Documents/Retained.odt')).text).toContain('Keep this document');
		expect(
			(await call(page, 'files_stat', { path: `/Documents/${name}` })).structuredContent.ok,
		).toBe(false);
	}
});

test('real Writer: agent edits, human edits, formats, terminal, and persistence', async ({
	page,
}) => {
	test.setTimeout(180_000);
	await setup(page);
	expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
	const path = '/Documents/Project report.odt';
	const created = await call(page, 'documents_create', {
		path,
		blocks: [
			{ type: 'paragraph', text: 'Project report', style: 'Title' },
			{ type: 'paragraph', text: 'Current status', style: 'Heading 1' },
			{ type: 'paragraph', text: 'The release is planned for Friday.' },
			{
				type: 'table',
				rows: [
					['Work', 'Status'],
					['Office', 'In progress'],
				],
			},
		],
	});
	expect(created.structuredContent.ok, JSON.stringify(created)).toBe(true);
	expect(created.structuredContent.entry.size).toBeGreaterThan(1000);
	const window = page.locator('[data-app-id="documents"]');
	await expect(window).toBeVisible();
	let doc = await read(page, path);
	expect(doc.paragraphs[0]).toMatchObject({ text: 'Project report', style: 'Title' });
	expect(doc.paragraphs[1].style).toBe('Heading 1');
	const revision = doc.revision;
	const edit = await call(page, 'documents_edit', {
		path,
		expectedRevision: revision,
		operation: {
			type: 'table-cell',
			table: doc.tables[0].name,
			cell: 'B2',
			text: 'Verified',
		},
	});
	expect(edit.structuredContent.ok, JSON.stringify(edit)).toBe(true);
	const stale = await call(page, 'documents_edit', {
		path,
		expectedRevision: revision,
		operation: {
			type: 'replace',
			find: 'Friday',
			replace: 'Monday',
		},
	});
	expect(stale.structuredContent.error.code).toBe('DOCUMENT_CHANGED');
	doc = await read(page, path);
	const invalid = await call(page, 'documents_edit', {
		path,
		expectedRevision: doc.revision,
		operation: {
			type: 'append',
			blocks: [
				{ type: 'paragraph', text: 'Must not be inserted' },
				{ type: 'paragraph', text: 'Invalid', style: 'No such style' },
			],
		},
	});
	expect(invalid.structuredContent.error.code).toBe('UNKNOWN_STYLE');
	expect((await read(page, path)).text).not.toContain('Must not be inserted');

	// Real keyboard events are consumed by Qt/WASM and the modify listener saves.
	const canvas = page.frameLocator('iframe[title="Office document editor"]').locator('#qtcanvas');
	await canvas.focus();
	await canvas.press('Control+Home');
	await canvas.press('End');
	await canvas.pressSequentially(' HUMAN REVIEW COMPLETE', { delay: 25 });
	await canvas.press('Control+s');
	await expect.poll(async () => (await read(page, path)).text).toContain('HUMAN REVIEW COMPLETE');
	await expect(window.locator('.document-title [role="status"]')).toHaveText('Saved');
	await canvas.press('Control+o');
	await expect(window.getByRole('heading', { name: 'Open a document' })).toBeVisible();
	await window.getByRole('button', { name: 'Cancel', exact: true }).click();

	for (const extension of ['pdf', 'docx']) {
		const result = await call(page, 'documents_export', {
			path,
			destination: `/Documents/Project report.${extension}`,
		});
		expect(result.structuredContent.ok, JSON.stringify(result)).toBe(true);
	}
	const signatures = await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		return Promise.all(
			['pdf', 'docx', 'odt'].map(async (extension) => {
				const bytes = await workspaceService.readBytes(`/Documents/Project report.${extension}`);
				return { extension, signature: Array.from(bytes.slice(0, 5)), size: bytes.length };
			}),
		);
	});
	expect(signatures[0].signature).toEqual([37, 80, 68, 70, 45]);
	expect(signatures[1].signature.slice(0, 4)).toEqual([80, 75, 3, 4]);
	expect(signatures[2].signature.slice(0, 4)).toEqual([80, 75, 3, 4]);
	const word = await read(page, '/Documents/Project report.docx');
	expect(word.text).toContain('HUMAN REVIEW COMPLETE');
	expect(word.paragraphs[1].style).toBe('Heading 1');
	expect(word.tables[0].cells).toContainEqual(
		expect.objectContaining({ cell: 'B2', text: 'Verified' }),
	);

	const shell = await call(page, 'terminal_run', {
		command: "docs text '/Documents/Project report.docx' | grep Verified",
	});
	expect(shell.structuredContent.run.stdout).toContain('Verified');
	expect(shell.structuredContent.run.exitCode).toBe(0);
	await call(page, 'desktop_reveal', {
		path: '/Documents/Project report.pdf',
		target: 'documents',
	});
	await expect(window.locator('.pdf-preview canvas[data-rendered="true"]')).toBeVisible();
	await window.getByText('Page text', { exact: true }).click();
	await expect(window.locator('.pdf-preview details')).toContainText('Project report');
	await expect(window.getByRole('link', { name: 'Download PDF' })).toBeVisible();
	await window.getByRole('button', { name: 'Back to document' }).click();

	await page.getByRole('button', { name: 'Minimize Documents', exact: true }).click();
	await expect(window).not.toBeVisible();
	await page.getByRole('button', { name: 'Launch Documents app' }).click();
	await expect(window).toBeVisible();
	await page.getByRole('button', { name: 'Close Documents', exact: true }).click();
	await expect(window).not.toBeVisible();
	expect((await read(page, path)).text).toContain('HUMAN REVIEW COMPLETE');
	await call(page, 'files_move', { source: path, destination: '/Documents/Renamed report.odt' });
	await expect(window.locator('.document-title strong')).toHaveText('Renamed report.odt');
	await page.reload();
	await page.waitForFunction(() => Boolean((window as any).__officeTools.documents_read));
	expect((await read(page, '/Documents/Renamed report.odt')).text).toContain(
		'HUMAN REVIEW COMPLETE',
	);
	await call(page, 'desktop_reveal', { target: 'finder', path: '/Documents/Renamed report.odt' });
	await expect(page.locator('[data-path="/Documents/Renamed report.odt"]')).toBeVisible();
	const activity = await call(page, 'activity_list', { limit: 100 });
	expect(JSON.stringify(activity)).toContain('Document exported');
});

test('office load errors remain recoverable and other apps still work', async ({ page }) => {
	await page.route('**/office/runtime/manifest.json', (route) =>
		route.fulfill({ status: 404, body: 'Missing runtime' }),
	);
	await setup(page);
	const result = await call(page, 'documents_create', { path: '/Documents/Test.odt', blocks: [] });
	expect(result.structuredContent.ok).toBe(false);
	await expect(page.getByText('Documents could not start')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Try Again' })).toBeEnabled();
	const text = await call(page, 'files_write', {
		path: '/Documents/still-working.txt',
		content: 'The workspace is available.',
	});
	expect(text.structuredContent.ok).toBe(true);
	await page.getByRole('button', { name: 'Close Documents', exact: true }).click();
	await expect(page.locator('[data-app-id="documents"]')).not.toBeVisible();
});

test('a newer workspace file cannot overwrite a pending Writer draft', async ({ page }) => {
	test.setTimeout(90_000);
	await setup(page);
	const source = '/Documents/Conflict.odt';
	for (const [path, text] of [
		[source, 'Original report'],
		['/Documents/Replacement.odt', 'A newer workspace version'],
	]) {
		const result = await call(page, 'documents_create', {
			path,
			blocks: [{ type: 'paragraph', text }],
		});
		expect(result.structuredContent.ok).toBe(true);
	}
	await read(page, source);
	const canvas = page.frameLocator('iframe[title="Office document editor"]').locator('#qtcanvas');
	await canvas.focus();
	await canvas.press('Control+End');
	await canvas.pressSequentially(' HUMAN DRAFT');
	await call(page, 'files_copy', {
		source: '/Documents/Replacement.odt',
		destination: source,
		overwrite: true,
	});
	const window = page.locator('[data-app-id="documents"]');
	await expect(window.locator('.error-banner')).toContainText('changed');
	await window.getByRole('button', { name: 'Save As…', exact: true }).click();
	await window.getByLabel('Workspace path').fill('/Documents/Recovered.odt');
	await window.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
	await expect(window.locator('.document-title strong')).toHaveText('Recovered.odt');
	expect((await read(page, source)).text).toContain('A newer workspace version');
	expect((await read(page, '/Documents/Recovered.odt')).text).toContain('HUMAN DRAFT');
});

async function imageFixture(page: Page, mimeType = 'image/png') {
	return page.evaluate(async (type) => {
		const canvas = document.createElement('canvas');
		canvas.width = 320;
		canvas.height = 140;
		const context = canvas.getContext('2d')!;
		context.fillStyle = '#2456b2';
		context.fillRect(0, 0, 320, 140);
		context.fillStyle = 'white';
		context.font = 'bold 22px sans-serif';
		context.fillText('Shared workspace image', 16, 76);
		const blob = await new Promise<Blob>((resolve) => canvas.toBlob(resolve, type));
		return Array.from(new Uint8Array(await blob.arrayBuffer()));
	}, mimeType);
}

test('Terminal preserves every byte when creating and appending binary files', async ({ page }) => {
	await setup(page);
	const bytes = Array.from({ length: 256 }, (_, value) => value);
	const base64 = Buffer.from(bytes).toString('base64');
	const result = await call(page, 'terminal_run', {
		command: `mkdir -p /Pictures; printf '%s' '${base64}' | base64 -d > /Pictures/bytes.bin; cat /Pictures/bytes.bin > /Pictures/copy.bin; cat /Pictures/bytes.bin >> /Pictures/copy.bin`,
	});
	expect(result.structuredContent.run.exitCode, JSON.stringify(result)).toBe(0);
	const stored = await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const { WorkspaceFileSystem } = await import('/src/lib/workspace/just-bash-filesystem.ts');
		return {
			bytes: Array.from(await workspaceService.readBytes('/Pictures/copy.bin')),
			hex: await new WorkspaceFileSystem().readFile('/Pictures/bytes.bin', 'hex'),
		};
	});
	expect(stored.bytes).toEqual([...bytes, ...bytes]);
	expect(stored.hex).toBe(Buffer.from(bytes).toString('hex'));
});

test('images from Files and computer imports stay embedded through undo, reopen, and export', async ({
	page,
}) => {
	test.setTimeout(120_000);
	await setup(page);
	const path = '/Documents/Illustrated.odt';
	await call(page, 'documents_create', {
		path,
		blocks: [{ type: 'paragraph', text: 'Keep this selected text.' }],
	});
	const bytes = await imageFixture(page);
	await page.evaluate(async (bytes) => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		await workspaceService.writeBytes('/Pictures/Chart.png', new Uint8Array(bytes));
	}, bytes);
	const window = page.locator('[data-app-id="documents"]');
	const canvas = page.frameLocator('iframe[title="Office document editor"]').locator('#qtcanvas');
	await canvas.focus();
	await canvas.press('ControlOrMeta+a');
	await expect
		.poll(async () => (await read(page, path)).selection.text)
		.toBe('Keep this selected text.');
	await window.getByRole('button', { name: 'Insert Image…', exact: true }).click();
	await page.getByLabel('Image description (optional)').fill('Blue workspace chart');
	await page.getByLabel('Search workspace images').fill('chart');
	await page.getByRole('dialog').getByRole('button', { name: 'Chart.png /Pictures' }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	let doc = await read(page, path);
	expect(doc.text).toBe('Keep this selected text.');
	expect(doc.imageCount).toBe(1);
	expect(doc.images[0]).toMatchObject({
		description: 'Blue workspace chart',
		widthMm: 84.67,
		heightMm: 37.04,
	});

	await canvas.focus();
	await canvas.press('ControlOrMeta+z');
	await expect.poll(async () => (await read(page, path)).imageCount).toBe(0);
	await canvas.press('ControlOrMeta+y');
	await expect.poll(async () => (await read(page, path)).imageCount).toBe(1);

	const jpeg = Buffer.from(await imageFixture(page, 'image/jpeg'));
	for (let index = 0; index < 2; index++) {
		await window.getByRole('button', { name: 'Insert Image…', exact: true }).click();
		await expect(
			page.getByRole('dialog').getByRole('button', { name: 'Import from Computer…' }),
		).toBeEnabled();
		await page
			.getByLabel('Import image', { exact: true })
			.setInputFiles({ name: 'Photo.jpg', mimeType: 'image/jpeg', buffer: jpeg });
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect.poll(async () => (await read(page, path)).imageCount).toBe(index + 2);
	}
	for (const imagePath of ['/Pictures/Chart.png', '/Pictures/Photo.jpg', '/Pictures/Photo 2.jpg']) {
		expect((await call(page, 'files_stat', { path: imagePath })).structuredContent.ok).toBe(true);
		await call(page, 'files_trash', { path: imagePath });
	}
	await window.getByRole('button', { name: 'Close Documents', exact: true }).click();
	await expect(window).toHaveCount(0);
	doc = await read(page, path);
	expect(doc.imageCount).toBe(3);
	expect(doc.images[0].description).toBe('Blue workspace chart');
	for (const extension of ['docx', 'pdf']) {
		const result = await call(page, 'documents_export', {
			path,
			destination: `/Documents/Illustrated.${extension}`,
		});
		expect(result.structuredContent.ok, JSON.stringify(result)).toBe(true);
	}
	doc = await read(page, '/Documents/Illustrated.docx');
	expect(doc.imageCount).toBe(3);
	expect(doc.images.some((image: any) => image.description === 'Blue workspace chart')).toBe(true);
	await call(page, 'desktop_reveal', { path: '/Documents/Illustrated.pdf', target: 'documents' });
	const pdf = page.getByRole('region', { name: 'PDF preview' }).locator('canvas');
	await expect(pdf).toHaveAttribute('data-rendered', 'true');
	// Inspect rendered output, not just the PDF signature or image metadata.
	const bluePixels = await pdf.evaluate((node: HTMLCanvasElement) => {
		const pixels = node.getContext('2d')!.getImageData(0, 0, node.width, node.height).data;
		let count = 0;
		for (let index = 0; index < pixels.length; index += 4)
			if (pixels[index] < 80 && pixels[index + 1] < 130 && pixels[index + 2] > 150) count++;
		return count;
	});
	expect(bluePixels).toBeGreaterThan(1000);
});

test('image insertion rejects invalid files and stale targets, and agents use the same operation', async ({
	page,
}) => {
	test.setTimeout(90_000);
	await setup(page);
	const path = '/Documents/Image validation.odt';
	await call(page, 'documents_create', { path, blocks: [{ type: 'paragraph', text: 'Original' }] });
	const bytes = await imageFixture(page);
	await page.evaluate(async (bytes) => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		await workspaceService.writeBytes('/Pictures/Valid.png', new Uint8Array(bytes));
		await workspaceService.writeBytes(
			'/Pictures/Broken.png',
			new TextEncoder().encode('not an image'),
		);
	}, bytes);
	const window = page.locator('[data-app-id="documents"]');
	await window.getByRole('button', { name: 'Insert Image…', exact: true }).click();
	await expect(
		page.getByRole('dialog').getByRole('button', { name: 'Import from Computer…' }),
	).toBeEnabled();
	for (const [name, buffer] of [
		['Broken.png', Buffer.from('not an image')],
		['Broken.jpg', Buffer.from([255, 216, 255])],
		['Vector.svg', Buffer.from('<svg/>')],
		['Large.png', Buffer.alloc(10 * 1024 * 1024 + 1)],
	] as const) {
		await page
			.getByLabel('Import image', { exact: true })
			.setInputFiles({ name, mimeType: 'application/octet-stream', buffer });
		await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
		expect((await read(page, path)).imageCount).toBe(0);
		if (name !== 'Broken.png')
			expect(
				(await call(page, 'files_stat', { path: `/Pictures/${name}` })).structuredContent.ok,
			).toBe(false);
	}
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
	await window.getByRole('button', { name: 'Insert Image…', exact: true }).click();
	const before = await read(page, path);
	const inserted = await call(page, 'documents_edit', {
		path,
		expectedRevision: before.revision,
		operation: {
			type: 'insert-image',
			imagePath: '/Pictures/Valid.png',
			description: 'Added by the agent',
		},
	});
	expect(inserted.structuredContent.ok, JSON.stringify(inserted)).toBe(true);
	// The image picker still refers to the revision before the agent edited it.
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Valid.png /Pictures', exact: true })
		.click();
	await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
		'was edited while choosing',
	);
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
	const after = await read(page, path);
	expect(after.text).toBe('Original');
	expect(after.imageCount).toBe(1);
	expect(after.images[0].description).toBe('Added by the agent');
	for (const imagePath of ['/Pictures/Broken.png', '/Pictures/Missing.png']) {
		const result = await call(page, 'documents_edit', {
			path,
			expectedRevision: after.revision,
			operation: { type: 'insert-image', imagePath },
		});
		expect(result.structuredContent.ok).toBe(false);
		expect((await read(page, path)).imageCount).toBe(1);
	}
	await window.getByRole('button', { name: 'Insert Image…', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await call(page, 'documents_create', { path: '/Documents/Another image target.odt', blocks: [] });
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Valid.png /Pictures', exact: true })
		.click();
	await expect(page.getByRole('dialog').getByRole('alert')).toContainText('open document changed');
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
	expect((await read(page, '/Documents/Another image target.odt')).imageCount).toBe(0);
});

// Inspect PDF drawing instructions as well as text: a PDF can preserve Unicode
// while drawing missing-glyph boxes. Disable host-font fallback for this check.
async function pdfFontCoverage(page: Page, path: string) {
	return page.evaluate(async (path) => {
		// @ts-ignore -- served by the Vite test server.
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		// @ts-ignore -- use the installed PDF.js module in the browser.
		const library = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
		library.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
		const task = library.getDocument({
			data: await workspaceService.readBytes(path),
			fontExtraProperties: true,
			useSystemFonts: false,
		});
		try {
			const pdf = await task.promise;
			const first = await pdf.getPage(1);
			const operators = await first.getOperatorList();
			const fonts: Record<string, boolean> = {};
			const glyphs: { font: string; unicode: string; present: boolean }[] = [];
			let font = '';
			for (let index = 0; index < operators.fnArray.length; index++) {
				if (operators.fnArray[index] === library.OPS.setFont) {
					const face = first.commonObjs.get(operators.argsArray[index][0]);
					font = face.name.replace(/^[A-Z]+\+/, '');
					fonts[font] = Boolean(face.data?.length);
				}
				if (operators.fnArray[index] === library.OPS.showText)
					for (const glyph of operators.argsArray[index][0])
						if (typeof glyph === 'object' && glyph && glyph.unicode.trim())
							glyphs.push({ font, unicode: glyph.unicode, present: glyph.isInFont });
			}
			return { fonts, glyphs };
		} finally {
			await task.destroy();
		}
	}, path);
}

test('Bengali shaping and Chinese font fallback survive DOCX, reopen, and PDF export', async ({
	page,
}) => {
	test.setTimeout(90_000);
	await setup(page);
	const path = '/Documents/Languages.odt';
	// Leave the default Latin paragraph fonts intact to exercise native fallback.
	const blocks = [
		{ type: 'paragraph', text: 'বাংলা: বাংলা ভাষায় সুন্দর নথি তৈরি করি।', style: 'Heading 1' },
		{ type: 'paragraph', text: 'যুক্তাক্ষর: শিক্ষা, জ্ঞান, শ্রদ্ধা, ত্রাণ, ক্ষতি, কর্ম, সূর্য।' },
		{ type: 'paragraph', text: 'স্বরচিহ্ন: কি কী কু কূ কৃ কে কৈ কো কৌ।' },
		{ type: 'paragraph', text: '简体中文：文档编辑、保存和导出。', style: 'Heading 1' },
		{ type: 'paragraph', text: '繁體中文：文件編輯、儲存與匯出。' },
		{ type: 'paragraph', text: 'Mixed: বাংলা শিক্ষা / 中文文档 / English café — 2026.' },
	];
	const created = await call(page, 'documents_create', { path, blocks });
	expect(created.structuredContent.ok, JSON.stringify(created)).toBe(true);
	for (const extension of ['pdf', 'docx'])
		expect(
			(
				await call(page, 'documents_export', {
					path,
					destination: `/Documents/Original.${extension}`,
				})
			).structuredContent.ok,
		).toBe(true);
	await page.getByRole('button', { name: 'Close Documents', exact: true }).click();
	await expect(page.locator('[data-app-id="documents"]')).toHaveCount(0);
	for (const reopened of [path, '/Documents/Original.docx']) {
		const doc = await read(page, reopened);
		for (const block of blocks) expect(doc.text).toContain(block.text);
	}
	expect(
		(
			await call(page, 'documents_export', {
				path: '/Documents/Original.docx',
				destination: '/Documents/Roundtrip.pdf',
			})
		).structuredContent.ok,
	).toBe(true);
	for (const pdfPath of ['/Documents/Original.pdf', '/Documents/Roundtrip.pdf']) {
		const coverage = await pdfFontCoverage(page, pdfPath);
		for (const name of ['NotoSerifBengali-Regular', 'NotoSerifBengali-Bold', 'NotoSansSC-Regular'])
			expect(coverage.fonts[name], `${pdfPath}: ${name} must be embedded`).toBe(true);
		expect(coverage.glyphs.filter((glyph) => !glyph.present)).toEqual([]);
		for (const cluster of ['ক্ষ', 'জ্ঞা', 'শ্র'])
			expect(
				coverage.glyphs.some(
					(glyph) => glyph.font.includes('Bengali') && glyph.unicode === cluster,
				),
				`${pdfPath}: ${cluster} must be a shaped glyph cluster`,
			).toBe(true);
		for (const character of '简体中文档编辑繁體編輯儲與匯')
			expect(
				coverage.glyphs.some(
					(glyph) => glyph.font === 'NotoSansSC-Regular' && glyph.unicode === character,
				),
			).toBe(true);
		await call(page, 'desktop_reveal', { path: pdfPath, target: 'documents' });
		await expect(
			page.getByRole('region', { name: 'PDF preview' }).locator('canvas'),
		).toHaveAttribute('data-rendered', 'true');
	}
});

test('a missing font download fails visibly and can be retried', async ({ page }) => {
	test.setTimeout(60_000);
	const fontRoute = '**/office/runtime/NotoSerifBengali-Regular.ttf-*.chunk';
	await page.route(fontRoute, (route) => route.fulfill({ status: 503, body: 'Unavailable font' }));
	await setup(page);
	const path = '/Documents/Retry-fonts.odt';
	const result = await call(page, 'documents_create', { path, blocks: [] });
	expect(result.structuredContent.ok).toBe(false);
	await expect(page.getByText('Documents could not start')).toBeVisible();
	expect((await call(page, 'files_stat', { path })).structuredContent.ok).toBe(false);
	await page.unroute(fontRoute);
	await page.getByRole('button', { name: 'Try Again', exact: true }).click();
	const retried = await call(page, 'documents_create', {
		path,
		blocks: [{ type: 'paragraph', text: 'বাংলা 中文' }],
	});
	expect(retried.structuredContent.ok, JSON.stringify(retried)).toBe(true);
	expect((await read(page, path)).text).toContain('বাংলা 中文');
});
