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
	await page.waitForFunction(() => Reflect.get(window, '__toolMetadata').length === 89);
	const metadata = await page.evaluate(() => {
		const tools = Reflect.get(window, '__toolMetadata') as Record<string, unknown>[];
		return {
			names: tools.map((tool) => tool.name),
			descriptions: tools.map((tool) => tool.description),
			bytes: new TextEncoder().encode(JSON.stringify(tools)).byteLength,
		};
	});
	console.log(`Discovered ${metadata.names.length} tools in ${metadata.bytes} bytes.`);
	expect(new Set(metadata.names).size).toBe(89);
	for (const description of metadata.descriptions) {
		expect(typeof description).toBe('string');
		expect((description as string).trim().length).toBeGreaterThan(0);
	}
	// Local size budget with headroom above the catalog verified through native discovery.
	// This is not a WebMCP specification limit; native discovery remains a separate check.
	expect(metadata.bytes).toBeLessThanOrEqual(57_500);
});

test('tool details retain parameter prose and discovery retains named description fields', async ({
	page,
}) => {
	await page.addInitScript(() => {
		const tools: Record<string, any> = {};
		(window as any).__catalogTools = tools;
		Object.defineProperty(document, 'modelContext', {
			value: {
				registerTool(tool: any) {
					tools[tool.name] = tool;
				},
			},
		});
	});
	await page.goto('/');
	await page.waitForFunction(() => Boolean((window as any).__catalogTools.desktop_describe_tool));
	const result = await page.evaluate(async () => {
		const tools = (window as any).__catalogTools;
		const described = await tools.desktop_describe_tool.execute({ name: 'documents_read' });
		const source = await tools.desktop_describe_tool.execute({ name: 'studio_create' });
		const missing = await tools.desktop_describe_tool.execute({ name: 'missing' });
		return {
			described: described.structuredContent,
			source: source.structuredContent,
			missing: missing.structuredContent,
			registered: tools.studio_create.inputSchema,
		};
	});
	expect(result.described.tool.inputSchema.properties.includeFormatting.description).toContain(
		'limit 1',
	);
	expect(result.described.tool.description).toContain('nextOffset');
	expect(result.registered.properties.description).toEqual({ type: 'string', maxLength: 2000 });
	expect(result.registered.required).toContain('description');
	expect(result.source.tool.inputSchema.properties.dataPath.description).toContain('1000');
	expect(result.missing.error.code).toBe('TOOL_MISSING');
});
