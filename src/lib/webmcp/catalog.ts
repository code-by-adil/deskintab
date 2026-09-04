// The browser limits the combined discovery payload. Keep every validation
// keyword and the opening description; parameter prose and full usage remain
// available through desktop_describe_tool instead of repeating in discovery.
export function discoverySchema(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(discoverySchema);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => key !== 'description')
			.map(([key, child]) => {
				if (
					['properties', '$defs', 'definitions', 'patternProperties'].includes(key) &&
					child &&
					typeof child === 'object' &&
					!Array.isArray(child)
				)
					return [
						key,
						Object.fromEntries(
							Object.entries(child).map(([name, schema]) => [name, discoverySchema(schema)]),
						),
					];
				if (
					[
						'items',
						'additionalProperties',
						'unevaluatedProperties',
						'oneOf',
						'anyOf',
						'allOf',
						'not',
						'if',
						'then',
						'else',
						'contains',
						'prefixItems',
					].includes(key)
				)
					return [key, discoverySchema(child)];
				return [key, child];
			}),
	);
}
export function discoveryTool(tool: WebMCP.ModelContextTool): WebMCP.ModelContextTool {
	const { title: _title, ...rest } = tool;
	const description = discoveryDescriptions[tool.name] ?? tool.description.split(/(?<=\.)\s+/)[0];
	return {
		...rest,
		description,
		inputSchema: compactSchema(
			discoverySchema(tool.inputSchema),
		) as WebMCP.ModelContextTool['inputSchema'],
	};
}

// Share repeated subschemas within a tool without dropping validation keywords.
// Keep existing references/identifiers untouched: relocating their targets could
// change resolution. Current app schemas are plain, self-contained objects.
export function compactSchema(schema: unknown): unknown {
	const serialized = JSON.stringify(schema);
	if (!serialized || /"\$(?:ref|defs|id|anchor|dynamicRef|dynamicAnchor)"\s*:/.test(serialized))
		return schema;
	const counts = new Map<string, number>();
	function visit(value: unknown) {
		if (!value || typeof value !== 'object') return;
		if (!Array.isArray(value)) {
			const key = JSON.stringify(value);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		mapSchemaChildren(value as Record<string, unknown>, (child) => {
			visit(child);
			return child;
		});
	}
	visit(schema);
	const definitions: Record<string, unknown> = {};
	const references = new Map<string, string>();
	function rewrite(value: unknown, root = false): unknown {
		if (!value || typeof value !== 'object') return value;
		const key = JSON.stringify(value);
		const count = counts.get(key) ?? 0;
		// Only actual schemas, not properties dictionaries or default/enum values.
		const node = value as Record<string, unknown>;
		if (!root && ('type' in node || 'oneOf' in node || 'anyOf' in node) && count > 1) {
			const existing = references.get(key);
			if (existing) return { $ref: existing };
			const name = `s${references.size}`;
			const ref = `#/$defs/${name}`;
			if (
				(count - 1) * key.length >
				count * JSON.stringify({ $ref: ref }).length + name.length + 16
			) {
				references.set(key, ref);
				definitions[name] = value;
				return { $ref: ref };
			}
		}
		return mapSchemaChildren(node, (child) => rewrite(child));
	}
	const result = rewrite(schema, true) as Record<string, unknown>;
	if (!Object.keys(definitions).length) return schema;
	const compact = { ...result, $defs: definitions };
	return JSON.stringify(compact).length < serialized.length ? compact : schema;
}

function mapSchemaChildren(node: Record<string, unknown>, transform: (schema: unknown) => unknown) {
	return Object.fromEntries(
		Object.entries(node).map(([key, value]) => {
			if (
				['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'].includes(
					key,
				) &&
				value &&
				typeof value === 'object' &&
				!Array.isArray(value)
			) {
				return [
					key,
					Object.fromEntries(
						Object.entries(value).map(([name, child]) => [name, transform(child)]),
					),
				];
			}
			if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(key) && Array.isArray(value))
				return [key, value.map(transform)];
			if (
				[
					'items',
					'additionalProperties',
					'unevaluatedProperties',
					'not',
					'if',
					'then',
					'else',
					'contains',
					'propertyNames',
					'unevaluatedItems',
				].includes(key)
			)
				return [key, Array.isArray(value) ? value.map(transform) : transform(value)];
			return [key, value];
		}),
	);
}

const discoveryDescriptions: Record<string, string> = {
	desktop_get_context:
		'Read desktop apps, windows, selections, drafts and project IDs; use desktop_describe_tool for full usage before unfamiliar tools.',
	files_write:
		'Create or replace workspace UTF-8 text; replacement needs its read revision, and createOnly rejects existing files. Saves safe Notepad edits.',
	documents_read:
		'Open/save Writer and read paged text, paragraphs, tables, images and revision; follow nextOffset/nextTextOffset for complete content.',
	documents_edit:
		'Revision-checked Writer text, formatting, paragraphs, table dimensions, images or page layout; saves changes.',
	sheets_edit:
		'Revision-checked cells, formatting, sheets, rows/columns, sorting, filtering and merging; selects and saves Calc.',
	canvas_edit:
		'Create or revision-check edits to Canvas objects, styles, bindings and layer order; preserves unrelated objects and saves with recovery.',
	review_restore:
		'Restore a version as a new copy or replace current contents at a checked token; rejects drafts and conflicts.',
	tasks_create:
		'Create a task in a named list; existing lists require their read revision. Opens Tasks and records a recoverable save.',
	studio_update:
		'Revision-check and save explorer settings; arrays replace and drafts block updates.',
	calculator_calculate:
		'Calculate from the displayed number or explicit value; binary operations require operand. Updates the visible Calculator.',
};
