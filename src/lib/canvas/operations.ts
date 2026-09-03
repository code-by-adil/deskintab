import { AppError } from '../errors';
import type {
	ExcalidrawElement,
	ExcalidrawTextElement,
} from '@excalidraw/excalidraw/element/types';
import { boundedText, checkFileLink, fileLink, objectValue } from '../workspace/json-document';

import { connectorSkeleton, finite, parseCanvasFile, safeColor, type Scene } from './scene';
import { loadCanvasSDK } from './sdk';
import { readWorkspaceRaster } from '../workspace/raster';

export type CanvasOperation =
	| { op: 'add'; object: Record<string, unknown> }
	| { op: 'update'; id: string; changes: Record<string, unknown> }
	| { op: 'delete'; id: string }
	| { op: 'reorder'; ids: string[] };
const fields = new Set([
	'x',
	'y',
	'width',
	'height',
	'text',
	'fill',
	'color',
	'backgroundColor',
	'strokeColor',
	'fontSize',
	'fontFamily',
	'fillStyle',
	'strokeStyle',
	'textAlign',
	'verticalAlign',
	'startArrowhead',
	'endArrowhead',
	'strokeWidth',
	'roughness',
	'opacity',
	'angle',
	'link',
	'points',
	'groupIds',
	'locked',
	'from',
	'to',
]);
function changes(raw: Record<string, unknown>) {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (key === 'from' || key === 'to') boundedText(value, 'Endpoint ID', 100);
		if (key === 'points') {
			if (!Array.isArray(value) || value.length < 2 || value.length > 20000)
				throw new AppError('INVALID_DATA', 'Use 2–20,000 [x,y] points.');
			for (const point of value) {
				if (!Array.isArray(point) || point.length !== 2)
					throw new AppError('INVALID_DATA', 'Use [x,y] points.');
				finite(point[0], 'Point X');
				finite(point[1], 'Point Y');
			}
		}
		if (!fields.has(key))
			throw new AppError('INVALID_DATA', `Unsupported change ${key}. Read the canvas_edit schema.`);
		if (
			[
				'x',
				'y',
				'width',
				'height',
				'fontSize',
				'fontFamily',
				'strokeWidth',
				'roughness',
				'opacity',
				'angle',
			].includes(key)
		)
			finite(
				value,
				key,
				['width', 'height', 'fontSize', 'strokeWidth', 'roughness', 'opacity'].includes(key)
					? 0
					: -1_000_000,
			);
		if (['fill', 'color', 'backgroundColor', 'strokeColor'].includes(key)) safeColor(value);
		const styles: Record<string, readonly (string | null)[]> = {
			fillStyle: ['solid', 'hachure', 'cross-hatch', 'zigzag'],
			strokeStyle: ['solid', 'dashed', 'dotted'],
			textAlign: ['left', 'center', 'right'],
			verticalAlign: ['top', 'middle', 'bottom'],
			startArrowhead: [
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
			endArrowhead: [
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
		};
		if (styles[key] && !styles[key].includes(value as string | null))
			throw new AppError('INVALID_DATA', `Invalid ${key}; use the canvas_edit schema values.`);
		if (key === 'fontFamily' && ![1, 2, 3, 5, 6, 7, 8, 9].includes(Number(value)))
			throw new AppError('INVALID_DATA', 'Use a supported Excalidraw font family ID.');
		if (key === 'text') boundedText(value, 'Text', 20000, true);
		if (key === 'locked' && typeof value !== 'boolean')
			throw new AppError('INVALID_DATA', 'locked must be boolean.');
		if (
			key === 'groupIds' &&
			(!Array.isArray(value) ||
				value.length > 20 ||
				value.some((id) => typeof id !== 'string' || !id || id.length > 100))
		)
			throw new AppError('INVALID_DATA', 'Use at most 20 group IDs.');
		result[key === 'fill' ? 'backgroundColor' : key === 'color' ? 'strokeColor' : key] =
			key === 'link' ? fileLink(value) : value;
	}
	return result;
}
export async function applyOperations(
	base: Scene,
	operations: CanvasOperation[],
	signal?: AbortSignal,
): Promise<Scene> {
	if (!Array.isArray(operations) || operations.length > 100)
		throw new AppError('INVALID_DATA', 'Use at most 100 operations.');
	const sdk = await loadCanvasSDK();
	let elements = structuredClone(base.elements);
	const files = structuredClone(base.files);
	for (const raw of operations) {
		signal?.throwIfAborted();
		const operation = objectValue(raw);
		if (operation.op === 'reorder') {
			const ids = operation.ids;
			const independent = elements.filter(
				(element) => element.type !== 'text' || !element.containerId,
			);
			if (
				!Array.isArray(ids) ||
				ids.length !== independent.length ||
				new Set(ids).size !== ids.length ||
				ids.some(
					(id) => typeof id !== 'string' || !independent.some((element) => element.id === id),
				)
			)
				throw new AppError(
					'INVALID_DATA',
					'reorder.ids must list each shape, arrow, image and unbound text ID exactly once, back to front. Bound labels move with their shapes.',
				);
			const ordered = (ids as string[]).flatMap((id) => [
				elements.find((element) => element.id === id)!,
				...elements.filter((element) => element.type === 'text' && element.containerId === id),
			]);
			elements = ordered.map((element) => sdk.newElementWith(element, { index: null }));
		} else if (operation.op === 'add') {
			const object = objectValue(operation.object),
				id = boundedText(object.id, 'ID', 100),
				type = String(object.type);
			if (elements.some((e) => e.id === id))
				throw new AppError('INVALID_DATA', `Element ${id} already exists.`);
			if (
				![
					'text',
					'sticky',
					'rectangle',
					'ellipse',
					'diamond',
					'arrow',
					'connector',
					'line',
					'freedraw',
					'image',
				].includes(type)
			)
				throw new AppError(
					'INVALID_DATA',
					'Add text, sticky, rectangle, diamond, ellipse, arrow, line, freedraw, or image.',
				);
			const { id: _id, type: _type, from, to, imagePath, ...rest } = object;
			const attrs = changes(rest);
			if (
				('startArrowhead' in attrs || 'endArrowhead' in attrs) &&
				!['arrow', 'connector', 'line'].includes(type)
			)
				throw new AppError('INVALID_DATA', 'Arrowheads apply only to lines and arrows.');
			if ((from !== undefined || to !== undefined) && !['arrow', 'connector'].includes(type))
				throw new AppError('INVALID_CONNECTOR', 'Only arrows accept from/to shape IDs.');
			if (imagePath !== undefined && type !== 'image')
				throw new AppError('INVALID_IMAGE', 'imagePath is only valid for an image element.');
			if (attrs.link) await checkFileLink(attrs.link as string);
			let addition: ExcalidrawElement[];
			if (type === 'image') {
				if ('text' in attrs || 'points' in attrs || 'fontSize' in attrs)
					throw new AppError(
						'INVALID_IMAGE',
						'Use geometry, style, and link fields for images. Add captions as separate text elements.',
					);
				const image = await readWorkspaceRaster(boundedText(imagePath, 'Image path', 2048), signal);
				const scale = Math.min(1, 600 / Math.max(image.width, image.height));
				const width = Number(
					attrs.width ??
						(attrs.height !== undefined
							? (Number(attrs.height) * image.width) / image.height
							: image.width * scale),
				);
				const height = Number(attrs.height ?? (width * image.height) / image.width);
				files[image.id] = {
					id: image.id,
					mimeType: image.mimeType,
					dataURL: image.dataURL,
					created: Date.now(),
				} as Scene['files'][string];
				addition = sdk.convertToExcalidrawElements(
					[
						{
							id,
							type: 'image',
							x: 80,
							y: 80,
							...attrs,
							width,
							height,
							fileId: image.id,
							status: 'saved',
							scale: [1, 1],
						},
					] as Parameters<typeof sdk.convertToExcalidrawElements>[0],
					{ regenerateIds: false },
				);
			} else if (type === 'freedraw') {
				if (!Array.isArray(attrs.points) || attrs.points.length < 2)
					throw new AppError('INVALID_DATA', 'A freehand stroke needs at least two [x,y] points.');
				addition = sdk.restoreElements(
					[
						{
							id,
							type,
							x: 80,
							y: 80,
							strokeColor: '#243247',
							pressures: [],
							simulatePressure: true,
							lastCommittedPoint: null,
							...attrs,
							width:
								Math.max(...(attrs.points as number[][]).map((p) => p[0])) -
								Math.min(...(attrs.points as number[][]).map((p) => p[0])),
							height:
								Math.max(...(attrs.points as number[][]).map((p) => p[1])) -
								Math.min(...(attrs.points as number[][]).map((p) => p[1])),
							// restoreElements hydrates this validated serialized fragment.
						} as unknown as ExcalidrawElement,
					],
					null,
					{ repairBindings: true },
				);
			} else {
				let endpoints: ExcalidrawElement[] = [];
				let skeleton: Record<string, unknown> = {
					id,
					type: type === 'sticky' ? 'rectangle' : type === 'connector' ? 'arrow' : type,
					x: 80,
					y: 80,
					width: 240,
					height: 140,
					strokeColor: '#243247',
					backgroundColor: type === 'sticky' ? '#fff2b3' : 'transparent',
					fillStyle: 'solid',
					...attrs,
				};
				if (type === 'connector' || from !== undefined || to !== undefined) {
					const a = elements.find((e) => e.id === from),
						b = elements.find((e) => e.id === to);
					if (
						!a ||
						!b ||
						a === b ||
						!['rectangle', 'ellipse', 'diamond'].includes(a.type) ||
						!['rectangle', 'ellipse', 'diamond'].includes(b.type)
					)
						throw new AppError(
							'INVALID_CONNECTOR',
							'Connect two different existing shapes by from/to IDs.',
						);
					// Conversion receives existing endpoints too, and returns updated bindings.
					skeleton = { ...skeleton, ...connectorSkeleton(a, b) };
					endpoints = [a, b];
				}
				if (type === 'text') {
					skeleton.text = attrs.text ?? 'Your text';
					delete skeleton.width;
					delete skeleton.height;
				} else if (attrs.text !== undefined) {
					skeleton.label = {
						text: attrs.text,
						fontSize: attrs.fontSize ?? 20,
						fontFamily: attrs.fontFamily,
						textAlign: attrs.textAlign,
						verticalAlign: attrs.verticalAlign,
					};
					delete skeleton.fontFamily;
					delete skeleton.textAlign;
					delete skeleton.verticalAlign;
					delete skeleton.text;
				}
				const converted = sdk.convertToExcalidrawElements(
					[...endpoints, skeleton] as Parameters<typeof sdk.convertToExcalidrawElements>[0],
					{ regenerateIds: false },
				);
				// Skeleton conversion is for new objects, not existing native text:
				// reconverting a centered label treats its anchor as a new text origin.
				elements = elements.map((e) =>
					endpoints.some((endpoint) => endpoint.id === e.id)
						? sdk.newElementWith(e, {
								boundElements: converted.find((item) => item.id === e.id)!.boundElements,
							})
						: e,
				);
				addition = converted.filter((e) => !endpoints.some((endpoint) => endpoint.id === e.id));
			}
			elements.push(...addition);
		} else if (operation.op === 'update' || operation.op === 'delete') {
			const id = boundedText(operation.id, 'ID', 100),
				previous = elements.find((e) => e.id === id);
			if (!previous)
				throw new AppError('OBJECT_NOT_FOUND', `Element ${id} is missing. Read canvas_read again.`);
			if (operation.op === 'delete') {
				const remove = new Set([id]);
				for (const e of elements)
					if (
						(e.type === 'text' && e.containerId === id) ||
						(e.type === 'arrow' &&
							(e.startBinding?.elementId === id || e.endBinding?.elementId === id))
					)
						remove.add(e.id);
				for (const e of elements)
					if (e.type === 'text' && e.containerId && remove.has(e.containerId)) remove.add(e.id);
				elements = elements
					.filter((e) => !remove.has(e.id))
					.map((e) =>
						sdk.newElementWith(e, {
							boundElements: e.boundElements?.filter((b) => !remove.has(b.id)) ?? null,
						}),
					);
				continue;
			}
			const attrs = changes(objectValue(operation.changes));
			if ('from' in attrs || 'to' in attrs) {
				if (previous.type !== 'arrow')
					throw new AppError('INVALID_CONNECTOR', 'Only arrows can be reconnected with from/to.');
				if (['x', 'y', 'width', 'height', 'points'].some((key) => key in attrs))
					throw new AppError(
						'INVALID_CONNECTOR',
						'Reconnect with from/to separately from manual arrow geometry.',
					);
				const from = attrs.from ?? previous.startBinding?.elementId;
				const to = attrs.to ?? previous.endBinding?.elementId;
				const a = elements.find((e) => e.id === from),
					b = elements.find((e) => e.id === to);
				if (
					!a ||
					!b ||
					a === b ||
					!['rectangle', 'ellipse', 'diamond'].includes(a.type) ||
					!['rectangle', 'ellipse', 'diamond'].includes(b.type)
				)
					throw new AppError(
						'INVALID_CONNECTOR',
						'Connect two different existing shapes. Supply both from/to for an unbound arrow.',
					);
				const endpoints = [a, b].map((e) => ({
					...e,
					boundElements: e.boundElements?.filter((item) => item.id !== id) ?? null,
				}));
				const converted = sdk.convertToExcalidrawElements(
					[...endpoints, { id, ...connectorSkeleton(a, b) }] as Parameters<
						typeof sdk.convertToExcalidrawElements
					>[0],
					{ regenerateIds: false },
				);
				const arrow = converted.find((e) => e.id === id)!;
				if (arrow.type !== 'arrow')
					throw new AppError('INVALID_CONNECTOR', 'Could not create arrow bindings.');
				delete attrs.from;
				delete attrs.to;
				Object.assign(attrs, {
					x: arrow.x,
					y: arrow.y,
					width: arrow.width,
					height: arrow.height,
					points: arrow.points,
					startBinding: arrow.startBinding,
					endBinding: arrow.endBinding,
					elbowed: false,
					fixedSegments: null,
				});
				elements = elements.map((e) => {
					const endpoint = converted.find((item) => item.id === e.id && item.id !== id);
					const boundElements =
						endpoint?.boundElements ?? e.boundElements?.filter((item) => item.id !== id) ?? null;
					return e.id === id ? e : sdk.newElementWith(e, { boundElements });
				});
			}
			if ('link' in attrs) await checkFileLink(attrs.link as string | null);
			const boundText = elements.find((e) => e.type === 'text' && e.containerId === id) as
				| ExcalidrawTextElement
				| undefined;
			if (
				('startArrowhead' in attrs || 'endArrowhead' in attrs) &&
				!['arrow', 'line'].includes(previous.type)
			)
				throw new AppError('INVALID_DATA', 'Arrowheads apply only to lines and arrows.');
			const labelStyles: Record<string, unknown> = {};
			if (previous.type !== 'text')
				for (const key of ['fontFamily', 'textAlign', 'verticalAlign']) {
					if (key in attrs) {
						labelStyles[key] = attrs[key];
						delete attrs[key];
					}
				}
			const labelFontSize = attrs.fontSize;
			let text = attrs.text;
			if (
				previous.type !== 'text' &&
				(labelFontSize !== undefined || Object.keys(labelStyles).length)
			) {
				if (text === undefined && boundText) text = boundText.originalText;
				if (text === undefined)
					throw new AppError('INVALID_DATA', 'Add label text before setting its font size.');
				delete attrs.fontSize;
			}
			delete attrs.text;
			if ('points' in attrs && !['freedraw', 'line', 'arrow'].includes(previous.type))
				throw new AppError('INVALID_DATA', 'Only freehand, line, and arrow elements have points.');
			if (previous.type === 'freedraw' && ('width' in attrs || 'height' in attrs))
				throw new AppError(
					'INVALID_DATA',
					'Move a freehand stroke with x/y; reshape it with points rather than width/height.',
				);
			if (previous.type === 'freedraw' && 'points' in attrs) {
				attrs.simulatePressure = true;
				attrs.pressures = [];
				const points = attrs.points as number[][];
				attrs.width = Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0]));
				attrs.height = Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1]));
			}
			let next = sdk.newElementWith(previous, attrs as Partial<ExcalidrawElement>);
			const dx = next.x - previous.x + (next.width - previous.width) / 2,
				dy = next.y - previous.y + (next.height - previous.height) / 2;
			elements = elements.map((e) => {
				if (e.id === id) return next;
				if (e.type === 'text' && e.containerId === id)
					return sdk.newElementWith(e, { x: e.x + dx, y: e.y + dy, angle: next.angle });
				if (
					e.type === 'arrow' &&
					(dx || dy) &&
					(e.startBinding?.elementId === id || e.endBinding?.elementId === id)
				) {
					const points = e.points.map((p) => [p[0], p[1]] as [number, number]);
					if (e.startBinding?.elementId === id) {
						points[0][0] += dx;
						points[0][1] += dy;
					}
					if (e.endBinding?.elementId === id) {
						points[points.length - 1][0] += dx;
						points[points.length - 1][1] += dy;
					}
					return sdk.newElementWith(e, { points } as Partial<typeof e>);
				}
				return e;
			});
			if (text !== undefined) {
				if (previous.type === 'text')
					elements = elements.map((e) =>
						e.id === id
							? sdk.newElementWith(e as ExcalidrawTextElement, {
									text: String(text),
									originalText: String(text),
								})
							: e,
					);
				else if (['rectangle', 'ellipse', 'diamond', 'arrow'].includes(previous.type)) {
					const oldLabel = elements.find(
						(e): e is ExcalidrawTextElement => e.type === 'text' && e.containerId === id,
					);
					if (text === '') {
						elements = elements
							.filter((e) => e.id !== oldLabel?.id)
							.map((e) =>
								e.id === id
									? sdk.newElementWith(e, {
											boundElements: e.boundElements?.filter((b) => b.type !== 'text') ?? null,
										})
									: e,
							);
						continue;
					}
					const labelId = oldLabel?.id ?? crypto.randomUUID();
					const generated = sdk.convertToExcalidrawElements(
						[
							{
								...next,
								type: previous.type as 'rectangle' | 'ellipse' | 'diamond' | 'arrow',
								boundElements: null,
								label: {
									text: String(text),
									fontSize: Number(labelFontSize ?? oldLabel?.fontSize ?? 20),
									...(oldLabel
										? {
												fontFamily: oldLabel.fontFamily,
												strokeColor: oldLabel.strokeColor,
												textAlign: oldLabel.textAlign,
												verticalAlign: oldLabel.verticalAlign,
												opacity: oldLabel.opacity,
												angle: oldLabel.angle,
											}
										: {}),
									...labelStyles,
								},
							},
						] as Parameters<typeof sdk.convertToExcalidrawElements>[0],
						{ regenerateIds: false },
					);
					const label = generated.find((e): e is ExcalidrawTextElement => e.type === 'text')!;
					const { id: _labelId, ...labelUpdate } = label;
					next = sdk.newElementWith(next, {
						boundElements: [
							...(next.boundElements ?? []).filter((b) => b.type !== 'text'),
							{ id: labelId, type: 'text' },
						],
					});
					elements = elements
						.filter((e) => e.id !== oldLabel?.id)
						.map((e) => (e.id === id ? next : e));
					elements.push(
						oldLabel
							? sdk.newElementWith(oldLabel, labelUpdate)
							: ({ ...label, id: labelId } as ExcalidrawElement),
					);
				} else
					throw new AppError(
						'INVALID_DATA',
						'This element cannot contain text. Add a separate text element.',
					);
			}
		} else throw new AppError('INVALID_DATA', 'Use add, update, delete, or reorder.');
	}
	// The public exporter loads Excalidraw's subset fonts without mounting React.
	// Warm those fonts before measuring text, otherwise a first agent edit uses
	// fallback metrics and can clip a handwritten label when the font arrives.
	const textElements = elements.filter((e) => e.type === 'text');
	if (textElements.length)
		await sdk.exportToCanvas({ elements: textElements, files: {}, maxWidthOrHeight: 1 });
	elements = sdk.restoreElements(elements, null, { repairBindings: true, refreshDimensions: true });
	signal?.throwIfAborted();
	return parseCanvasFile({ ...base, elements, files }) as Scene;
}
