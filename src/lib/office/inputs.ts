import { AppError } from '../errors';
import type { DocumentBlock, DocumentOperation } from './office';

function invalid(message: string): never {
	throw new AppError('INVALID_INPUT', message);
}
export function officeRevision(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
		invalid('Use the nonnegative revision returned by the latest document or workbook read.');
	return value;
}
function text(value: unknown, name: string, empty = true): string {
	if (typeof value !== 'string' || value.length > 50_000 || (!empty && !value.trim()))
		invalid(`${name} must be ${empty ? '' : 'nonempty '}text, up to 50,000 characters.`);
	return value;
}
export function documentBlocks(value: unknown): DocumentBlock[] {
	if (!Array.isArray(value) || value.length > 200)
		invalid('blocks must be an array of at most 200 paragraphs or tables.');
	if (JSON.stringify(value).length > 200_000)
		invalid('Document content exceeds 200,000 characters.');
	return value.map((block) => {
		if (block?.type === 'paragraph')
			return {
				type: 'paragraph',
				text: text(block.text, 'text'),
				...(block.style === undefined ? {} : { style: text(block.style, 'style', false) }),
			};
		if (block?.type === 'table') {
			const rows = block.rows;
			if (
				!Array.isArray(rows) ||
				!rows.length ||
				rows.length > 40 ||
				!Array.isArray(rows[0]) ||
				!rows[0].length ||
				rows[0].length > 10
			)
				invalid('Tables must have 1–40 rows and 1–10 columns.');
			const width = rows[0].length;
			if (!rows.every((row) => Array.isArray(row) && row.length === width))
				invalid('Every table row must have the same number of cells.');
			return { type: 'table', rows: rows.map((row) => row.map((cell) => text(cell, 'cell'))) };
		}
		return invalid('A block must have type paragraph or table.');
	});
}
export function documentOperation(value: unknown): DocumentOperation {
	if (!value || typeof value !== 'object') invalid('Provide an operation object.');
	const op = value as Record<string, unknown>;
	if (op.type === 'append') return { type: 'append', blocks: documentBlocks(op.blocks) };
	if (op.type === 'insert-image') {
		const imagePath = text(op.imagePath, 'imagePath', false);
		if (!imagePath.startsWith('/')) invalid('imagePath must be an absolute workspace path.');
		const position = op.position ?? 'end';
		if (position !== 'cursor' && position !== 'end') invalid('position must be cursor or end.');
		const description = text(op.description ?? '', 'description');
		if (description.length > 2000) invalid('Image description must be at most 2,000 characters.');
		return { type: 'insert-image', imagePath, position, description };
	}
	if (op.type === 'replace') {
		const count = op.expectedOccurrences ?? 1;
		if (!Number.isInteger(count) || Number(count) < 1 || Number(count) > 1000)
			invalid('expectedOccurrences must be between 1 and 1000.');
		return {
			type: 'replace',
			find: text(op.find, 'find', false),
			replace: text(op.replace, 'replace'),
			expectedOccurrences: Number(count),
		};
	}
	if (op.type === 'paragraph') {
		if (!Number.isInteger(op.index) || Number(op.index) < 0 || Number(op.index) > 100_000)
			invalid('Use a nonnegative paragraph index returned by documents_read.');
		if (op.text === undefined && op.style === undefined)
			invalid('Supply text or style for the paragraph.');
		return {
			type: 'paragraph',
			index: Number(op.index),
			...(op.text === undefined ? {} : { text: text(op.text, 'text') }),
			...(op.style === undefined ? {} : { style: text(op.style, 'style', false) }),
		};
	}
	if (op.type === 'table-cell') {
		const cell = text(op.cell, 'cell', false);
		if (!/^[A-Z]+[1-9][0-9]*$/.test(cell))
			invalid('Use a cell address such as A1 returned by documents_read.');
		return {
			type: 'table-cell',
			table: text(op.table, 'table', false),
			cell,
			text: text(op.text, 'text'),
		};
	}
	return invalid('operation.type must be replace, paragraph, table-cell, append, or insert-image.');
}
