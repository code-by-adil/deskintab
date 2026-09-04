import { AppError } from '../errors';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { BinaryFiles } from '@excalidraw/excalidraw/types';
import { boundedText, objectValue } from '../workspace/json-document';

import { loadCanvasSDK } from './sdk';

export type Scene = {
	type: 'excalidraw';
	version: 2;
	source: string;
	title: string;
	elements: ExcalidrawElement[];
	appState: { viewBackgroundColor: string; gridSize: number | null };
	files: BinaryFiles;
};
export type LegacyScene = {
	format: 'webmcp-canvas';
	version: 1;
	title: string;
	width: number;
	height: number;
	objects: Record<string, unknown>[];
};
export type CanvasFile = Scene | LegacyScene;
export { CANVAS_MAX_BYTES } from '../workspace/limits';
export const isCanvasPath = (path: string) =>
	path.endsWith('.canvas.json') || path.endsWith('.excalidraw');
export const emptyScene = (title = 'Untitled'): Scene => ({
	type: 'excalidraw',
	version: 2,
	source: 'deskintab',
	title,
	elements: [],
	appState: { viewBackgroundColor: '#ffffff', gridSize: null },
	files: {},
});
export function finite(value: unknown, name: string, min = -1_000_000, max = 1_000_000) {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
		throw new AppError('INVALID_DATA', `${name} must be a finite number from ${min} to ${max}.`);
	return value;
}
export function safeColor(value: unknown) {
	if (
		typeof value !== 'string' ||
		!(value === 'transparent' || /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value))
	)
		throw new AppError('INVALID_DATA', 'Use a hex color or transparent.');
	return value;
}
export function parseCanvasFile(value: unknown): CanvasFile {
	const data = objectValue(value);
	if (data.format === 'webmcp-canvas' && data.version === 1) {
		if (!Array.isArray(data.objects) || data.objects.length > 250)
			throw new AppError('INVALID_DATA', 'Invalid legacy Canvas objects.');
		const ids = new Set<string>();
		for (const raw of data.objects) {
			const o = objectValue(raw),
				id = boundedText(o.id, 'ID', 100);
			if (ids.has(id)) throw new AppError('INVALID_DATA', 'Duplicate object ID.');
			ids.add(id);
			if (!['text', 'sticky', 'rectangle', 'ellipse', 'connector'].includes(String(o.type)))
				throw new AppError('INVALID_DATA', 'Unsupported legacy object.');
			if (o.type !== 'connector') {
				for (const key of ['x', 'y', 'width', 'height']) finite(o[key], key, 0);
				boundedText(o.text ?? '', 'Text', 10000, true);
			}
		}
		for (const raw of data.objects) {
			const o = objectValue(raw);
			if (
				o.type === 'connector' &&
				(!ids.has(String(o.from)) || !ids.has(String(o.to)) || o.from === o.to)
			)
				throw new AppError('INVALID_CONNECTOR', 'Missing legacy connector endpoint.');
		}
		return {
			format: 'webmcp-canvas',
			version: 1,
			title: boundedText(data.title, 'Title', 120),
			width: finite(data.width, 'Width', 320, 4096),
			height: finite(data.height, 'Height', 240, 4096),
			objects: structuredClone(data.objects),
		};
	}
	if (
		data.type !== 'excalidraw' ||
		data.version !== 2 ||
		!Array.isArray(data.elements) ||
		data.elements.length > 2000
	)
		throw new AppError('INVALID_DATA', 'Use an Excalidraw v2 scene with at most 2,000 elements.');
	const ids = new Set<string>();
	let pointCount = 0;
	const elements = data.elements.map((raw) => {
		const e = objectValue(raw);
		const id = boundedText(e.id, 'Element ID', 100);
		if (ids.has(id)) throw new AppError('INVALID_DATA', 'Element IDs must be unique.');
		ids.add(id);
		if (
			![
				'rectangle',
				'diamond',
				'ellipse',
				'text',
				'arrow',
				'line',
				'freedraw',
				'image',
				'frame',
			].includes(String(e.type))
		)
			throw new AppError(
				'INVALID_DATA',
				'Unsupported element type. Embedded webpages and executable content are not supported.',
			);
		for (const key of ['x', 'y', 'width', 'height'])
			finite(e[key], key, key === 'width' || key === 'height' ? 0 : -1_000_000);
		if (e.angle !== undefined) finite(e.angle, 'Angle', -100, 100);
		if (e.fontSize !== undefined) finite(e.fontSize, 'Font size', 1, 500);
		if (e.strokeWidth !== undefined) finite(e.strokeWidth, 'Stroke width', 0, 100);
		if (e.roughness !== undefined) finite(e.roughness, 'Roughness', 0, 10);
		if (e.opacity !== undefined) finite(e.opacity, 'Opacity', 0, 100);
		if (e.text !== undefined) boundedText(e.text, 'Text', 20000, true);
		for (const key of ['strokeColor', 'backgroundColor'])
			if (e[key] !== undefined) safeColor(e[key]);
		if (e.link !== null && e.link !== undefined) boundedText(e.link, 'Link', 2048, true);
		if (e.points !== undefined) {
			if (!Array.isArray(e.points) || e.points.length > 20000)
				throw new AppError('INVALID_DATA', 'Keep strokes under 20,000 points.');
			pointCount += e.points.length;
			for (const p of e.points) {
				if (!Array.isArray(p) || p.length !== 2)
					throw new AppError('INVALID_DATA', 'Use [x,y] points.');
				finite(p[0], 'Point X');
				finite(p[1], 'Point Y');
			}
		}
		if (e.type === 'freedraw') {
			if (!Array.isArray(e.points))
				throw new AppError('INVALID_DATA', 'A freehand element needs points.');
			if (
				e.simulatePressure !== true &&
				(!Array.isArray(e.pressures) || e.pressures.length !== e.points.length)
			)
				throw new AppError(
					'INVALID_DATA',
					'Pressure-sensitive strokes need a pressure value for each point.',
				);
			if (Array.isArray(e.pressures))
				for (const pressure of e.pressures) finite(pressure, 'Pressure', 0, 1);
		}
		if (pointCount > 100000)
			throw new AppError('INVALID_DATA', 'Keep the scene under 100,000 stroke points.');
		return structuredClone(e) as ExcalidrawElement;
	});
	const rawFiles = objectValue(data.files ?? {});
	if (Object.keys(rawFiles).length > 100)
		throw new AppError('INVALID_DATA', 'Keep at most 100 embedded images.');
	const files: BinaryFiles = {};
	for (const [id, raw] of Object.entries(rawFiles)) {
		const file = objectValue(raw),
			url = boundedText(file.dataURL, 'Image data', 8_000_000);
		if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(url))
			throw new AppError(
				'INVALID_IMAGE',
				'Embedded images must be local PNG, JPEG, or WebP data URLs.',
			);
		if (file.id !== id) throw new AppError('INVALID_IMAGE', 'Image ID must match its file key.');
		files[id] = {
			id,
			mimeType: url.slice(5, url.indexOf(';')),
			dataURL: url,
			created: finite(file.created ?? 0, 'Image date', 0, Number.MAX_SAFE_INTEGER),
		} as BinaryFiles[string];
	}
	for (const e of elements)
		if (e.type === 'image' && !e.isDeleted && (!e.fileId || !files[e.fileId]))
			throw new AppError('INVALID_IMAGE', 'The scene is missing an embedded image.');
	const app = objectValue(data.appState ?? {});
	return {
		type: 'excalidraw',
		version: 2,
		source: 'deskintab',
		title: boundedText(data.title ?? 'Untitled', 'Title', 120),
		elements,
		appState: {
			viewBackgroundColor: safeColor(app.viewBackgroundColor ?? '#ffffff'),
			gridSize:
				app.gridSize === undefined || app.gridSize === null
					? null
					: finite(app.gridSize, 'Grid size', 1, 1000),
		},
		files,
	};
}
export async function nativeScene(file: CanvasFile): Promise<Scene> {
	const sdk = await loadCanvasSDK();
	if ('elements' in file)
		return {
			...file,
			elements: sdk.restoreElements(file.elements, null, { repairBindings: true }),
		};
	const nodes = file.objects.filter((o) => o.type !== 'connector');
	const skeletons: Record<string, unknown>[] = nodes.map((o) =>
		o.type === 'text'
			? {
					id: o.id,
					type: 'text',
					x: o.x,
					y: o.y,
					text: o.text,
					fontSize: o.fontSize ?? 22,
					fontFamily: 2,
					strokeColor: o.color ?? '#243247',
				}
			: {
					id: o.id,
					type: o.type === 'sticky' ? 'rectangle' : o.type,
					x: o.x,
					y: o.y,
					width: o.width,
					height: o.height,
					backgroundColor: o.fill,
					strokeColor: o.color,
					fillStyle: 'solid',
					roughness: 0,
					link: o.link,
					label: { text: o.text, fontSize: o.fontSize ?? 22, fontFamily: 2 },
				},
	);
	for (const o of file.objects.filter((o) => o.type === 'connector')) {
		const a = nodes.find((n) => n.id === o.from),
			b = nodes.find((n) => n.id === o.to);
		if (!a || !b) throw new AppError('INVALID_CONNECTOR', 'Connectors must link two nodes.');
		skeletons.push({
			id: o.id,
			...connectorSkeleton(a, b),
			strokeColor: o.color ?? '#64748b',
			...(o.text ? { label: { text: o.text } } : {}),
		});
	}
	return {
		...emptyScene(file.title),
		elements: sdk.convertToExcalidrawElements(
			skeletons as Parameters<typeof sdk.convertToExcalidrawElements>[0],
			{ regenerateIds: false },
		),
	};
}
export function sceneKey(scene: Scene) {
	return JSON.stringify({ elements: scene.elements, appState: scene.appState, files: scene.files });
}
export function connectorSkeleton(
	a: Record<string, unknown> | ExcalidrawElement,
	b: Record<string, unknown> | ExcalidrawElement,
) {
	const center = (e: typeof a) => [
		Number(e.x) + Number(e.width) / 2,
		Number(e.y) + Number(e.height) / 2,
	];
	const ac = center(a),
		bc = center(b);
	const edge = (e: typeof a, toward: number[]) => {
		const c = center(e),
			angle = Number(e.angle ?? 0),
			cos = Math.cos(angle),
			sin = Math.sin(angle),
			dx = toward[0] - c[0],
			dy = toward[1] - c[1];
		const lx = dx * cos + dy * sin,
			ly = -dx * sin + dy * cos,
			hw = Math.max(Number(e.width) / 2, 1),
			hh = Math.max(Number(e.height) / 2, 1);
		const factor =
			e.type === 'ellipse'
				? 1 / Math.sqrt((lx / hw) ** 2 + (ly / hh) ** 2)
				: e.type === 'diamond'
					? 1 / (Math.abs(lx) / hw + Math.abs(ly) / hh)
					: Math.min(hw / Math.max(Math.abs(lx), 0.001), hh / Math.max(Math.abs(ly), 0.001));
		const length = Math.hypot(dx, dy) || 1;
		return [c[0] + dx * factor + (dx / length) * 6, c[1] + dy * factor + (dy / length) * 6];
	};
	const start = edge(a, bc),
		end = edge(b, ac);
	return {
		type: 'arrow',
		x: start[0],
		y: start[1],
		points: [
			[0, 0],
			[end[0] - start[0], end[1] - start[1]],
		],
		start: { id: a.id },
		end: { id: b.id },
	};
}
