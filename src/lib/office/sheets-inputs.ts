import { AppError } from '../errors';
export type CellInput = string | number | null | { formula: string };
export type WorkbookSheet = { name: string; values: CellInput[][] };
export type RangeInput = { sheet?: string; range?: string };
export type SheetOperation =
	| { type: 'cells'; sheet?: string; range: string; values: CellInput[][] }
	| {
			type: 'format';
			sheet?: string;
			range: string;
			bold?: boolean;
			background?: string;
			color?: string;
			numberFormat?: string;
			autoFit?: boolean;
	  };
export type SheetChart = { sheet?: string; range: string; name: string; title?: string };

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
	return {
		...scope(input),
		...(input.range !== undefined ? { range: sheetRange(input.range).range } : {}),
	};
}
export function sheetOperation(value: unknown): SheetOperation {
	const input = object(value),
		target = scope(input),
		range = sheetRange(input.range);
	if (input.type === 'cells') {
		const values = cellValues(input.values);
		if (values.length !== range.rows || values[0].length !== range.columns)
			invalid('The values matrix must exactly match the target range dimensions.');
		return { type: 'cells', ...target, range: range.range, values };
	}
	if (input.type !== 'format') invalid('Use a cells or format operation.');
	const style: Omit<Extract<SheetOperation, { type: 'format' }>, 'type' | 'range'> = {};
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
		{ range, rows, columns } = sheetRange(input.range);
	if (rows < 2 || columns < 2)
		invalid('A column chart needs a header row, a label column, and numeric data.');
	if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100)
		invalid('Give the chart a name of 1–100 characters.');
	if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 200))
		invalid('Chart title is limited to 200 characters.');
	return {
		...target,
		range,
		name: input.name,
		...(input.title !== undefined ? { title: input.title as string } : {}),
	};
}
