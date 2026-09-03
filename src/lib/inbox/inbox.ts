import { AppError } from '../errors';
import { activityService, type ActivityActor } from '../activity/activity';
import {
	WorkspaceJson,
	appFilePath,
	boundedText,
	objectValue,
	type JsonRecord,
} from '../workspace/json-document';
import { normalizeWorkspacePath } from '../workspace/path';
import { workspaceService } from '../workspace/workspace';
import { projectsDocument } from '../projects/projects';

export const INBOX_STATES = ['new', 'filed', 'done'] as const;
export const INBOX_MAX_FILES = 20;
export const INBOX_MAX_FILE_BYTES = 10_000_000;
export const INBOX_MAX_TOTAL_BYTES = 25_000_000;
export type InboxState = (typeof INBOX_STATES)[number];
export type InboxAttachment = { name: string; path: string; size: number };
export type InboxFile = {
	format: 'webmcp-inbox';
	version: 1;
	id: string;
	title: string;
	request: string;
	state: InboxState;
	sourceUrl: string | null;
	notePath: string | null;
	attachments: InboxAttachment[];
	projectPath: string | null;
	outputPaths: string[];
	createdAt: string;
	updatedAt: string;
};
export type InboxUpload = { name: string; bytes: Uint8Array };
export type InboxCreateInput = {
	title: string;
	request: string;
	note?: string;
	sourceUrl?: string | null;
	projectPath?: string | null;
	files?: InboxUpload[];
};
export type InboxChanges = Partial<
	Pick<InboxFile, 'title' | 'request' | 'state' | 'projectPath' | 'outputPaths'>
>;
export type InboxRecord = JsonRecord<InboxFile>;
export type InboxSummary = Pick<
	InboxFile,
	'id' | 'title' | 'state' | 'createdAt' | 'updatedAt' | 'projectPath'
> & {
	path: string;
	request: string;
	attachmentCount: number;
};
type Options = { actor?: ActivityActor; signal?: AbortSignal };
export const isInboxPath = (path: string) => path.endsWith('.inbox.json');

function strict(value: unknown, keys: readonly string[]) {
	const object = objectValue(value);
	for (const key of Object.keys(object))
		if (!keys.includes(key))
			throw new AppError('INVALID_INPUT', `Unknown Inbox field ${key}. Check the tool schema.`);
	return object;
}
function array(value: unknown, name: string, max: number): unknown[] {
	if (!Array.isArray(value) || value.length > max)
		throw new AppError('INVALID_INPUT', `${name} must be an array with at most ${max} items.`);
	return value;
}
function pathValue(value: unknown): string {
	const path = boundedText(value, 'File path', 2048);
	if (!path.startsWith('/') || path.startsWith('//') || /[\u0000-\u001f\u007f\\]/.test(path))
		throw new AppError(
			'INVALID_PATH',
			'Use an absolute workspace path without control characters.',
		);
	const normalized = normalizeWorkspacePath(path);
	if (normalized === '/' || /^\/(System|Trash)(\/|$)/.test(normalized))
		throw new AppError('INVALID_PATH', 'Choose a workspace file outside System and Trash.');
	return normalized;
}
function nullablePath(value: unknown) {
	return value === null || value === undefined || value === '' ? null : pathValue(value);
}
function filename(value: unknown) {
	const name = boundedText(value, 'Filename', 200);
	if (['.', '..'].includes(name) || /[\u0000-\u001f\u007f/\\]/.test(name) || name.trim() !== name)
		throw new AppError(
			'INVALID_FILENAME',
			'Use a filename without folders, control characters, or surrounding spaces.',
		);
	return name;
}
function urlValue(value: unknown) {
	if (value === null || value === undefined || value === '') return null;
	const text = boundedText(value, 'Source URL', 2048);
	try {
		const url = new URL(text);
		if (
			!/^https?:\/\//i.test(text) ||
			!['http:', 'https:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			/[\u0000-\u001f\u007f\\]/.test(text)
		)
			throw new Error();
		return url.href;
	} catch {
		throw new AppError('INVALID_URL', 'Use an http(s) source URL without credentials.');
	}
}
function timestamp(value: unknown) {
	const text = boundedText(value, 'Timestamp', 40);
	if (!Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text)
		throw new AppError('INVALID_DATA', 'Inbox timestamps must be UTC ISO dates.');
	return text;
}
function stateValue(value: unknown): InboxState {
	if (typeof value !== 'string' || !INBOX_STATES.includes(value as InboxState))
		throw new AppError('INVALID_STATE', 'Status must be new, filed, or done.');
	return value as InboxState;
}
function outputList(value: unknown) {
	const result = array(value, 'Output files', 20).map(pathValue);
	if (new Set(result).size !== result.length)
		throw new AppError('INVALID_INPUT', 'Output file paths must be unique.');
	return result;
}
export function parseInbox(value: unknown): InboxFile {
	const item = strict(value, [
		'format',
		'version',
		'id',
		'title',
		'request',
		'state',
		'sourceUrl',
		'notePath',
		'attachments',
		'projectPath',
		'outputPaths',
		'createdAt',
		'updatedAt',
	]);
	if (item.format !== 'webmcp-inbox' || item.version !== 1)
		throw new AppError('INVALID_DATA', 'Expected a version 1 webmcp-inbox request.');
	const attachments = array(item.attachments, 'Attachments', INBOX_MAX_FILES).map((raw) => {
		const file = strict(raw, ['name', 'path', 'size']);
		if (
			typeof file.size !== 'number' ||
			!Number.isInteger(file.size) ||
			file.size < 0 ||
			file.size > INBOX_MAX_FILE_BYTES
		)
			throw new AppError('INVALID_DATA', 'Attachment sizes must be between 0 and 10 MB.');
		return { name: filename(file.name), path: pathValue(file.path), size: file.size };
	});
	if (
		new Set(attachments.map((file) => file.path)).size !== attachments.length ||
		new Set(attachments.map((file) => file.name)).size !== attachments.length
	)
		throw new AppError('INVALID_DATA', 'Attachments must have unique names and paths.');
	if (attachments.reduce((total, file) => total + file.size, 0) > INBOX_MAX_TOTAL_BYTES)
		throw new AppError('FILE_TOO_LARGE', 'Keep request attachments under 25 MB in total.');
	const result: InboxFile = {
		format: 'webmcp-inbox',
		version: 1,
		id: boundedText(item.id, 'Request ID', 80),
		title: boundedText(item.title, 'Request title', 160),
		request: boundedText(item.request, 'Request', 6000),
		state: stateValue(item.state),
		sourceUrl: urlValue(item.sourceUrl),
		notePath: nullablePath(item.notePath),
		attachments,
		projectPath: nullablePath(item.projectPath),
		outputPaths: outputList(item.outputPaths),
		createdAt: timestamp(item.createdAt),
		updatedAt: timestamp(item.updatedAt),
	};
	if (result.projectPath && !result.projectPath.endsWith('.project.json'))
		throw new AppError('INVALID_PATH', 'Project file must end in .project.json.');
	if (result.state === 'filed' && !result.projectPath)
		throw new AppError('PROJECT_REQUIRED', 'Choose a project before marking this request filed.');
	if (result.state === 'done' && !result.outputPaths.length)
		throw new AppError('OUTPUT_REQUIRED', 'Link a saved output before marking this request done.');
	return result;
}

export const inboxDocument = new WorkspaceJson<InboxFile>(
	'.inbox.json',
	'/Inbox/Request.inbox.json',
	'/System/inbox-session.json',
	() => {
		throw new AppError('REQUEST_REQUIRED', 'Add an Inbox request first.');
	},
	parseInbox,
	200_000,
);
function guardDraft(path: string, options: Options) {
	if (options.actor === 'agent' && inboxDocument.hasPendingEdits(path))
		throw new AppError(
			'OPEN_DRAFT',
			'This request has unsaved edits in Inbox.',
			'Save or discard the draft, then read inbox_read for a fresh revision.',
		);
}
async function checkLinks(data: Pick<InboxFile, 'projectPath' | 'outputPaths'>) {
	if (data.projectPath) await projectsDocument.read(data.projectPath);
	for (const path of data.outputPaths) {
		if ((await workspaceService.stat(path)).kind !== 'file')
			throw new AppError('NOT_A_FILE', `${path} is not a file.`);
	}
}

export function decodeInboxUploads(value: unknown): InboxUpload[] {
	if (value === undefined) return [];
	let total = 0;
	return array(value, 'Files', INBOX_MAX_FILES).map((raw) => {
		const file = strict(raw, ['name', 'content', 'encoding']);
		const name = filename(file.name);
		const content = boundedText(
			file.content,
			'File content',
			Math.ceil(INBOX_MAX_FILE_BYTES / 3) * 4,
			true,
		);
		let bytes: Uint8Array;
		if (file.encoding === 'utf8') bytes = new TextEncoder().encode(content);
		else if (file.encoding === 'base64') {
			if (content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content))
				throw new AppError('INVALID_INPUT', 'Binary file content must be valid padded base64.');
			const decoded = atob(content);
			bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
		} else throw new AppError('INVALID_INPUT', 'File encoding must be utf8 or base64.');
		total += bytes.length;
		if (bytes.length > INBOX_MAX_FILE_BYTES || total > INBOX_MAX_TOTAL_BYTES)
			throw new AppError('FILE_TOO_LARGE', 'Use at most 10 MB per file and 25 MB per request.');
		return { name, bytes };
	});
}

export const inboxService = {
	document: inboxDocument,
	async list() {
		await workspaceService.ready();
		const paths = workspaceService
			.getAllPaths()
			.filter((path) => isInboxPath(path) && !/^\/(System|Trash)(\/|$)/.test(path))
			.sort();
		const requests: InboxSummary[] = [],
			errors: Array<{ path: string; message: string }> = [];
		for (const path of paths.slice(0, 200)) {
			try {
				const { data } = await inboxDocument.read(path);
				requests.push({
					path,
					id: data.id,
					title: data.title,
					request: data.request.slice(0, 240),
					state: data.state,
					createdAt: data.createdAt,
					updatedAt: data.updatedAt,
					projectPath: data.projectPath,
					attachmentCount: data.attachments.length + (data.notePath ? 1 : 0),
				});
			} catch (error) {
				errors.push({ path, message: error instanceof Error ? error.message : String(error) });
			}
		}
		requests.sort(
			(a, b) =>
				INBOX_STATES.indexOf(a.state) - INBOX_STATES.indexOf(b.state) ||
				b.createdAt.localeCompare(a.createdAt),
		);
		return { requests, errors, truncated: paths.length > 200 };
	},
	async read(path: string) {
		const record = await inboxDocument.read(appFilePath(pathValue(path), '.inbox.json'));
		const paths = [
			...record.data.attachments.map((file) => file.path),
			record.data.notePath,
			record.data.projectPath,
			...record.data.outputPaths,
		].filter((path): path is string => path !== null);
		const links = await Promise.all(
			[...new Set(paths)].map(async (path) => {
				try {
					return { path, exists: (await workspaceService.stat(path)).kind === 'file' };
				} catch {
					return { path, exists: false };
				}
			}),
		);
		return { ...record, links };
	},
	async create(input: InboxCreateInput, options: Options = {}): Promise<InboxRecord> {
		const fields = strict(input, ['title', 'request', 'note', 'sourceUrl', 'projectPath', 'files']);
		const title = boundedText(fields.title, 'Request title', 160).trim();
		const request = boundedText(fields.request, 'Request', 6000).trim();
		const note =
			fields.note === undefined ? '' : boundedText(fields.note, 'Pasted notes', 100_000, true);
		const sourceUrl = urlValue(fields.sourceUrl),
			projectPath = nullablePath(fields.projectPath);
		const uploads = array(fields.files ?? [], 'Files', INBOX_MAX_FILES).map((raw) => {
			const file = strict(raw, ['name', 'bytes']);
			if (!(file.bytes instanceof Uint8Array) || file.bytes.length > INBOX_MAX_FILE_BYTES)
				throw new AppError('FILE_TOO_LARGE', 'Each imported file must contain at most 10 MB.');
			return { name: filename(file.name), bytes: file.bytes };
		});
		if (new Set(uploads.map((file) => file.name)).size !== uploads.length)
			throw new AppError('DUPLICATE_FILENAME', 'Each imported file needs a different filename.');
		if (uploads.reduce((total, file) => total + file.bytes.length, 0) > INBOX_MAX_TOTAL_BYTES)
			throw new AppError('FILE_TOO_LARGE', 'Keep imported files under 25 MB in total.');
		const id = crypto.randomUUID();
		const folder = `/Inbox/${
			title
				.replace(/[^\p{L}\p{N} ._-]/gu, '')
				.trim()
				.slice(0, 60) || 'Request'
		} ${id}`;
		const path = `${folder}/Request.inbox.json`,
			now = new Date().toISOString();
		const data = parseInbox({
			format: 'webmcp-inbox',
			version: 1,
			id,
			title,
			request,
			state: 'new',
			sourceUrl,
			notePath: note ? `${folder}/Notes.md` : null,
			attachments: uploads.map((file) => ({
				name: file.name,
				path: `${folder}/Files/${file.name}`,
				size: file.bytes.length,
			})),
			projectPath,
			outputPaths: [],
			createdAt: now,
			updatedAt: now,
		});
		await checkLinks(data);
		options.signal?.throwIfAborted();
		if (await workspaceService.exists(folder))
			throw new AppError(
				'PATH_EXISTS',
				'The request folder already exists. Try creating the request again.',
			);
		const actor = options.actor ?? 'human';
		let saved = false;
		try {
			for (let index = 0; index < uploads.length; index++) {
				options.signal?.throwIfAborted();
				await workspaceService.writeBytes(data.attachments[index].path, uploads[index].bytes, {
					actor,
					createOnly: true,
					beforeWrite: () => options.signal?.throwIfAborted(),
				});
				saved = true;
			}
			if (data.notePath) {
				options.signal?.throwIfAborted();
				await workspaceService.writeText(data.notePath, note, {
					actor,
					createOnly: true,
					beforeWrite: () => options.signal?.throwIfAborted(),
				});
				saved = true;
			}
			return await inboxDocument.write(path, data, undefined, true, actor, options.signal);
		} catch (error) {
			if (saved) {
				activityService.record({
					actor: 'system',
					action: 'Inbox import interrupted',
					detail: `Files already saved remain in ${folder}. Open the folder in Finder to recover them.`,
					path: folder,
				});
				throw new AppError(
					'IMPORT_INCOMPLETE',
					`The request could not be completed. Files already saved remain in ${folder}.`,
					error instanceof Error ? error.message : String(error),
				);
			}
			throw error;
		}
	},
	async update(
		path: string,
		expectedRevision: string,
		changes: InboxChanges,
		options: Options = {},
	): Promise<InboxRecord> {
		path = appFilePath(pathValue(path), '.inbox.json');
		const fields = strict(changes, ['title', 'request', 'state', 'projectPath', 'outputPaths']);
		if (!Object.keys(fields).length)
			throw new AppError('INVALID_INPUT', 'Supply at least one request change.');
		guardDraft(path, options);
		if (typeof expectedRevision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(expectedRevision))
			throw new AppError(
				'REVISION_REQUIRED',
				'Read inbox_read and use its revision before changing a request.',
			);
		const current = await inboxDocument.read(path);
		if (current.revision !== expectedRevision)
			throw new AppError(
				'FILE_CHANGED',
				'This request changed. Read inbox_read again before saving.',
			);
		const data = parseInbox({ ...current.data, ...fields, updatedAt: new Date().toISOString() });
		await checkLinks(data);
		return inboxDocument.write(
			path,
			data,
			expectedRevision,
			false,
			options.actor ?? 'human',
			options.signal,
			() => guardDraft(path, options),
		);
	},
};
