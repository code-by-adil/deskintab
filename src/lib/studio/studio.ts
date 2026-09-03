import { studioViewContext } from './view';
import { AppError } from '../errors';
import type { ActivityActor } from '../activity/activity';
import {
	WorkspaceJson,
	appFilePath,
	boundedText,
	objectValue,
	type JsonRecord,
} from '../workspace/json-document';
import { normalizeWorkspacePath } from '../workspace/path';
import { textRevision } from '../workspace/text-revision';
import { workspaceService } from '../workspace/workspace';
import { renderExplorer } from './renderer';

export type AppColumn = { key: string; label: string };
export type StudioInput = {
	title: string;
	description: string;
	view: 'cards' | 'table';
	dataPath: string;
	columns: AppColumn[];
	titleField: string;
	filterField: string | null;
	sourceField: string | null;
	sourcePaths: string[];
};
export type StudioFile = StudioInput & {
	format: 'webmcp-app';
	version: 1;
};
export type StudioRow = Record<string, string | number | boolean | null>;
export type StudioSource = { path: string; exists: boolean };
export type StudioPreview = {
	app: StudioFile;
	rows: StudioRow[];
	path: string;
	manifestRevision: string;
	dataRevision: string;
	rowCount: number;
	sources: StudioSource[];
	token: string;
	srcdoc: string;
};
type Options = { actor?: ActivityActor; signal?: AbortSignal };
const MAX_DATA_BYTES = 512_000;
const MAX_ROWS = 1000;
const fields = [
	'title',
	'description',
	'view',
	'dataPath',
	'columns',
	'titleField',
	'filterField',
	'sourceField',
	'sourcePaths',
] as const;

function strict(value: unknown, allowed: readonly string[]) {
	const object = objectValue(value);
	for (const key of Object.keys(object)) {
		if (!allowed.includes(key))
			throw new AppError(
				'INVALID_DATA',
				`Unknown app field ${key}. Apps contain data and layout settings, not executable code.`,
			);
	}
	return object;
}
function field(value: unknown) {
	const key = boundedText(value, 'Field name', 80);
	if (
		!/^[a-zA-Z][a-zA-Z0-9_ -]*$/.test(key) ||
		['constructor', 'prototype', '__proto__'].includes(key)
	)
		throw new AppError(
			'INVALID_DATA',
			'Field names must start with a letter and use letters, numbers, spaces, underscores, or hyphens.',
		);
	return key;
}
export function studioLink(value: unknown) {
	const path = boundedText(value, 'File path', 2048);
	if (
		!path.startsWith('/') ||
		/[\u0000-\u001f\\]/.test(path) ||
		path.split('/').some((part) => part === '..' || part === '.')
	)
		throw new AppError(
			'INVALID_PATH',
			'Use an absolute workspace path without traversal segments.',
		);
	const normalized = normalizeWorkspacePath(path);
	if (/^\/(System|Trash)(\/|$)/.test(normalized) || normalized === '/')
		throw new AppError('INVALID_PATH', 'Choose a file outside System and Trash.');
	return normalized;
}
export const isStudioPath = (path: string) => path.endsWith('.app.json');
function appPath(path: string) {
	return appFilePath(studioLink(path), '.app.json');
}
export function parseStudioFile(value: unknown): StudioFile {
	const object = strict(value, ['format', 'version', ...fields]);
	if (object.format !== 'webmcp-app' || object.version !== 1)
		throw new AppError('INVALID_DATA', 'Expected a webmcp-app file with version 1.');
	if (object.view !== 'cards' && object.view !== 'table')
		throw new AppError('INVALID_DATA', 'App view must be cards or table.');
	if (!Array.isArray(object.columns) || object.columns.length < 1 || object.columns.length > 12)
		throw new AppError('INVALID_DATA', 'Choose between 1 and 12 columns.');
	const columns = object.columns.map((item) => {
		const column = strict(item, ['key', 'label']);
		const label = boundedText(column.label, 'Column label', 80);
		if (/[\r\n]/.test(label))
			throw new AppError('INVALID_DATA', 'Column labels must fit on one line.');
		return { key: field(column.key), label };
	});
	if (new Set(columns.map((column) => column.key)).size !== columns.length)
		throw new AppError('INVALID_DATA', 'Column keys must be unique.');
	const titleField = field(object.titleField);
	const filterField = object.filterField === null ? null : field(object.filterField);
	const sourceField = object.sourceField === null ? null : field(object.sourceField);
	if (
		![titleField, filterField].every(
			(key) => key === null || columns.some((column) => column.key === key),
		)
	)
		throw new AppError('INVALID_DATA', 'Title and filter fields must name a selected column.');
	if (!Array.isArray(object.sourcePaths) || object.sourcePaths.length > 100)
		throw new AppError('INVALID_DATA', 'Select at most 100 source files.');
	const sourcePaths = object.sourcePaths.map(studioLink);
	if (new Set(sourcePaths).size !== sourcePaths.length)
		throw new AppError('INVALID_DATA', 'Source paths must be unique.');
	return {
		format: 'webmcp-app',
		version: 1,
		title: boundedText(object.title, 'App title', 160),
		description: boundedText(object.description, 'Description', 2000, true),
		view: object.view,
		dataPath: appFilePath(studioLink(object.dataPath), '.json'),
		columns,
		titleField,
		filterField,
		sourceField,
		sourcePaths,
	};
}
const emptyApp = (): StudioFile => ({
	format: 'webmcp-app',
	version: 1,
	title: 'My explorer',
	description: '',
	view: 'cards',
	dataPath: '/Documents/data.json',
	columns: [{ key: 'title', label: 'Title' }],
	titleField: 'title',
	filterField: null,
	sourceField: null,
	sourcePaths: [],
});
export const studioDocument = new WorkspaceJson<StudioFile>(
	'.app.json',
	'/Applications/My explorer/My explorer.app.json',
	'/System/studio-session.json',
	emptyApp,
	parseStudioFile,
	64_000,
);

async function dataFor(app: StudioFile) {
	const entry = await workspaceService.stat(app.dataPath);
	if (entry.kind !== 'file' || entry.size > MAX_DATA_BYTES)
		throw new AppError('INVALID_DATA', 'Choose a JSON data file smaller than 512 KB.');
	const content = await workspaceService.readText(app.dataPath);
	let data: unknown;
	try {
		data = JSON.parse(content);
	} catch {
		throw new AppError(
			'INVALID_DATA',
			`${app.dataPath} is not valid JSON. Repair the data file in Notepad.`,
		);
	}
	if (!Array.isArray(data) || data.length > MAX_ROWS)
		throw new AppError('INVALID_DATA', `App data must be an array of at most ${MAX_ROWS} objects.`);
	const allowed = new Set(
		[...app.columns.map((column) => column.key), app.sourceField].filter(Boolean),
	);
	const rows: StudioRow[] = data.map((value, index) => {
		const object = objectValue(value);
		const row: StudioRow = Object.create(null);
		for (const key of allowed) {
			if (!key || !Object.hasOwn(object, key)) continue;
			const cell = object[key];
			if (
				cell !== null &&
				typeof cell !== 'string' &&
				typeof cell !== 'boolean' &&
				(typeof cell !== 'number' || !Number.isFinite(cell))
			)
				throw new AppError(
					'INVALID_DATA',
					`Row ${index + 1}, field ${key} must contain text, a number, a boolean, or null.`,
				);
			if (typeof cell === 'string' && cell.length > 12_000)
				throw new AppError(
					'INVALID_DATA',
					`Row ${index + 1}, field ${key} exceeds 12,000 characters.`,
				);
			row[key] = cell as StudioRow[string];
		}
		return row;
	});
	return { rows, revision: await textRevision(content) };
}
async function inspectSources(app: StudioFile) {
	return Promise.all(
		app.sourcePaths.map(async (path) => {
			try {
				return { path, exists: (await workspaceService.stat(path)).kind === 'file' };
			} catch {
				return { path, exists: false };
			}
		}),
	);
}
function guardDraft(path: string, options: Options) {
	if (options.actor === 'agent' && studioDocument.hasPendingEdits(path))
		throw new AppError(
			'OPEN_DRAFT',
			'This app has unsaved settings in Studio. Save or discard them before the agent changes this app.',
		);
}
async function read(path?: string) {
	const record = await studioDocument.read(path);
	const sources = await inspectSources(record.data);
	try {
		const data = await dataFor(record.data);
		return {
			...record,
			sources,
			dataFile: {
				path: record.data.dataPath,
				revision: data.revision,
				rowCount: data.rows.length,
				error: '',
			},
		};
	} catch (error) {
		return {
			...record,
			sources,
			dataFile: {
				path: record.data.dataPath,
				revision: null,
				rowCount: 0,
				error: error instanceof Error ? error.message : String(error),
			},
		};
	}
}
async function list() {
	await workspaceService.ready();
	const paths = workspaceService
		.getAllPaths()
		.filter((path) => isStudioPath(path) && !/^\/(System|Trash)\//.test(path))
		.sort();
	const apps: Array<{
		path: string;
		title: string;
		description: string;
		view: StudioFile['view'];
		dataPath: string;
	}> = [];
	const warnings: string[] = [];
	for (const path of paths.slice(0, 100)) {
		try {
			const { data } = await studioDocument.read(path);
			apps.push({
				path,
				title: data.title,
				description: data.description,
				view: data.view,
				dataPath: data.dataPath,
			});
		} catch (error) {
			warnings.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { apps, warnings, truncated: paths.length > 100 };
}
async function create(path: string, input: StudioInput, options: Options = {}) {
	path = appPath(path);
	const data = parseStudioFile({ ...strict(input, fields), format: 'webmcp-app', version: 1 });
	await dataFor(data);
	options.signal?.throwIfAborted();
	return studioDocument.write(
		path,
		data,
		undefined,
		true,
		options.actor ?? 'human',
		options.signal,
	);
}
async function update(
	path: string,
	expectedRevision: string,
	changes: Partial<StudioInput>,
	options: Options = {},
) {
	path = appPath(path);
	guardDraft(path, options);
	if (!/^sha256:[a-f0-9]{64}$/.test(expectedRevision ?? ''))
		throw new AppError(
			'REVISION_REQUIRED',
			'Read studio_read and supply its revision as expectedRevision.',
		);
	const current = await studioDocument.read(path);
	const patch = strict(changes, fields);
	if (!Object.keys(patch).length)
		throw new AppError('INVALID_INPUT', 'Provide at least one app setting to change.');
	if (current.revision !== expectedRevision)
		throw new AppError('FILE_CHANGED', 'This app changed. Read studio_read again before saving.');
	const data = parseStudioFile({ ...current.data, ...patch });
	await dataFor(data);
	return studioDocument.write(
		path,
		data,
		expectedRevision,
		false,
		options.actor ?? 'human',
		options.signal,
		() => guardDraft(path, options),
	);
}
async function preview(path: string): Promise<StudioPreview> {
	const record = await studioDocument.read(appPath(path));
	const data = await dataFor(record.data);
	const sources = await inspectSources(record.data);
	const token = crypto.randomUUID();
	return {
		path: record.path,
		manifestRevision: record.revision,
		dataRevision: data.revision,
		rowCount: data.rows.length,
		sources,
		token,
		app: record.data,
		rows: data.rows,
		srcdoc: renderExplorer(record.data, data.rows, sources, token),
	};
}
async function initialize() {
	if (studioDocument.snapshot().path) return;
	const path = await studioDocument.resolvePath();
	if (await workspaceService.exists(path)) await studioDocument.open(path);
}

async function createStarter() {
	await workspaceService.ready();
	let folder = '/Applications/Feedback Explorer';
	for (let count = 2; await workspaceService.exists(folder); count++)
		folder = `/Applications/Feedback Explorer ${count}`;
	const dataPath = `${folder}/feedback.json`;
	const sourcePath = `${folder}/Interviews.md`;
	const rows = [
		{
			title: 'Keep articles for a flight',
			feature: 'Offline reading',
			sentiment: 'Request',
			quote: 'I save reading before boarding, then discover it needs a connection.',
			person: 'Maya',
			source: sourcePath,
		},
		{
			title: 'Make saved work easy to find',
			feature: 'Search',
			sentiment: 'Problem',
			quote: 'I remember a phrase, but not which folder I put the article in.',
			person: 'Jon',
			source: sourcePath,
		},
		{
			title: 'Readable in the evening',
			feature: 'Appearance',
			sentiment: 'Praise',
			quote: 'The quiet reading view makes a long article much easier on my eyes.',
			person: 'Alex',
			source: sourcePath,
		},
		{
			title: 'Show what is available offline',
			feature: 'Offline reading',
			sentiment: 'Request',
			quote: 'A saved indicator would tell me the download is ready before I leave.',
			person: 'Sam',
			source: sourcePath,
		},
	];
	await workspaceService.writeText(
		sourcePath,
		'# Sample reader interviews\n\nThese fictional interviews demonstrate App Studio.\n\n' +
			rows.map((row) => `## ${row.person}\n\n${row.quote}\n`).join('\n'),
		{ createOnly: true },
	);
	await workspaceService.writeText(dataPath, JSON.stringify(rows, null, 2) + '\n', {
		createOnly: true,
	});
	const result = await create(`${folder}/Feedback Explorer.app.json`, {
		title: 'Feedback Explorer',
		description: 'Find recurring themes and read the original interview quotes.',
		view: 'cards',
		dataPath,
		columns: [
			{ key: 'title', label: 'Finding' },
			{ key: 'feature', label: 'Feature' },
			{ key: 'sentiment', label: 'Signal' },
			{ key: 'quote', label: 'Quote' },
			{ key: 'person', label: 'Participant' },
		],
		titleField: 'title',
		filterField: 'feature',
		sourceField: 'source',
		sourcePaths: [sourcePath],
	});
	await studioDocument.open(result.path);
	return result;
}
export const studioService = {
	context: studioViewContext,
	document: studioDocument,
	list,
	read,
	create,
	update,
	preview,
	initialize,
	createStarter,
	open: (path: string) => studioDocument.open(appPath(path)),
};
export type StudioRecord = Awaited<ReturnType<typeof read>>;
export type StudioList = Awaited<ReturnType<typeof list>>;
export type StudioManifestRecord = JsonRecord<StudioFile>;
