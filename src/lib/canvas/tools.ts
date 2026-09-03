import { canvasService, canvasDocument, type CanvasOperation } from './canvas';
import { objectValue } from '../workspace/json-document';
import { apps, openApp } from '../../state/apps.svelte';
import {
	absolutePath,
	defineTool,
	optionalAbsolutePath,
	optionalBoolean,
	optionalEnum,
	optionalInteger,
	optionalString,
	requiredString,
	successfulResult,
} from '../webmcp/tool-utils';
const path = {
	type: 'string',
	description: 'Absolute workspace .excalidraw or legacy .canvas.json path.',
};
const revision = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const objectFields = {
	id: { type: 'string', minLength: 1, maxLength: 80 },
	type: {
		type: 'string',
		enum: [
			'text',
			'sticky',
			'rectangle',
			'diamond',
			'ellipse',
			'connector',
			'arrow',
			'line',
			'freedraw',
			'image',
		],
	},
	x: { type: 'number', minimum: -1000000, maximum: 1000000 },
	y: { type: 'number', minimum: -1000000, maximum: 1000000 },
	width: { type: 'number', minimum: 0, maximum: 1000000 },
	height: { type: 'number', minimum: 0, maximum: 1000000 },
	text: { type: 'string', maxLength: 20000 },
	fill: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' },
	color: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' },
	fontFamily: {
		type: 'integer',
		enum: [1, 2, 3, 5, 6, 7, 8, 9],
		description:
			'Excalidraw font family ID; 1 Virgil, 2 Helvetica, 3 Cascadia, 5 Excalifont, 6 Nunito, 7 Lilita One, 8 Comic Shanns, 9 Liberation Sans.',
	},
	fillStyle: { type: 'string', enum: ['solid', 'hachure', 'cross-hatch', 'zigzag'] },
	strokeStyle: { type: 'string', enum: ['solid', 'dashed', 'dotted'] },
	textAlign: { type: 'string', enum: ['left', 'center', 'right'] },
	verticalAlign: { type: 'string', enum: ['top', 'middle', 'bottom'] },
	startArrowhead: {
		type: ['string', 'null'],
		enum: [
			null,
			'arrow',
			'bar',
			'dot',
			'circle',
			'circle_outline',
			'triangle',
			'triangle_outline',
			'diamond',
			'diamond_outline',
			'crowfoot_one',
			'crowfoot_many',
			'crowfoot_one_or_many',
		],
	},
	endArrowhead: {
		type: ['string', 'null'],
		enum: [
			null,
			'arrow',
			'bar',
			'dot',
			'circle',
			'circle_outline',
			'triangle',
			'triangle_outline',
			'diamond',
			'diamond_outline',
			'crowfoot_one',
			'crowfoot_many',
			'crowfoot_one_or_many',
		],
	},
	fontSize: { type: 'number', minimum: 12, maximum: 72 },
	link: { type: ['string', 'null'], description: 'Existing workspace file or null.' },
	imagePath: {
		type: 'string',
		description:
			'Add-image only. Embed workspace PNG/JPEG/WebP under 5.9 MB. Absolute path, no URLs.',
	},
	from: {
		type: 'string',
		description: 'Start shape ID; omit to keep binding.',
	},
	to: {
		type: 'string',
		description: 'End shape ID; omit to keep binding.',
	},
	points: {
		type: 'array',
		minItems: 2,
		maxItems: 20000,
		items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
	},
	angle: { type: 'number', description: 'Rotation in radians.', minimum: -100, maximum: 100 },
	strokeWidth: { type: 'number', minimum: 0, maximum: 100 },
	roughness: { type: 'number', minimum: 0, maximum: 10 },
	opacity: { type: 'number', minimum: 0, maximum: 100 },
	groupIds: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 100 } },
	locked: { type: 'boolean' },
};
const { id: _id, type: _type, imagePath: _imagePath, ...changeFields } = objectFields;
function sceneData(data: Awaited<ReturnType<typeof canvasService.read>>['data']) {
	return {
		...data,
		files: Object.fromEntries(
			Object.entries(data.files).map(([id, file]) => [id, { id, mimeType: file.mimeType }]),
		),
	};
}
export const canvasTools: WebMCP.ModelContextTool[] = [
	defineTool({
		name: 'canvas_read',
		title: 'Read scene and selection',
		description:
			'Read scene IDs/geometry/bindings/revision/selection; omit path for current/last. includeImage renders PNG; scope:selection limits objects/labels. includePoints gives stroke coordinates, else pointCount; nextOffset continues. Saves human edits; active stroke/text yields CANVAS_BUSY. No opens/creates. desktop_get_context reads without saving.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			properties: {
				path,
				includeImage: { type: 'boolean', default: false },
				includePoints: { type: 'boolean', default: false },
				scope: { type: 'string', enum: ['all', 'selection'] },
				offset: { type: 'integer', minimum: 0 },
				limit: { type: 'integer', minimum: 1, maximum: 500 },
			},
			additionalProperties: false,
		},
		async execute(input) {
			const record = await canvasService.read(optionalAbsolutePath(input, 'path'));
			const visible =
				apps.open.canvas &&
				!apps.minimized.canvas &&
				canvasDocument.snapshot().path === record.path;
			const selectedIds = visible ? canvasService.selection() : [];
			const scope = optionalEnum(input, 'scope', ['all', 'selection'] as const) ?? 'all';
			const all = record.data.elements.filter(
				(e) =>
					scope === 'all' ||
					selectedIds.includes(e.id) ||
					(e.type === 'text' && e.containerId && selectedIds.includes(e.containerId)),
			);
			const offset = optionalInteger(input, 'offset', 0, 0, 2000),
				limit = optionalInteger(input, 'limit', 200, 1, 500),
				includePoints = optionalBoolean(input, 'includePoints');
			const elements = all.slice(offset, offset + limit).map((e) => {
				if (includePoints || !('points' in e)) return e;
				const { points, ...rest } = e;
				return { ...rest, pointCount: points.length };
			});
			const images: { type: 'image'; data: string; mimeType: string }[] = [];
			if (optionalBoolean(input, 'includeImage') && all.length) {
				const { blob } = await canvasService.render({ ...record.data, elements: all });
				const bytes = new Uint8Array(await blob.arrayBuffer());
				let binary = '';
				for (const byte of bytes) binary += String.fromCharCode(byte);
				images.push({ type: 'image', data: btoa(binary), mimeType: 'image/png' });
			}
			return successfulResult(
				{
					...record,
					data: { ...sceneData(record.data), elements },
					visible,
					selectedIds,
					total: all.length,
					nextOffset: offset + elements.length < all.length ? offset + elements.length : null,
				},
				`Read ${record.path}, ${all.length} editable elements${images.length ? ' with a rendered sketch' : ''}.`,
				images,
			);
		},
	}),
	defineTool({
		name: 'canvas_edit',
		title: 'Create or edit diagram',
		description:
			'Apply ordered edits atomically with Review/mounted undo. Create via create:{title}; edit at canvas_read revision. Rejects stale edits/gestures. Preserve unrelated IDs. One image dimension keeps aspect ratio. Arrow endpoints bind IDs and preserve ID/label on update. Shape text edits label; deletion removes label/arrows. Move strokes via x/y, reshape via points. reorder sets layers back to front; bound labels follow their shapes. Max2000 elements/20MB. Infinite canvas ignores create width/height.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path', 'operations'],
			properties: {
				path,
				expectedRevision: revision,
				create: {
					type: 'object',
					required: ['title'],
					properties: {
						title: { type: 'string', maxLength: 120 },
						width: { type: 'number', minimum: 320, maximum: 4096 },
						height: { type: 'number', minimum: 240, maximum: 4096 },
					},
					additionalProperties: false,
				},
				operations: {
					type: 'array',
					maxItems: 100,
					items: {
						oneOf: [
							{
								type: 'object',
								required: ['op', 'ids'],
								properties: {
									op: { const: 'reorder' },
									ids: {
										type: 'array',
										maxItems: 2000,
										items: { type: 'string' },
										description:
											'Every non-bound-label element ID exactly once, back to front. Bound text moves with its shape.',
									},
								},
								additionalProperties: false,
							},
							{
								type: 'object',
								required: ['op', 'object'],
								properties: {
									op: { const: 'add' },
									object: {
										type: 'object',
										required: ['id', 'type'],
										properties: objectFields,
										additionalProperties: false,
									},
								},
								additionalProperties: false,
							},
							{
								type: 'object',
								required: ['op', 'id', 'changes'],
								properties: {
									op: { const: 'update' },
									id: objectFields.id,
									changes: {
										type: 'object',
										properties: changeFields,
										additionalProperties: false,
									},
								},
								additionalProperties: false,
							},
							{
								type: 'object',
								required: ['op', 'id'],
								properties: { op: { const: 'delete' }, id: objectFields.id },
								additionalProperties: false,
							},
						],
					},
				},
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const result = await canvasService.edit(
				absolutePath(input, 'path'),
				input.operations as CanvasOperation[],
				{
					create:
						input.create === undefined
							? undefined
							: (objectValue(input.create) as { title: string; width?: number; height?: number }),
					expectedRevision: optionalString(input, 'expectedRevision', { maxLength: 71 }),
					actor: 'agent',
					signal,
				},
			);
			openApp('canvas');
			let displayWarning;
			try {
				if (canvasDocument.snapshot().path !== result.path) await canvasDocument.open(result.path);
				else await canvasDocument.refresh();
			} catch (error) {
				displayWarning = String(error);
			}
			return successfulResult(
				{ ...result, data: sceneData(result.data), ...(displayWarning ? { displayWarning } : {}) },
				`Saved ${result.path}, ${result.data.elements.length} editable elements.`,
			);
		},
	}),
	defineTool({
		name: 'canvas_export',
		title: 'Export PNG',
		description:
			'Export revision-checked PNG; keep editable scene. Max1600px/side, no selection outlines/overwrite. Use path in Preview or documents_edit insert-image.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path', 'destination', 'expectedRevision'],
			properties: {
				path,
				destination: { type: 'string', description: 'New absolute .png output path.' },
				expectedRevision: revision,
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const result = await canvasService.export(
				absolutePath(input, 'path'),
				absolutePath(input, 'destination'),
				requiredString(input, 'expectedRevision', { maxLength: 71 }),
				'agent',
				signal,
			);
			return successfulResult(
				result,
				`Exported ${result.path}; editable source remains ${result.sourcePath}.`,
			);
		},
	}),
];
