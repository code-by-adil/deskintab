import { expect, test, type Page } from '@playwright/test';

const scenePath = '/Documents/Path guards.excalidraw';
const aliases = [
	'/Documents/./Path guards.excalidraw',
	'/Documents//Path guards.excalidraw',
	'/Documents/Nested/../Path guards.excalidraw',
];

async function openCanvas(page: Page) {
	await page.goto('/');
	const revision = await page.evaluate(async (path) => {
		const { canvasService } = await import('/src/lib/canvas/canvas.ts');
		const { openApp } = await import('/src/state/apps.svelte.ts');
		await canvasService.create(path, 'Path guards');
		openApp('canvas');
		return (await canvasService.read(path)).revision;
	}, scenePath);
	await expect(page.locator('[data-app-id="canvas"] canvas.interactive')).toBeVisible();
	return revision;
}

async function beginStroke(page: Page) {
	const app = page.locator('[data-app-id="canvas"]');
	await app
		.locator('label')
		.filter({ has: page.getByRole('radio', { name: 'Draw', exact: true }) })
		.click();
	const box = (await app.locator('canvas.interactive').boundingBox())!;
	const x = box.x + box.width * 0.6,
		y = box.y + box.height * 0.55;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 100, y + 35, { steps: 8 });
}

test('canvas path aliases cannot read or edit through an active human stroke', async ({ page }) => {
	const revision = await openCanvas(page);
	await beginStroke(page);
	try {
		const outcomes = await page.evaluate(
			async ({ aliases, revision }) => {
				const { canvasService } = await import('/src/lib/canvas/canvas.ts');
				const outcomes: string[] = [];
				for (const path of aliases) {
					for (const action of ['read', 'edit']) {
						try {
							if (action === 'read') await canvasService.read(path);
							else
								await canvasService.edit(
									path,
									[{ op: 'add', object: { id: 'agent', type: 'rectangle' } }],
									{ expectedRevision: revision, actor: 'agent' },
								);
							outcomes.push(`${action} ${path}: succeeded`);
						} catch (cause) {
							const code = cause instanceof Error && 'code' in cause ? cause.code : String(cause);
							outcomes.push(`${action} ${path}: ${code}`);
						}
					}
				}
				return outcomes;
			},
			{ aliases, revision },
		);
		expect(outcomes).toEqual(
			aliases.flatMap((path) => [`read ${path}: CANVAS_BUSY`, `edit ${path}: CANVAS_BUSY`]),
		);
	} finally {
		await page.mouse.up();
	}
	const elements = await page.evaluate(async (path) => {
		const { canvasService } = await import('/src/lib/canvas/canvas.ts');
		return (await canvasService.read(path)).data.elements.map((element) => element.type);
	}, scenePath);
	expect(elements).toEqual(['freedraw']);
});

test('an aliased canvas edit saves a completed stroke before rejecting its stale revision', async ({
	page,
}) => {
	const revision = await openCanvas(page);
	await beginStroke(page);
	await page.mouse.up();
	const result = await page.evaluate(
		async ({ path, revision }) => {
			const { canvasService } = await import('/src/lib/canvas/canvas.ts');
			let error: string | null = null;
			try {
				await canvasService.edit(
					path,
					[{ op: 'add', object: { id: 'agent', type: 'rectangle' } }],
					{ expectedRevision: revision, actor: 'agent' },
				);
			} catch (cause) {
				error = cause instanceof Error && 'code' in cause ? String(cause.code) : String(cause);
			}
			const saved = await canvasService.read(path);
			return {
				error,
				path: saved.path,
				revision: saved.revision,
				elements: saved.data.elements.map((element) => element.type),
			};
		},
		{ path: aliases[2], revision },
	);
	expect(result).toMatchObject({ error: 'FILE_CHANGED', path: scenePath, elements: ['freedraw'] });
	expect(result.revision).not.toBe(revision);
});
