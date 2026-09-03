import { expect, test } from '@playwright/test';

test('keeps the complete tool registry within the application metadata budget', async ({
	page,
}) => {
	await page.addInitScript(() => {
		const metadata: Record<string, unknown>[] = [];
		Object.defineProperty(window, '__toolMetadata', { value: metadata });
		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			value: {
				registerTool(tool: Record<string, unknown>, { signal }: { signal: AbortSignal }) {
					const { execute: _execute, ...entry } = tool;
					metadata.push(entry);
					signal.addEventListener('abort', () => metadata.splice(metadata.indexOf(entry), 1), {
						once: true,
					});
				},
			},
		});
	});
	await page.goto('/');
	await page.waitForFunction(() => Reflect.get(window, '__toolMetadata').length === 70);
	const metadata = await page.evaluate(() => {
		const tools = Reflect.get(window, '__toolMetadata') as Record<string, unknown>[];
		return {
			names: tools.map((tool) => tool.name),
			descriptions: tools.map((tool) => tool.description),
			bytes: new TextEncoder().encode(JSON.stringify(tools)).byteLength,
		};
	});
	expect(new Set(metadata.names).size).toBe(70);
	for (const description of metadata.descriptions) {
		expect(typeof description).toBe('string');
		expect((description as string).trim().length).toBeGreaterThan(0);
	}
	// Local size budget with headroom above the catalog verified through native discovery.
	// This is not a WebMCP specification limit; native discovery remains a separate check.
	expect(metadata.bytes).toBeLessThanOrEqual(61_000);
});
