import { openApp } from '../../state/apps.svelte';
import { studioService, type StudioInput } from './studio';
import { objectValue } from '../workspace/json-document';
import {
	absolutePath,
	defineTool,
	optionalAbsolutePath,
	requiredString,
	successfulResult,
} from '../webmcp/tool-utils';

const pathSchema = {
	type: 'string',
	maxLength: 2048,
	description: 'Absolute .app.json outside System/Trash.',
};
const key = { type: 'string', minLength: 1, maxLength: 80, pattern: '^[a-zA-Z][a-zA-Z0-9_ -]*$' };
const fields = {
	title: { type: 'string', minLength: 1, maxLength: 160 },
	description: { type: 'string', maxLength: 2000 },
	view: { type: 'string', enum: ['cards', 'table'] },
	dataPath: {
		type: 'string',
		maxLength: 2048,
		description:
			'Existing .json: max1000 flat records, under512KB. files_write creates. Preview gets selected fields.',
	},
	columns: {
		type: 'array',
		minItems: 1,
		maxItems: 12,
		items: {
			type: 'object',
			properties: { key, label: { type: 'string', minLength: 1, maxLength: 80 } },
			required: ['key', 'label'],
			additionalProperties: false,
		},
	},
	titleField: { ...key, description: 'Selected column for card titles.' },
	filterField: {
		type: ['string', 'null'],
		maxLength: 80,
		description: 'Selected filter column; null disables.',
	},
	sourceField: {
		type: ['string', 'null'],
		maxLength: 80,
		description: 'Source-path field; buttons require sourcePaths membership.',
	},
	sourcePaths: {
		type: 'array',
		maxItems: 100,
		uniqueItems: true,
		items: { type: 'string', maxLength: 2048 },
		description: 'Allowed source files. Only existence shared; missing paths disabled.',
	},
};
async function show(path: string) {
	openApp('studio');
	try {
		await studioService.open(path);
		return {};
	} catch (error) {
		return { displayWarning: error instanceof Error ? error.message : String(error) };
	}
}
export const studioTools: WebMCP.ModelContextTool[] = [
	defineTool({
		name: 'studio_list',
		title: 'List apps',
		description:
			'List 100 .app.json explorers max and malformed-manifest warnings. No writes/opens. Fixed search/filter/card/table renderer; no supplied code/plugins/runtime.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		async execute() {
			const result = await studioService.list();
			return successfulResult(result, `Found ${result.apps.length} saved apps.`);
		},
	}),
	defineTool({
		name: 'studio_read',
		title: 'Read app',
		description:
			'Read named/last manifest, revision, sources, data count/revision, and data errors. No writes/opens. Read full dataPath with files_read.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: { type: 'object', properties: { path: pathSchema }, additionalProperties: false },
		async execute(input) {
			const result = await studioService.read(optionalAbsolutePath(input, 'path'));
			return successfulResult(result, `Read ${result.data.title}.`);
		},
	}),
	defineTool({
		name: 'studio_create',
		title: 'Create data explorer',
		description:
			'Create/open a .app.json explorer with selected JSON fields/sources and search/filter/views/source opening. No overwrites, supplied code, or network.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			properties: { path: pathSchema, ...fields },
			required: ['path', ...Object.keys(fields)],
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const { path: _path, ...app } = input;
			const result = await studioService.create(absolutePath(input, 'path'), app as StudioInput, {
				actor: 'agent',
				signal,
			});
			return successfulResult(
				{ ...result, ...(await show(result.path)) },
				`Created ${result.data.title}.`,
			);
		},
	}),
	defineTool({
		name: 'studio_update',
		title: 'Update app',
		description:
			'Update/open at revision; arrays replace. Validates data; rejects stale edits/drafts. Change dataPath with files_write, then reload data.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			properties: {
				path: pathSchema,
				expectedRevision: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
				changes: {
					type: 'object',
					properties: fields,
					minProperties: 1,
					additionalProperties: false,
				},
			},
			required: ['path', 'expectedRevision', 'changes'],
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const result = await studioService.update(
				absolutePath(input, 'path'),
				requiredString(input, 'expectedRevision', { maxLength: 71 }),
				objectValue(input.changes) as Partial<StudioInput>,
				{ actor: 'agent', signal },
			);
			return successfulResult(
				{ ...result, ...(await show(result.path)) },
				`Updated ${result.data.title}.`,
			);
		},
	}),
	defineTool({
		name: 'studio_open',
		title: 'Open app',
		description:
			'Open/remember .app.json with latest data and selected sources in read-only preview. No supplied code. Save/discard settings before switching.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			properties: { path: pathSchema },
			required: ['path'],
			additionalProperties: false,
		},
		async execute(input) {
			const path = absolutePath(input, 'path');
			openApp('studio');
			await studioService.open(path);
			const result = await studioService.read(path);
			return successfulResult(result, `Opened ${result.data.title}.`);
		},
	}),
];
