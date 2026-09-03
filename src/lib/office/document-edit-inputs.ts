import { AppError } from '../errors';
export type ExtendedDocumentOperation =
	| {
			type: 'text-range';
			index: number;
			start: number;
			end: number;
			text?: string;
			bold?: boolean;
			italic?: boolean;
			underline?: boolean;
			fontSize?: number;
			fontName?: string;
			color?: string;
			link?: string;
	  }
	| { type: 'insert-paragraph'; index: number; text: string; style?: string }
	| { type: 'move-paragraph'; index: number; delta: number }
	| {
			type: 'table-structure';
			table: string;
			action: 'insert' | 'remove';
			axis: 'rows' | 'columns';
			index: number;
			count: number;
	  }
	| {
			type: 'image';
			name: string;
			action: 'resize' | 'remove';
			widthMm?: number;
			heightMm?: number;
	  }
	| { type: 'page-layout'; widthMm: number; heightMm: number; marginMm: number };
const str = { type: 'string', minLength: 1, maxLength: 200 };
const integer = { type: 'integer', minimum: 0, maximum: 100000 };
const bool = { type: 'boolean' };
const size = { type: 'number', exclusiveMinimum: 0, maximum: 1000 };
function schema(type: string, required: string[], properties: Record<string, unknown>) {
	return {
		type: 'object',
		required: ['type', ...required],
		properties: { type: { const: type }, ...properties },
		additionalProperties: false,
	};
}
export const documentEditSchemas = [
	schema('text-range', ['index', 'start', 'end'], {
		index: integer,
		start: integer,
		end: integer,
		text: { type: 'string', maxLength: 50000 },
		bold: bool,
		italic: bool,
		underline: bool,
		fontSize: { type: 'number', minimum: 1, maximum: 300 },
		fontName: str,
		color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
		link: {
			type: 'string',
			maxLength: 2048,
			description: 'HTTP(S) URL or empty to remove hyperlink.',
		},
	}),
	schema('insert-paragraph', ['index', 'text'], {
		index: integer,
		text: { type: 'string', maxLength: 50000 },
		style: str,
	}),
	schema('move-paragraph', ['index', 'delta'], {
		index: integer,
		delta: { type: 'integer', minimum: -32767, maximum: 32767 },
	}),
	schema('table-structure', ['table', 'action', 'axis', 'index', 'count'], {
		table: str,
		action: { enum: ['insert', 'remove'] },
		axis: { enum: ['rows', 'columns'] },
		index: integer,
		count: { type: 'integer', minimum: 1, maximum: 100 },
	}),
	schema('image', ['name', 'action'], {
		name: str,
		action: { enum: ['resize', 'remove'] },
		widthMm: size,
		heightMm: size,
	}),
	schema('page-layout', ['widthMm', 'heightMm', 'marginMm'], {
		widthMm: size,
		heightMm: size,
		marginMm: { type: 'number', minimum: 0, maximum: 400 },
	}),
];
export function extendedDocumentOperation(
	op: Record<string, unknown>,
): ExtendedDocumentOperation | undefined {
	const shape = documentEditSchemas.find((s) => s.properties.type.const === op.type);
	if (!shape) return;
	const invalid = (m: string): never => {
		throw new AppError('INVALID_INPUT', m);
	};
	for (const key of Object.keys(op))
		if (!(key in shape.properties)) invalid(`Unknown ${String(op.type)} field ${key}.`);
	for (const key of shape.required) if (op[key] === undefined) invalid(`Supply ${key}.`);
	for (const [key, value] of Object.entries(op)) {
		if (key === 'type') continue;
		const p = (shape.properties as Record<string, Record<string, unknown>>)[key];
		if (p.enum && !(p.enum as unknown[]).includes(value)) invalid(`Invalid ${key}.`);
		if (p.type === 'boolean' && typeof value !== 'boolean') invalid(`Invalid ${key}.`);
		if (
			p.type === 'string' &&
			(typeof value !== 'string' ||
				value.length > Number(p.maxLength ?? 50000) ||
				value.length < Number(p.minLength ?? 0))
		)
			invalid(`Invalid ${key}.`);
		if (
			(p.type === 'number' || p.type === 'integer') &&
			(typeof value !== 'number' ||
				!Number.isFinite(value) ||
				(p.type === 'integer' && !Number.isInteger(value)) ||
				value < Number(p.minimum ?? 0) ||
				value > Number(p.maximum ?? 100000) ||
				(p.exclusiveMinimum !== undefined && value <= Number(p.exclusiveMinimum)))
		)
			invalid(`Invalid ${key}.`);
	}
	if (op.type === 'text-range') {
		if (Number(op.end) < Number(op.start)) invalid('end must be at or after start.');
		if (!Object.keys(op).some((k) => !['type', 'index', 'start', 'end'].includes(k)))
			invalid('Supply replacement text or formatting.');
		if (op.color !== undefined && !/^#[0-9a-f]{6}$/i.test(String(op.color)))
			invalid('Use a #RRGGBB color.');
		if (op.link !== undefined && op.link !== '' && !/^https?:\/\/[^\s]+$/i.test(String(op.link)))
			invalid('Links must use HTTP(S), or empty to remove.');
	}
	if (
		op.type === 'image' &&
		op.action === 'resize' &&
		(op.widthMm === undefined || op.heightMm === undefined)
	)
		invalid('Resize requires widthMm and heightMm.');
	if (
		op.type === 'page-layout' &&
		Number(op.marginMm) * 2 >= Math.min(Number(op.widthMm), Number(op.heightMm))
	)
		invalid('Margins must leave space for page content.');
	return op as ExtendedDocumentOperation;
}
