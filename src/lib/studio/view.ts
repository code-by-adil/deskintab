import { AppError } from '../errors';
import type { StudioFile, StudioRow } from './studio';
export type StudioView = { query: string; filter: string | null; view: 'cards' | 'table' };
export type StudioViewInput = Partial<StudioView> & {
	reload?: boolean;
	offset?: number;
	limit?: number;
};
export function selectStudioRows(rows: StudioRow[], app: StudioFile, state: StudioView) {
	const text = (value: unknown) => (value == null ? '' : String(value));
	const query = state.query.trim().toLocaleLowerCase();
	return rows.filter(
		(row) =>
			(state.filter === null || !app.filterField || text(row[app.filterField]) === state.filter) &&
			(!query ||
				app.columns.some((column) => text(row[column.key]).toLocaleLowerCase().includes(query))),
	);
}
export function studioViewInput(input: Record<string, unknown>): StudioViewInput {
	const invalid = (message: string): never => {
		throw new AppError('INVALID_INPUT', message);
	};
	const result: StudioViewInput = {};
	if (input.query !== undefined) {
		if (typeof input.query !== 'string' || input.query.length > 1000)
			invalid('Search query must be text up to 1000 characters.');
		result.query = input.query as string;
	}
	if (input.filter !== undefined) {
		if (input.filter !== null && (typeof input.filter !== 'string' || input.filter.length > 12000))
			invalid('Filter must be text or null for all records.');
		result.filter = input.filter as string | null;
	}
	if (input.view !== undefined) {
		if (input.view !== 'cards' && input.view !== 'table') invalid('View must be cards or table.');
		result.view = input.view as StudioView['view'];
	}
	if (input.reload !== undefined) {
		if (typeof input.reload !== 'boolean') invalid('reload must be boolean.');
		result.reload = input.reload as boolean;
	}
	for (const key of ['offset', 'limit'] as const)
		if (input[key] !== undefined) {
			const n = input[key];
			if (
				typeof n !== 'number' ||
				!Number.isInteger(n) ||
				n < (key === 'limit' ? 1 : 0) ||
				n > (key === 'limit' ? 100 : 1000)
			)
				invalid(`Invalid ${key}.`);
			result[key] = n as number;
		}
	return result;
}
type Connection = {
	read: () => Record<string, unknown>;
	query: (input: StudioViewInput, signal: AbortSignal) => Promise<Record<string, unknown>>;
};
let connection: Connection | undefined;
export function connectStudioView(value: Connection) {
	connection = value;
	return () => {
		if (connection === value) connection = undefined;
	};
}
export const studioViewContext = () => connection?.read() ?? null;
export async function queryStudioView(input: Record<string, unknown>, signal: AbortSignal) {
	const parsed = studioViewInput(input),
		deadline = Date.now() + 10000;
	while (!connection) {
		signal.throwIfAborted();
		if (Date.now() > deadline) throw new AppError('APP_NOT_READY', 'Open App Studio and retry.');
		await new Promise((r) => setTimeout(r, 20));
	}
	return connection.query(parsed, signal);
}
