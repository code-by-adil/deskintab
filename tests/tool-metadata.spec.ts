import { expect, test } from '@playwright/test';
import { compactSchema, discoverySchema } from '../src/lib/webmcp/catalog';

test('keeps all tools including production URL metadata within the client descriptor budget', async ({
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
		const origin = 'https://deskintab.dgkhan08.workers.dev';
		const descriptors = tools.map((tool) => ({ ...tool, origin, pageUrl: `${origin}/` }));
		return {
			names: tools.map((tool) => tool.name),
			descriptions: tools.map((tool) => tool.description),
			bytes: new TextEncoder().encode(JSON.stringify(tools)).byteLength,
			descriptorBytes: new TextEncoder().encode(JSON.stringify(descriptors)).byteLength,
		};
	});
	console.log(`Discovered ${metadata.names.length} tools in ${metadata.bytes} bytes.`);
	console.log(`Full production descriptors: ${metadata.descriptorBytes} bytes.`);
	expect(new Set(metadata.names).size).toBe(89);
	for (const description of metadata.descriptions) {
		expect(typeof description).toBe('string');
		expect((description as string).trim().length).toBeGreaterThan(0);
	}
	// The installed Codex browser bridge counts origin and pageUrl for every tool.
	// Its default is client/version-specific, not a WebMCP specification limit.
	// Keep the exact production URL here: localhost metadata is substantially smaller.
	expect(metadata.descriptorBytes).toBeLessThanOrEqual(65_536);
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

function expandSchema(schema: any): any {
	const definitions = schema.$defs ?? {};
	function expand(value: any): any {
		if (Array.isArray(value)) return value.map(expand);
		if (!value || typeof value !== 'object') return value;
		if (typeof value.$ref === 'string') {
			expect(Object.keys(value)).toEqual(['$ref']);
			expect(value.$ref.startsWith('#/$defs/')).toBe(true);
			const definition = definitions[value.$ref.slice('#/$defs/'.length)];
			expect(definition).toBeDefined();
			return expand(definition);
		}
		return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expand(child)]));
	}
	const { $defs: _definitions, ...root } = schema;
	return expand(root);
}

test('compact schemas expand to every original validation rule in the catalog', async ({
	page,
}) => {
	await page.addInitScript(() => {
		const tools: Record<string, any> = {};
		(window as any).__catalogTools = tools;
		Object.defineProperty(document, 'modelContext', {
			value: {
				registerTool: (tool: any) => {
					tools[tool.name] = tool;
				},
			},
		});
	});
	await page.goto('/');
	await page.waitForFunction(() => Boolean((window as any).__catalogTools.desktop_describe_tool));
	const schemas = await page.evaluate(async () => {
		const tools = (window as any).__catalogTools;
		return Promise.all(
			Object.keys(tools)
				.filter((name) => name !== 'desktop_describe_tool')
				.map(async (name) => ({
					name,
					registered: tools[name].inputSchema,
					original: (await tools.desktop_describe_tool.execute({ name })).structuredContent.tool
						.inputSchema,
				})),
		);
	});
	expect(schemas).toHaveLength(88);
	for (const { name, registered, original } of schemas) {
		expect(expandSchema(registered), name).toEqual(discoverySchema(original));
	}
});

test('schema compaction preserves literal data, property names and existing references', () => {
	const repeated = { type: 'string', maxLength: 2048, minLength: 1, pattern: '^/Projects/' };
	const literal = { type: 'string', maxLength: 2048, minLength: 1, pattern: '^/Projects/' };
	const schema = {
		type: 'object',
		properties: { type: repeated, description: repeated, properties: repeated, fourth: repeated },
		required: ['type', 'description'],
		additionalProperties: false,
		default: literal,
		examples: [literal, literal],
		enum: [literal],
	};
	const compact = compactSchema(schema) as any;
	expect(compact.$defs).toBeDefined();
	expect(expandSchema(compact)).toEqual(schema);
	expect(compact.default).toEqual(literal);
	expect(compact.examples).toEqual([literal, literal]);
	expect(compact.enum).toEqual([literal]);
	for (const keyword of ['$id', '$ref', '$defs', '$anchor', '$dynamicRef', '$dynamicAnchor']) {
		const existing = {
			...schema,
			[keyword]: keyword === '$defs' ? { own: repeated } : '#existing',
		};
		expect(compactSchema(existing)).toBe(existing);
	}
	expect(compactSchema({ type: 'object', properties: { name: { type: 'string' } } })).toEqual({
		type: 'object',
		properties: { name: { type: 'string' } },
	});
});
