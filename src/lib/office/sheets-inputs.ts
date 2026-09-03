import { AppError } from '../errors';
export type CellInput = string | number | null | { formula: string };
export type WorkbookSheet = { name: string; values: CellInput[][] };
export type RangeInput = { sheet?: string; range?: string; includeFormatting?: boolean };
export type SheetOperation =
	| {
			type: 'sheet';
			action: 'add' | 'rename' | 'remove' | 'move';
			sheet?: string;
			name?: string;
			index?: number;
	  }
	| {
			type: 'structure';
			sheet?: string;
			axis: 'rows' | 'columns';
			action: 'insert' | 'remove';
			index: number;
			count: number;
	  }
	| {
			type: 'sort';
			sheet?: string;
			range: string;
			column: number;
			ascending: boolean;
			header: boolean;
	  }
	| {
			type: 'filter';
			sheet?: string;
			range: string;
			column: number;
			value: string | number | null;
			header: boolean;
	  }
	| { type: 'merge'; sheet?: string; range: string; merge: boolean }
	| { type: 'cells'; sheet?: string; range: string; values: CellInput[][] }
	| {
			type: 'format';
			sheet?: string;
			range: string;
			bold?: boolean;
			italic?: boolean;
			underline?: boolean;
			fontSize?: number;
			fontName?: string;
			wrap?: boolean;
			align?: 'left' | 'center' | 'right';
			columnWidthMm?: number;
			rowHeightMm?: number;
			background?: string;
			color?: string;
			numberFormat?: string;
			autoFit?: boolean;
	  };
export type SheetChart = {
	sheet?: string;
	range?: string;
	name: string;
	title?: string;
	action: 'create' | 'update' | 'remove';
	kind?: 'column' | 'bar' | 'line' | 'pie' | 'area';
};

function invalid(message: string): never {
	throw new AppError('INVALID_INPUT', message);
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected an object.');
	return value as Record<string, unknown>;
}
export function sheetName(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		value.length > 31 ||
		/[\[\]:*?\/\\]/.test(value)
	)
		invalid('Use a sheet name of 1–31 characters without []:*?/\\.');
	return value;
}
export function sheetRange(value: unknown) {
	if (
		typeof value !== 'string' ||
		!/^[A-Z]{1,3}[1-9]\d{0,6}(:[A-Z]{1,3}[1-9]\d{0,6})?$/i.test(value)
	)
		invalid('Use a cell or rectangular range such as A1 or A1:D20; pass the sheet separately.');
	const parse = (cell: string) => {
		const [, column, row] = /^([A-Z]+)(\d+)$/.exec(cell.toUpperCase())!;
		return {
			column: [...column].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0),
			row: Number(row),
		};
	};
	const [start, end = start] = value.toUpperCase().split(':').map(parse);
	if (end.column < start.column || end.row < start.row || end.column > 16384 || end.row > 1048576)
		invalid('The range must be ordered and inside A1:XFD1048576.');
	const rows = end.row - start.row + 1,
		columns = end.column - start.column + 1;
	if (rows > 200 || columns > 50 || rows * columns > 2000)
		invalid('Use at most 200 rows, 50 columns and 2,000 cells per operation.');
	return { range: value.toUpperCase(), rows, columns };
}
export function cellValues(value: unknown): CellInput[][] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 200)
		invalid('Supply 1–200 rows.');
	const columns = Array.isArray(value[0]) ? value[0].length : 0;
	if (columns < 1 || columns > 50 || columns * value.length > 2000)
		invalid('Supply a rectangular matrix of at most 2,000 cells and 50 columns.');
	let total = 0;
	const result = value.map((row) => {
		if (!Array.isArray(row) || row.length !== columns)
			invalid('Every row must have the same number of cells.');
		return row.map((cell): CellInput => {
			if (cell === null || (typeof cell === 'number' && Number.isFinite(cell))) return cell;
			if (typeof cell === 'string') {
				total += cell.length;
				if (cell.length > 10000) invalid('Cell text is limited to 10,000 characters.');
				return cell;
			}
			const item = object(cell);
			if (
				Object.keys(item).length !== 1 ||
				typeof item.formula !== 'string' ||
				!item.formula.startsWith('=') ||
				item.formula.length > 2000
			)
				invalid('Cells accept text, finite numbers, null to clear, or {formula: "=SUM(B2:B5)"}.');
			if (/\b(WEBSERVICE|DDE|HYPERLINK|RTD)\s*\(|https?:|file:|\[|\]/i.test(item.formula))
				invalid('Use local workbook formulas without external links or network functions.');
			total += item.formula.length;
			return { formula: item.formula };
		});
	});
	if (total > 100000) invalid('Cell content is limited to 100,000 characters per operation.');
	return result;
}
export function workbookSheets(value: unknown): WorkbookSheet[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 8) invalid('Supply 1–8 sheets.');
	const names = new Set<string>();
	return value.map((item) => {
		const data = object(item),
			name = sheetName(data.name);
		if (names.has(name.toLowerCase())) invalid('Sheet names must be unique.');
		names.add(name.toLowerCase());
		return { name, values: cellValues(data.values) };
	});
}
function scope(input: Record<string, unknown>) {
	return input.sheet === undefined ? {} : { sheet: sheetName(input.sheet) };
}
export function rangeInput(value: unknown): RangeInput {
	const input = object(value);
	if (input.includeFormatting !== undefined && typeof input.includeFormatting !== 'boolean')
		invalid('includeFormatting must be boolean.');
	return {
		...scope(input),
		includeFormatting: input.includeFormatting as boolean | undefined,
		...(input.range !== undefined ? { range: sheetRange(input.range).range } : {}),
	};
}
export function sheetOperation(value: unknown): SheetOperation {
	const input = object(value),
		target = scope(input);
	const integer = (key: string, max: number, fallback?: number) => {
		const n = input[key] ?? fallback;
		if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > max)
			invalid(`Invalid ${key}.`);
		return n;
	};
	const bool = (key: string, fallback: boolean) => {
		const b = input[key] ?? fallback;
		if (typeof b !== 'boolean') invalid(`Invalid ${key}.`);
		return b;
	};
	if (input.type === 'sheet') {
		if (!['add', 'rename', 'remove', 'move'].includes(String(input.action)))
			invalid('Unknown sheet action.');
		const action = input.action as 'add' | 'rename' | 'remove' | 'move';
		return {
			type: 'sheet',
			action,
			...target,
			...(['add', 'rename'].includes(action) ? { name: sheetName(input.name) } : {}),
			...(['add', 'move'].includes(action)
				? { index: integer('index', 1000, action === 'add' ? 0 : undefined) }
				: {}),
		};
	}
	if (input.type === 'structure') {
		if (
			!['rows', 'columns'].includes(String(input.axis)) ||
			!['insert', 'remove'].includes(String(input.action))
		)
			invalid('Choose rows/columns and insert/remove.');
		const count = integer('count', 100);
		if (!count) invalid('count must be positive.');
		return {
			type: 'structure',
			...target,
			axis: input.axis as 'rows' | 'columns',
			action: input.action as 'insert' | 'remove',
			index: integer('index', input.axis === 'rows' ? 1048575 : 16383),
			count,
		};
	}
	const range = sheetRange(input.range);
	if (input.type === 'sort')
		return {
			type: 'sort',
			...target,
			range: range.range,
			column: integer('column', range.columns - 1),
			ascending: bool('ascending', true),
			header: bool('header', true),
		};
	if (input.type === 'filter') {
		const value = input.value;
		if (
			value !== null &&
			typeof value !== 'string' &&
			(typeof value !== 'number' || !Number.isFinite(value))
		)
			invalid('Filter value must be text or number, or null to clear.');
		if (typeof value === 'string' && value.length > 10000) invalid('Filter value is too long.');
		return {
			type: 'filter',
			...target,
			range: range.range,
			column: integer('column', range.columns - 1, 0),
			value: value as string | number | null,
			header: bool('header', true),
		};
	}
	if (input.type === 'merge')
		return { type: 'merge', ...target, range: range.range, merge: bool('merge', true) };

	if (input.type === 'cells') {
		const values = cellValues(input.values);
		if (values.length !== range.rows || values[0].length !== range.columns)
			invalid('The values matrix must exactly match the target range dimensions.');
		return { type: 'cells', ...target, range: range.range, values };
	}
	if (input.type !== 'format') invalid('Use a cells or format operation.');
	const style: Omit<Extract<SheetOperation, { type: 'format' }>, 'type' | 'range'> = {};
	for (const key of ['italic', 'underline', 'wrap'] as const)
		if (input[key] !== undefined) style[key] = bool(key, false);
	for (const key of ['fontSize', 'columnWidthMm', 'rowHeightMm'] as const)
		if (input[key] !== undefined) {
			const n = input[key];
			if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 500)
				invalid(`Invalid ${key}.`);
			style[key] = n;
		}
	if (input.fontName !== undefined) {
		if (typeof input.fontName !== 'string' || !input.fontName.trim() || input.fontName.length > 200)
			invalid('Invalid fontName.');
		style.fontName = input.fontName;
	}
	if (input.align !== undefined) {
		if (!['left', 'center', 'right'].includes(String(input.align))) invalid('Invalid alignment.');
		style.align = input.align as 'left' | 'center' | 'right';
	}
	if (input.bold !== undefined) {
		if (typeof input.bold !== 'boolean') invalid('bold must be true or false.');
		style.bold = input.bold;
	}
	if (input.autoFit !== undefined) {
		if (typeof input.autoFit !== 'boolean') invalid('autoFit must be true or false.');
		style.autoFit = input.autoFit;
	}
	for (const key of ['background', 'color'] as const)
		if (input[key] !== undefined) {
			if (typeof input[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(input[key]))
				invalid(`${key} must be a #RRGGBB color.`);
			style[key] = input[key];
		}
	if (input.numberFormat !== undefined) {
		if (
			typeof input.numberFormat !== 'string' ||
			!input.numberFormat ||
			input.numberFormat.length > 100
		)
			invalid('numberFormat must be a Calc format of 1–100 characters, such as #,##0.00.');
		style.numberFormat = input.numberFormat;
	}
	if (!Object.keys(style).length) invalid('Specify at least one formatting property.');
	return { type: 'format', ...target, range: range.range, ...style };
}
export function sheetChart(value: unknown): SheetChart {
	const input = object(value),
		target = scope(input),
		action = input.action ?? 'create';
	if (!['create', 'update', 'remove'].includes(String(action))) invalid('Unknown chart action.');
	if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100)
		invalid('Supply a chart name up to 100 characters.');
	if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 200))
		invalid('Chart title is limited to 200 characters.');
	if (
		input.kind !== undefined &&
		!['column', 'bar', 'line', 'pie', 'area'].includes(String(input.kind))
	)
		invalid('Unknown chart kind.');
	let range;
	if (action === 'create' || input.range !== undefined) {
		const r = sheetRange(input.range);
		if (r.rows < 2 || r.columns < 2)
			invalid('Chart data needs headers and at least two rows and columns.');
		range = r.range;
	}
	if (
		action === 'update' &&
		range === undefined &&
		input.kind === undefined &&
		input.title === undefined
	)
		invalid('Supply range, kind or title to update.');
	return {
		...target,
		action: action as SheetChart['action'],
		name: input.name,
		...(range ? { range } : {}),
		...(input.kind === undefined ? {} : { kind: input.kind as SheetChart['kind'] }),
		...(input.title === undefined ? {} : { title: String(input.title) }),
	};
}
