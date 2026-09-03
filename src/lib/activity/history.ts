import { AppError } from '../errors';
import { fs } from '@zenfs/core';
import type { ActivityActor } from './activity';
import { normalizeWorkspacePath } from '../workspace/path';
import { CANVAS_MAX_BYTES } from '../workspace/limits';

// This is a journal in the SAME filesystem, not a second persistence backend.
// Call mutations only while holding workspaceService.mutate().
export const HISTORY_ROOT = '/System/review';
export const MAX_VERSION_BYTES = 5 * 1024 * 1024;
export const HISTORY_LIMITS = {
	versions: 100,
	bytes: 64 * 1024 * 1024,
	sessions: 60,
	snapshotBytes: MAX_VERSION_BYTES,
	canvasSnapshotBytes: CANVAS_MAX_BYTES,
};
const snapshotLimit = (path: string) =>
	/\.(excalidraw|canvas\.json)$/.test(path) ? CANVAS_MAX_BYTES : MAX_VERSION_BYTES;
export type FileVersion = {
	id: string;
	path: string;
	actor: ActivityActor;
	createdAt: string;
	status: 'prepared' | 'saved';
	before: { size: number; revision: string } | null;
	after: { size: number; revision: string };
	afterToken?: string;
	recovery: boolean;
	reason?: string;
};
export type WorkSession = {
	id: string;
	revision: number;
	actor: ActivityActor;
	createdAt: string;
	updatedAt: string;
	title: string;
	status: 'working' | 'completed';
	summary: string;
	questions: string[];
	results: string[];
	versionIds: string[];
	activities: Array<{
		id: string;
		actor: ActivityActor;
		action: string;
		detail: string;
		path?: string;
		createdAt: string;
	}>;
};
export async function bytesRevision(bytes: Uint8Array) {
	const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
	return `sha256:${Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('')}`;
}
function idPath(id: string) {
	if (!/^[0-9a-f-]{36}$/.test(id))
		throw new AppError('INVALID_INPUT', 'Invalid review identifier.');
	return `${HISTORY_ROOT}/versions/${id}`;
}
export function isHistoryPath(path: string) {
	const normalized = normalizeWorkspacePath(path);
	return normalized === HISTORY_ROOT || normalized.startsWith(`${HISTORY_ROOT}/`);
}
async function json(path: string): Promise<unknown> {
	const stat = await fs.promises.stat(path);
	if (stat.size > 200_000) throw new AppError('REVIEW_CORRUPT', 'Review metadata is too large.');
	return JSON.parse(await fs.promises.readFile(path, 'utf8'));
}
function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function timestamp(value: unknown): value is string {
	return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}
function actor(value: unknown): value is ActivityActor {
	return typeof value === 'string' && ['human', 'agent', 'terminal', 'system'].includes(value);
}
function snapshot(value: unknown): value is FileVersion['after'] {
	return (
		object(value) &&
		typeof value.size === 'number' &&
		Number.isSafeInteger(value.size) &&
		value.size >= 0 &&
		typeof value.revision === 'string' &&
		/^sha256:[a-f0-9]{64}$/.test(value.revision)
	);
}
function strings(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length <= 50 &&
		value.every((item) => typeof item === 'string' && item.trim() && item.length <= 2048)
	);
}
function activity(value: unknown): value is WorkSession['activities'][number] {
	return (
		object(value) &&
		typeof value.id === 'string' &&
		actor(value.actor) &&
		typeof value.action === 'string' &&
		typeof value.detail === 'string' &&
		(value.path === undefined || typeof value.path === 'string') &&
		timestamp(value.createdAt)
	);
}
function session(value: unknown, id: string): value is WorkSession {
	return (
		object(value) &&
		value.id === id &&
		typeof value.revision === 'number' &&
		Number.isSafeInteger(value.revision) &&
		value.revision >= 1 &&
		actor(value.actor) &&
		timestamp(value.createdAt) &&
		timestamp(value.updatedAt) &&
		typeof value.title === 'string' &&
		Boolean(value.title.trim()) &&
		value.title.length <= 120 &&
		(value.status === 'working' || value.status === 'completed') &&
		typeof value.summary === 'string' &&
		value.summary.length <= 4000 &&
		strings(value.questions) &&
		strings(value.results) &&
		strings(value.versionIds) &&
		Array.isArray(value.activities) &&
		value.activities.length <= 50 &&
		value.activities.every(activity)
	);
}
const listeners = new Set<() => void>();
export function subscribeHistory(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
export function notifyHistory() {
	for (const listener of listeners) listener();
}
export async function currentFile(path: string) {
	if (!(await fs.promises.exists(path))) return null;
	const stat = await fs.promises.lstat(path);
	// Never restore through symlinks or aliases of an existing hard-linked file.
	if (!stat.isFile() || stat.nlink > 1) return { revision: null, token: null };
	if ((await fs.promises.realpath(path)) !== path) return { revision: null, token: null };
	if (stat.size > snapshotLimit(path)) return { revision: null, token: null };
	const revision = await bytesRevision(new Uint8Array(await fs.promises.readFile(path)));
	const token = await bytesRevision(
		// ZenFS updates ctime when readFile persists atime; it is not a write token.
		new TextEncoder().encode(`${revision}:${stat.ino}:${stat.mtimeMs}`),
	);
	return { revision, token };
}
function version(data: unknown, id: string): data is FileVersion {
	return !(
		!object(data) ||
		data.id !== id ||
		typeof data.path !== 'string' ||
		!data.path.startsWith('/') ||
		isHistoryPath(data.path) ||
		!actor(data.actor) ||
		!timestamp(data.createdAt) ||
		(data.status !== 'prepared' && data.status !== 'saved') ||
		typeof data.recovery !== 'boolean' ||
		!snapshot(data.after) ||
		(data.before !== null && !snapshot(data.before)) ||
		(data.afterToken !== undefined &&
			(typeof data.afterToken !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(data.afterToken))) ||
		(data.reason !== undefined && typeof data.reason !== 'string') ||
		(!data.recovery && !data.reason)
	);
}
export async function readVersion(id: string): Promise<FileVersion> {
	const data = await json(`${idPath(id)}/version.json`);
	if (!version(data, id)) {
		throw new AppError(
			'REVIEW_CORRUPT',
			'This version has invalid metadata. The current file was not changed.',
		);
	}
	return data;
}
export async function listVersions() {
	const directory = `${HISTORY_ROOT}/versions`;
	if (!(await fs.promises.exists(directory)))
		return { versions: [] as FileVersion[], warnings: [] as string[] };
	const versions: FileVersion[] = [],
		warnings: string[] = [];
	for (const id of await fs.promises.readdir(directory)) {
		try {
			versions.push(await readVersion(id));
		} catch {
			warnings.push(`Version ${id} is unavailable or incomplete; its files were left untouched.`);
		}
	}
	versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
	return { versions, warnings };
}
export async function versionBytes(version: FileVersion, side: 'before' | 'after') {
	const expected = version[side];
	if (!version.recovery || !expected)
		throw new AppError('NO_RECOVERY_DATA', version.reason || 'This version has no previous file.');
	const path = `${idPath(version.id)}/${side}.bin`;
	if ((await fs.promises.stat(path)).size > snapshotLimit(version.path))
		throw new AppError('REVIEW_CORRUPT', 'Snapshot exceeds its size limit.');
	const bytes = new Uint8Array(await fs.promises.readFile(path));
	if (bytes.length !== expected.size || (await bytesRevision(bytes)) !== expected.revision)
		throw new AppError(
			'REVIEW_CORRUPT',
			'Snapshot integrity check failed. The current file was not changed.',
		);
	return bytes;
}
export async function prepareVersion(path: string, after: Uint8Array, actor: ActivityActor) {
	if (path === '/System' || path.startsWith('/System/') || path.startsWith('/Trash/')) return null;
	const existed = await fs.promises.exists(path);
	const stat = existed ? await fs.promises.lstat(path) : null;
	const limit = snapshotLimit(path);
	// A regular save can still proceed for large files; the limitation stays visible.
	const recovery =
		after.length <= limit &&
		(!stat ||
			(stat.isFile() &&
				stat.nlink <= 1 &&
				stat.size <= limit &&
				(await fs.promises.realpath(path)) === path));
	const before =
		stat?.isFile() && stat.size <= limit ? new Uint8Array(await fs.promises.readFile(path)) : null;
	const afterRevision = await bytesRevision(after);
	if (before && (await bytesRevision(before)) === afterRevision) return null;
	const version: FileVersion = {
		id: crypto.randomUUID(),
		path,
		actor,
		createdAt: new Date().toISOString(),
		status: 'prepared',
		before: before ? { size: before.length, revision: await bytesRevision(before) } : null,
		after: { size: after.length, revision: afterRevision },
		recovery,
		...(!recovery
			? {
					reason: `Recovery is limited to regular, unlinked files up to ${limit === CANVAS_MAX_BYTES ? '20 MB' : '5 MiB'} per snapshot. This save is recorded without recoverable contents.`,
				}
			: {}),
	};
	const directory = idPath(version.id);
	await fs.promises.mkdir(directory, { recursive: true });
	if (recovery) {
		if (before) await fs.promises.writeFile(`${directory}/before.bin`, before);
		await fs.promises.writeFile(`${directory}/after.bin`, after);
	}
	await fs.promises.writeFile(`${directory}/version.json`, JSON.stringify(version), 'utf8');
	return version;
}
export async function commitVersion(version: FileVersion | null) {
	if (!version) return;
	const current = await currentFile(version.path);
	version.status = 'saved';
	version.afterToken = current?.token ?? undefined;
	await fs.promises.writeFile(
		`${idPath(version.id)}/version.json`,
		JSON.stringify(version),
		'utf8',
	);
	notifyHistory();
	// Bounded rolling history. Never prune unconfirmed records automatically.
	const { versions } = await listVersions();
	let bytes = 0,
		count = 0;
	for (const item of versions) {
		if (item.status !== 'saved') continue;
		count++;
		bytes += item.recovery ? (item.before?.size ?? 0) + item.after.size : 0;
		if (count > HISTORY_LIMITS.versions || bytes > HISTORY_LIMITS.bytes)
			await fs.promises.rm(idPath(item.id), { recursive: true });
	}
}
export async function listSessions() {
	const directory = `${HISTORY_ROOT}/sessions`;
	const sessions: WorkSession[] = [];
	const warnings: string[] = [];
	if (!(await fs.promises.exists(directory))) return { sessions, warnings };
	for (const name of await fs.promises.readdir(directory)) {
		if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
		try {
			const data = await json(`${directory}/${name}`);
			if (!session(data, name.slice(0, -5))) throw new Error('Invalid work summary metadata.');
			sessions.push(data);
		} catch {
			warnings.push(`Work summary ${name} is unavailable or invalid; its file was left untouched.`);
		}
	}
	return { sessions: sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), warnings };
}
export async function saveSession(session: WorkSession) {
	const directory = `${HISTORY_ROOT}/sessions`;
	const serialized = JSON.stringify(session);
	if (new TextEncoder().encode(serialized).length > 200_000)
		throw new AppError(
			'SESSION_TOO_LARGE',
			'This summary exceeds 200 KB. Include fewer activity records or shorter notes.',
		);
	idPath(session.id);
	await fs.promises.mkdir(directory, { recursive: true });
	const temporary = `${directory}/${session.id}.tmp`;
	await fs.promises.writeFile(temporary, serialized, 'utf8');
	await fs.promises.rename(temporary, `${directory}/${session.id}.json`);
	notifyHistory();
}
