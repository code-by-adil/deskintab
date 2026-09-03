import { expect, test } from '@playwright/test';

function pdfBytes(label: string) {
	const stream = `BT /F1 14 Tf 50 700 Td (${label}) Tj ET`;
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
	];
	let text = '%PDF-1.4\n';
	const offsets: number[] = [];
	for (const [i, object] of objects.entries()) {
		offsets.push(text.length);
		text += `${i + 1} 0 obj\n${object}\nendobj\n`;
	}
	const xref = text.length;
	text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
	return Array.from(new TextEncoder().encode(text));
}

test('Preview refresh catches a newer source written while the previous version loads', async ({
	page,
}) => {
	await page.goto('/');
	await page.evaluate(
		async ({ initial, second, newest }) => {
			const { previewService } = await import('/src/lib/preview/preview.ts');
			const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
			const path = '/Documents/Changing source.pdf';
			await workspaceService.writeBytes(path, new Uint8Array(initial));
			await previewService.open(path);
			let release!: () => void;
			let reached!: () => void;
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			const captured = new Promise<void>((resolve) => {
				reached = resolve;
			});
			const read = workspaceService.readBytes.bind(workspaceService);
			let hold = true;
			workspaceService.readBytes = async (value) => {
				const bytes = await read(value);
				if (value === path && hold) {
					hold = false;
					reached();
					await held;
				}
				return bytes;
			};
			await workspaceService.writeBytes(path, new Uint8Array(second));
			await captured;
			await workspaceService.writeBytes(path, new Uint8Array(newest));
			release();
		},
		{
			initial: pdfBytes('Initial source'),
			second: pdfBytes('Second source'),
			newest: pdfBytes('Newest source changed length'),
		},
	);
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const { previewService } = await import('/src/lib/preview/preview.ts');
				return previewService.snapshot().text;
			}),
		)
		.toBe('Newest source changed length');
	await expect(page.locator('[data-app-id="preview"] canvas')).toHaveAttribute(
		'data-rendered',
		'true',
	);
});

test('Preview preserves a write received while an unchanged source stat is pending', async ({
	page,
}) => {
	await page.goto('/');
	await page.evaluate(async (bytes) => {
		const { previewService } = await import('/src/lib/preview/preview.ts');
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		await workspaceService.writeBytes('/Documents/Pending stat.pdf', new Uint8Array(bytes));
		await previewService.open('/Documents/Pending stat.pdf');
	}, pdfBytes('Initial source'));
	await page.evaluate(async (bytes) => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const path = '/Documents/Pending stat.pdf';
		let release!: () => void;
		let reached!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const captured = new Promise<void>((resolve) => {
			reached = resolve;
		});
		const stat = workspaceService.stat.bind(workspaceService);
		let hold = true;
		workspaceService.stat = async (value) => {
			const entry = await stat(value);
			if (value === path && hold) {
				hold = false;
				reached();
				await held;
			}
			return entry;
		};
		await workspaceService.writeText('/Notes/Refresh trigger.txt', 'An unrelated change');
		await captured;
		await workspaceService.writeBytes(path, new Uint8Array(bytes));
		release();
	}, pdfBytes('Written while stat was pending'));
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const { previewService } = await import('/src/lib/preview/preview.ts');
				return previewService.snapshot().text;
			}),
		)
		.toBe('Written while stat was pending');
});

test('Preview keeps the validated PDF worker when importing a source', async ({ page }) => {
	let createdWorkers = 0;
	page.on('worker', (worker) => {
		if (worker.url().includes('pdf.worker')) createdWorkers++;
	});
	await page.goto('/');
	const source = await page.evaluate(async (bytes) => {
		const { previewService } = await import('/src/lib/preview/preview.ts');
		await previewService.importFile(
			new File([new Uint8Array(bytes)], 'Imported source.pdf', { type: 'application/pdf' }),
		);
		return previewService.snapshot();
	}, pdfBytes('Imported once'));
	expect(source.path).toBe('/Documents/Imported source.pdf');
	expect(source.text).toBe('Imported once');
	expect(createdWorkers).toBe(1);
	await expect(page.locator('[data-app-id="preview"] canvas')).toHaveAttribute(
		'data-rendered',
		'true',
	);
	await page.getByRole('button', { name: 'Close Preview', exact: true }).click();
	await expect
		.poll(() => page.workers().filter((worker) => worker.url().includes('pdf.worker')).length)
		.toBe(0);
});
