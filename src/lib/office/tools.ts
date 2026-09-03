import { officeService } from './office';
import { absolutePath, defineTool, successfulResult } from '../webmcp/tool-utils';

const path = {
	type: 'string',
	description: 'Absolute office file path.',
};
const paragraph = {
	type: 'object',
	required: ['type', 'text'],
	properties: {
		type: { const: 'paragraph' },
		text: { type: 'string' },
		style: {
			type: 'string',
			description: 'Writer style: Title, Heading 1, Heading 2, Standard, etc.',
		},
	},
	additionalProperties: false,
};
const table = {
	type: 'object',
	required: ['type', 'rows'],
	properties: {
		type: { const: 'table' },
		rows: {
			type: 'array',
			minItems: 1,
			maxItems: 40,
			items: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string' } },
		},
	},
	additionalProperties: false,
};
const blocks = { type: 'array', maxItems: 200, items: { oneOf: [paragraph, table] } };

export const documentTools: WebMCP.ModelContextTool[] = [
	defineTool({
		name: 'documents_create',
		title: 'Create document',
		description:
			'Create ODT/DOCX with styled paragraphs/tables; opens Writer and saves. First engine load may take a minute.',
		annotations: { readOnlyHint: false, untrustedContentHint: false },
		inputSchema: {
			type: 'object',
			required: ['path', 'blocks'],
			properties: { path, blocks },
			additionalProperties: false,
		},
		async execute(input, options) {
			options.signal.throwIfAborted();
			const entry = await officeService.newDocument(
				absolutePath(input, 'path'),
				input.blocks,
				'agent',
				options.signal,
			);
			return successfulResult({ entry }, `Created ${entry.path} in Documents.`);
		},
	}),
	defineTool({
		name: 'documents_read',
		title: 'Read document',
		description:
			'Read ODT/DOCX in Documents, not files_read. Saves drafts before switching. Returns bounded text, indexed/styled paragraphs, cells, image metadata, selection, revision/truncation.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path'],
			properties: { path },
			additionalProperties: false,
		},
		async execute(input, options) {
			const document = await officeService.read(absolutePath(input, 'path'), options.signal);
			return successfulResult(
				{ document },
				`Read ${document.path}, revision ${document.revision}.`,
			);
		},
	}),
	defineTool({
		name: 'documents_edit',
		title: 'Edit document',
		description:
			'Apply one change at documents_read revision, preserving other content. Updates/saves Writer. Reread after human edits/document switches.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path', 'expectedRevision', 'operation'],
			properties: {
				path,
				expectedRevision: { type: 'integer', minimum: 0 },
				operation: {
					oneOf: [
						{
							type: 'object',
							required: ['type', 'imagePath'],
							properties: {
								type: { const: 'insert-image' },
								imagePath: {
									type: 'string',
									description: 'Embed workspace PNG/JPEG, up to 10 MiB.',
								},
								position: {
									type: 'string',
									enum: ['end', 'cursor'],
									default: 'end',
									description: 'Insert at end or cursor, after and preserving selected text.',
								},
								description: {
									type: 'string',
									maxLength: 2000,
									description: 'Image alt text.',
								},
							},
							additionalProperties: false,
						},
						{
							type: 'object',
							required: ['type', 'find', 'replace'],
							properties: {
								type: { const: 'replace' },
								find: { type: 'string' },
								replace: { type: 'string' },
								expectedOccurrences: { type: 'integer', minimum: 1, default: 1 },
							},
							additionalProperties: false,
						},
						{
							type: 'object',
							required: ['type', 'index'],
							properties: {
								type: { const: 'paragraph' },
								index: { type: 'integer', minimum: 0 },
								text: { type: 'string' },
								style: { type: 'string' },
							},
							additionalProperties: false,
						},
						{
							type: 'object',
							required: ['type', 'table', 'cell', 'text'],
							properties: {
								type: { const: 'table-cell' },
								table: { type: 'string' },
								cell: { type: 'string' },
								text: { type: 'string' },
							},
							additionalProperties: false,
						},
						{
							type: 'object',
							required: ['type', 'blocks'],
							properties: { type: { const: 'append' }, blocks },
							additionalProperties: false,
						},
					],
				},
			},
			additionalProperties: false,
		},
		async execute(input, options) {
			const result = await officeService.edit(
				absolutePath(input, 'path'),
				input.expectedRevision,
				input.operation,
				'agent',
				options.signal,
			);
			return successfulResult(result, `Updated ${result.entry.path}.`);
		},
	}),
	defineTool({
		name: 'documents_export',
		title: 'Export document',
		description:
			'Export new ODT/DOCX/PDF by destination extension. Retains editable source; rejects existing destinations.',
		annotations: { readOnlyHint: false, untrustedContentHint: false },
		inputSchema: {
			type: 'object',
			required: ['path', 'destination'],
			properties: { path, destination: path },
			additionalProperties: false,
		},
		async execute(input, options) {
			const entry = await officeService.exportDocument(absolutePath(input, 'destination'), {
				actor: 'agent',
				source: absolutePath(input, 'path'),
				signal: options.signal,
			});
			return successfulResult({ entry }, `Exported ${entry.path}.`);
		},
	}),
];
