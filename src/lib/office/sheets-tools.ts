import { sheetsService } from './office';
import {
	absolutePath,
	optionalAbsolutePath,
	defineTool,
	requiredString,
	successfulResult,
} from '../webmcp/tool-utils';

const path = { type: 'string', description: 'Absolute ODS/XLSX workspace path.' };
const sheet = {
	type: 'string',
	maxLength: 31,
	description: 'Sheet; defaults to active.',
};
const range = {
	type: 'string',
	description: 'A1, no sheet prefix; max2000 cells/200 rows/50 columns.',
};
const expectedRevision = {
	type: 'integer',
	minimum: 0,
	description: 'sheets_read revision. Reread after human edits.',
};
const values = {
	type: 'array',
	minItems: 1,
	maxItems: 200,
	items: {
		type: 'array',
		minItems: 1,
		maxItems: 50,
		items: {
			oneOf: [
				{ type: 'string', maxLength: 10000 },
				{ type: 'number' },
				{ type: 'null' },
				{
					type: 'object',
					required: ['formula'],
					properties: {
						formula: {
							type: 'string',
							maxLength: 2000,
							description: 'Calc formula, e.g. =SUM(B2:B5). Strings stay literal.',
						},
					},
					additionalProperties: false,
				},
			],
		},
	},
};
export const sheetTools: WebMCP.ModelContextTool[] = [
	defineTool({
		name: 'sheets_select',
		title: 'Select workbook cells',
		description:
			'Show a sheet and select its cell range at the latest sheets_read revision. Changes visible selection without editing cells.',
		annotations: { readOnlyHint: false, untrustedContentHint: false },
		inputSchema: {
			type: 'object',
			required: ['path', 'expectedRevision', 'range'],
			properties: { path, expectedRevision, sheet, range },
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const result = await sheetsService.selectWorkbook(
				absolutePath(input, 'path'),
				input.expectedRevision,
				input,
				signal,
			);
			return successfulResult(result, 'Selected cells in Sheets.');
		},
	}),

	defineTool({
		name: 'sheets_create',
		title: 'Create a workbook',
		description:
			'Create ODS/XLSX sheets with text/numbers/formulas; opens Sheets and saves. Rejects existing files. First Calc load may take a minute.',
		annotations: { readOnlyHint: false, untrustedContentHint: false },
		inputSchema: {
			type: 'object',
			required: ['path', 'sheets'],
			properties: {
				path,
				sheets: {
					type: 'array',
					minItems: 1,
					maxItems: 8,
					items: {
						type: 'object',
						required: ['name', 'values'],
						properties: { name: sheet, values },
						additionalProperties: false,
					},
				},
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const entry = await sheetsService.newWorkbook(
				absolutePath(input, 'path'),
				input.sheets,
				'agent',
				signal,
			);
			return successfulResult(
				{ entry },
				`Created ${entry.path} in Sheets. Read it with sheets_read before editing.`,
			);
		},
	}),
	defineTool({
		name: 'sheets_read',
		title: 'Read cells and selection',
		description:
			'Read cells/values/formulas/errors, sheets/charts, selection/revision. Defaults to open workbook, active sheet, A1:J30. Keeps selection; saves drafts before switching.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			properties: { path, sheet, range, includeFormatting: { type: 'boolean', default: false } },
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const workbook = await sheetsService.readWorkbook(
				optionalAbsolutePath(input, 'path'),
				input,
				signal,
			);
			return successfulResult(
				{ workbook },
				`Read ${workbook.path}, ${workbook.sheet}!${workbook.range}, revision ${workbook.revision}.`,
			);
		},
	}),
	defineTool({
		name: 'sheets_edit',
		title: 'Edit or format cells',
		description:
			'Edit/format a rectangle at expectedRevision. Values must fit. Numbers stay numeric; strings literal; null clears; {formula:"=SUM(B2:B5)"} sets a local formula. Recalculates, selects and saves.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path', 'expectedRevision', 'operation'],
			properties: {
				path,
				expectedRevision,
				operation: {
					oneOf: [
						{
							type: 'object',
							required: ['type', 'action'],
							properties: {
								type: { const: 'sheet' },
								action: { enum: ['add', 'rename', 'remove', 'move'] },
								sheet,
								name: sheet,
								index: { type: 'integer', minimum: 0, maximum: 1000 },
							},
							additionalProperties: false,
						},
						{
							type: 'object',
							required: ['type', 'axis', 'action', 'index', 'count'],
							properties: {
								type: { const: 'structure' },
								sheet,
								axis: { enum: ['rows', 'columns'] },
								action: { enum: ['insert', 'remove'] },
								index: { type: 'integer', minimum: 0 },
								count: { type: 'integer', minimum: 1, maximum: 100 },
							},
							additionalProperties: false,
						},
						{
							type: 'object',
							required: ['type', 'range', 'column'],
							properties: {
								type: { const: 'sort' },
								sheet,
								range,
								column: {
									type: 'integer',
									minimum: 0,
									description: 'Zero-based column within range.',
								},
								ascending: { type: 'boolean', default: true },
								header: { type: 'boolean', default: true },
							},
							additionalProperties: false,
						},
						{
							type: 'object',
							required: ['type', 'range', 'value'],
							properties: {
								type: { const: 'filter' },
								sheet,
								range,
								column: { type: 'integer', minimum: 0 },
								value: {
									type: ['string', 'number', 'null'],
									description: 'Exact match, null clears filtering.',
								},
								header: { type: 'boolean', default: true },
							},
							additionalProperties: false,
						},
						{
							type: 'object',
							required: ['type', 'range'],
							properties: {
								type: { const: 'merge' },
								sheet,
								range,
								merge: {
									type: 'boolean',
									default: true,
									description: 'False unmerges. Merge rejects nonempty cells except top-left.',
								},
							},
							additionalProperties: false,
						},

						{
							type: 'object',
							required: ['type', 'range', 'values'],
							properties: { type: { const: 'cells' }, sheet, range, values },
							additionalProperties: false,
						},
						{
							type: 'object',
							required: ['type', 'range'],
							properties: {
								type: { const: 'format' },
								sheet,
								range,
								bold: { type: 'boolean' },
								italic: { type: 'boolean' },
								underline: { type: 'boolean' },
								wrap: { type: 'boolean' },
								fontName: { type: 'string', maxLength: 200 },
								fontSize: { type: 'number', exclusiveMinimum: 0, maximum: 500 },
								align: { enum: ['left', 'center', 'right'] },
								columnWidthMm: { type: 'number', exclusiveMinimum: 0, maximum: 500 },
								rowHeightMm: { type: 'number', exclusiveMinimum: 0, maximum: 500 },
								autoFit: {
									type: 'boolean',
									description: 'Fit columns to content.',
								},
								background: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
								color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
								numberFormat: {
									type: 'string',
									maxLength: 100,
									description: 'Calc number format, e.g. #,##0.00 or 0%.',
								},
							},
							additionalProperties: false,
						},
					],
				},
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const result = await sheetsService.editWorkbook(
				absolutePath(input, 'path'),
				input.expectedRevision,
				input.operation,
				'agent',
				signal,
			);
			return successfulResult(result, `Updated ${result.entry.path}.`);
		},
	}),
	defineTool({
		name: 'sheets_chart',
		title: 'Create, update or remove a chart',
		description:
			'Create/update/remove a linked chart at fresh revision. Supports column, bar, line, pie, area. First row: series; first column: categories; rest: numbers. Recalculates with cells; saves.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path', 'expectedRevision', 'name'],
			properties: {
				action: { enum: ['create', 'update', 'remove'], default: 'create' },
				kind: { enum: ['column', 'bar', 'line', 'pie', 'area'] },
				path,
				expectedRevision,
				sheet,
				range,
				name: { type: 'string', minLength: 1, maxLength: 100 },
				title: { type: 'string', maxLength: 200 },
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const result = await sheetsService.chartWorkbook(
				absolutePath(input, 'path'),
				input.expectedRevision,
				input,
				'agent',
				signal,
			);
			return successfulResult(result, `Updated ${result.chart.name} in ${result.entry.path}.`);
		},
	}),
	defineTool({
		name: 'sheets_export',
		title: 'Export workbook or chart',
		description:
			'Export new ODS/XLSX/PDF or chart PNG snapshot. PNG needs sheets_read sheet/chart names; usable in Documents. Keeps editable source; no overwrite.',
		annotations: { readOnlyHint: false, untrustedContentHint: false },
		inputSchema: {
			type: 'object',
			required: ['path', 'destination'],
			properties: {
				path,
				destination: {
					type: 'string',
					description: 'New absolute .ods/.xlsx/.pdf/.png path.',
				},
				sheet,
				chart: { type: 'string', minLength: 1, maxLength: 100 },
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const source = absolutePath(input, 'path'),
				destination = absolutePath(input, 'destination');
			const entry = /\.png$/i.test(destination)
				? await sheetsService.exportChart(
						source,
						requiredString(input, 'sheet', { maxLength: 31 }),
						requiredString(input, 'chart', { maxLength: 100 }),
						destination,
						'agent',
						signal,
					)
				: await sheetsService.exportDocument(destination, { actor: 'agent', source, signal });
			return successfulResult({ entry }, `Exported ${entry.path}.`);
		},
	}),
];
