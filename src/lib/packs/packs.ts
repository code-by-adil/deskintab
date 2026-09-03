import { activityService, type ActivityActor } from '../activity/activity';
import { draftBlock } from '../activity/review';
import { AppError } from '../errors';
import { normalizeWorkspacePath, workspaceDirname } from '../workspace/path';
import { workspaceService, zenfs, lstatIfExists } from '../workspace/workspace';

export const PACK_LIMITS = { entries: 5_000, bytes: 32 * 1024 * 1024, textBytes: 48 * 1024 * 1024 };
export const PACK_OMISSIONS = ['/System', '/Trash', '*.desktop-pack.json'];
const FORMAT = 'webmcp-desktop-pack';

type PackEntry = { kind: 'directory'; path: string } | { kind: 'file'; path: string; data: string };
export type WorkspacePack = {
	format: typeof FORMAT;
	version: 1;
	createdAt: string;
	entries: PackEntry[];
	omitted: string[];
};
type DecodedPack = {
	pack: WorkspacePack;
	files: Map<string, Uint8Array>;
	directories: string[];
	totalBytes: number;
};
export type PackCollision = { path: string; reason: string; kind: 'file' | 'incompatible' };
export type PackPreview = {
	createdAt: string;
	files: number;
	directories: number;
	totalBytes: number;
	filesToCreate: number;
	directoriesToCreate: number;
	existingFiles: number;
	collisions: PackCollision[];
	canImport: boolean;
	canPreserve: boolean;
	omitted: string[];
};
export type PackImportResult = {
	status: 'imported' | 'blocked' | 'failed';
	createdFiles: string[];
	createdDirectories: string[];
	skippedFiles: number;
	collisions: PackCollision[];
	rolledBack: string[];
	remainingPaths: string[];
	preservedFiles: { from: string; to: string }[];
	restoredOriginals: string[];
	error?: string;
	warning?: string;
};
type PackOptions = { actor?: ActivityActor; signal?: AbortSignal };
type PackImportOptions = PackOptions & { conflictMode?: 'stop' | 'preserve' };

function invalid(message: string): never {
	throw new AppError(
		'INVALID_PACK',
		message,
		'Choose an unmodified .desktop-pack.json exported by this desktop.',
	);
}

function record(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value))
		invalid('Pack records must be objects.');
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
	if (Object.keys(value).some((key) => !keys.includes(key)))
		invalid('The pack contains an unknown field.');
}

function packPath(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!value.startsWith('/') ||
		value.length > 2048 ||
		value === '/' ||
		/[\\\u0000-\u001f\u007f]/.test(value) ||
		normalizeWorkspacePath(value) !== value
	) {
		invalid(
			'Every pack entry needs an exact, absolute workspace path without traversal or control characters.',
		);
	}
	if (
		value === '/System' ||
		value.startsWith('/System/') ||
		value === '/Trash' ||
		value.startsWith('/Trash/')
	) {
		invalid(`${value} is reserved and cannot be imported.`);
	}
	if (value.endsWith('.desktop-pack.json')) invalid('Packs cannot contain another workspace pack.');
	return value;
}

function bytesToBase64(bytes: Uint8Array): string {
	const chunks: string[] = [];
	for (let offset = 0; offset < bytes.length; offset += 32_768) {
		chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
	}
	return btoa(chunks.join(''));
}

function base64ToBytes(value: unknown): Uint8Array {
	if (typeof value !== 'string' || value.length % 4 !== 0)
		invalid('File data must be padded base64.');
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
	const body = value.slice(0, value.length - padding);
	const size = (value.length / 4) * 3 - padding;
	if (/[^A-Za-z0-9+/]/.test(body) || size < 0) invalid('A file contains invalid base64 data.');
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	if (
		(padding === 2 && (alphabet.indexOf(body.at(-1) ?? '') & 15) !== 0) ||
		(padding === 1 && (alphabet.indexOf(body.at(-1) ?? '') & 3) !== 0)
	)
		invalid('File data must use canonical base64.');
	if (size > PACK_LIMITS.bytes) invalid('The decoded pack exceeds 32 MiB.');
	let binary: string;
	try {
		binary = atob(value);
	} catch {
		invalid('A file contains invalid base64 data.');
	}
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

function parents(path: string) {
	const result: string[] = [];
	for (let parent = workspaceDirname(path); parent !== '/'; parent = workspaceDirname(parent))
		result.push(parent);
	return result;
}

function sortDirectories(paths: Iterable<string>) {
	return [...paths].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

function decodePack(text: string): DecodedPack {
	if (
		typeof text !== 'string' ||
		text.length > PACK_LIMITS.textBytes ||
		new TextEncoder().encode(text).length > PACK_LIMITS.textBytes
	) {
		invalid('The pack file exceeds 48 MiB.');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		invalid('The pack is not valid JSON.');
	}
	const value = record(parsed);
	exactKeys(value, ['format', 'version', 'createdAt', 'entries', 'omitted']);
	if (value.format !== FORMAT || value.version !== 1)
		invalid('This desktop supports workspace pack version 1.');
	if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)))
		invalid('The pack creation date is invalid.');
	if (!Array.isArray(value.entries) || value.entries.length > PACK_LIMITS.entries)
		invalid('A pack can contain at most 5,000 entries.');
	if (
		!Array.isArray(value.omitted) ||
		value.omitted.length !== PACK_OMISSIONS.length ||
		PACK_OMISSIONS.some((path, index) => value.omitted?.[index] !== path)
	)
		invalid('The pack omission declaration is invalid.');
	const files = new Map<string, Uint8Array>();
	const directories = new Set<string>();
	const seen = new Set<string>();
	const entries: PackEntry[] = [];
	let totalBytes = 0;
	for (const item of value.entries) {
		const entry = record(item);
		const path = packPath(entry.path);
		if (seen.has(path)) invalid(`The pack repeats ${path}.`);
		seen.add(path);
		if (entry.kind === 'file') {
			exactKeys(entry, ['kind', 'path', 'data']);
			const bytes = base64ToBytes(entry.data);
			totalBytes += bytes.length;
			if (totalBytes > PACK_LIMITS.bytes) invalid('The decoded pack exceeds 32 MiB.');
			files.set(path, bytes);
			entries.push({ kind: 'file', path, data: entry.data as string });
		} else if (entry.kind === 'directory') {
			exactKeys(entry, ['kind', 'path']);
			directories.add(path);
			entries.push({ kind: 'directory', path });
		} else invalid(`Unknown entry type at ${path}.`);
		for (const parent of parents(path)) directories.add(parent);
	}
	for (const path of directories)
		if (files.has(path)) invalid(`${path} is both a file and a parent folder.`);
	if (directories.size + files.size > PACK_LIMITS.entries)
		invalid('The pack and its parent folders exceed 5,000 entries.');
	return {
		pack: {
			format: FORMAT,
			version: 1,
			createdAt: value.createdAt,
			entries,
			omitted: [...PACK_OMISSIONS],
		},
		files,
		directories: sortDirectories(directories),
		totalBytes,
	};
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
	return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

async function preflight(
	decoded: DecodedPack,
): Promise<PackPreview & { newFiles: string[]; newDirectories: string[] }> {
	const collisions: PackCollision[] = [];
	const blocked = new Set<string>();
	const newDirectories: string[] = [];
	const newFiles: string[] = [];
	let existingFiles = 0;
	for (const path of decoded.directories) {
		if (parents(path).some((parent) => blocked.has(parent))) continue;
		const stats = await lstatIfExists(path);
		if (!stats) newDirectories.push(path);
		else if (!stats.isDirectory() || stats.isSymbolicLink()) {
			collisions.push({
				path,
				kind: 'incompatible',
				reason: 'A folder is needed here, but another item already exists.',
			});
			blocked.add(path);
		}
	}
	for (const [path, bytes] of decoded.files) {
		if (parents(path).some((parent) => blocked.has(parent))) continue;
		const stats = await lstatIfExists(path);
		if (
			stats &&
			stats.isFile() &&
			!stats.isSymbolicLink() &&
			stats.size === bytes.length &&
			equalBytes(new Uint8Array(await zenfs.promises.readFile(path)), bytes)
		)
			existingFiles++;
		else if (draftBlock(path)) {
			collisions.push({ path, kind: 'incompatible', reason: draftBlock(path)! });
		} else if (!stats) newFiles.push(path);
		else
			collisions.push({
				path,
				kind: stats.isFile() && !stats.isSymbolicLink() ? 'file' : 'incompatible',
				reason:
					stats.isFile() && !stats.isSymbolicLink()
						? 'A different file already exists. Keep both to preserve it before importing.'
						: 'A folder or symbolic link already exists where a file is needed.',
			});
	}
	return {
		createdAt: decoded.pack.createdAt,
		files: decoded.files.size,
		directories: decoded.directories.length,
		totalBytes: decoded.totalBytes,
		filesToCreate: newFiles.length,
		directoriesToCreate: newDirectories.length,
		existingFiles,
		collisions,
		canImport: collisions.length === 0,
		canPreserve:
			collisions.length > 0 && collisions.every((collision) => collision.kind === 'file'),
		omitted: [...PACK_OMISSIONS],
		newFiles,
		newDirectories,
	};
}

function previewOnly({
	newFiles: _files,
	newDirectories: _dirs,
	...preview
}: Awaited<ReturnType<typeof preflight>>): PackPreview {
	return preview;
}

async function readPack(path: string) {
	if (
		typeof path !== 'string' ||
		!path.endsWith('.desktop-pack.json') ||
		!path.startsWith('/') ||
		normalizeWorkspacePath(path) !== path
	) {
		invalid('Choose an absolute .desktop-pack.json path.');
	}
	await workspaceService.ready();
	const stats = await zenfs.promises.lstat(path);
	if (!stats.isFile() || stats.isSymbolicLink()) invalid('The pack path must be a regular file.');
	if (stats.size > PACK_LIMITS.textBytes) invalid('The pack file exceeds 48 MiB.');
	return zenfs.promises.readFile(path, 'utf8');
}

class PackService {
	async inspectPackText(text: string) {
		const decoded = decodePack(text);
		await workspaceService.ready();
		return workspaceService.mutate(async () => previewOnly(await preflight(decoded)));
	}

	async inspect(path: string) {
		return this.inspectPackText(await readPack(path));
	}

	async exportPack(options: PackOptions & { path?: string } = {}) {
		await workspaceService.ready();
		return workspaceService.mutate(async () => {
			options.signal?.throwIfAborted();
			const path =
				options.path ??
				`/Exports/workspace-${new Date().toISOString().replace(/[:.]/g, '-')}.desktop-pack.json`;
			if (!path.endsWith('.desktop-pack.json'))
				invalid('The export filename must end in .desktop-pack.json.');
			packPath(path.slice(0, -'.desktop-pack.json'.length) + '.json');
			if (await lstatIfExists(path))
				throw new AppError('PATH_EXISTS', `${path} already exists. Choose a new export filename.`);
			const entries: PackEntry[] = [];
			let totalBytes = 0;
			let files = 0;
			let directories = 0;
			let skippedPacks = 0;
			const walk = async (directory: string) => {
				for (const name of (await zenfs.promises.readdir(directory)).sort()) {
					options.signal?.throwIfAborted();
					const entryPath = directory === '/' ? `/${name}` : `${directory}/${name}`;
					if (entryPath === '/System' || entryPath === '/Trash') continue;
					if (entryPath.endsWith('.desktop-pack.json')) {
						skippedPacks++;
						continue;
					}
					packPath(entryPath);
					const stats = await zenfs.promises.lstat(entryPath);
					if (stats.isDirectory()) {
						entries.push({ kind: 'directory', path: entryPath });
						directories++;
					} else if (stats.isFile()) {
						if (totalBytes + stats.size > PACK_LIMITS.bytes)
							throw new AppError(
								'PACK_TOO_LARGE',
								'Workspace files exceed the 32 MiB pack limit. Download large files separately.',
							);
						const bytes = new Uint8Array(await zenfs.promises.readFile(entryPath));
						totalBytes += bytes.length;
						entries.push({ kind: 'file', path: entryPath, data: bytesToBase64(bytes) });
						files++;
					} else
						throw new AppError(
							'PACK_UNSUPPORTED_ENTRY',
							`${entryPath} is not a regular file or folder. Packs do not follow symbolic links.`,
						);
					if (entries.length > PACK_LIMITS.entries)
						throw new AppError(
							'PACK_TOO_LARGE',
							'Workspace files and folders exceed the 5,000 entry pack limit.',
						);
					if (stats.isDirectory()) await walk(entryPath);
				}
			};
			await walk('/');
			const pack: WorkspacePack = {
				format: FORMAT,
				version: 1,
				createdAt: new Date().toISOString(),
				entries,
				omitted: [...PACK_OMISSIONS],
			};
			const text = JSON.stringify(pack);
			if (new TextEncoder().encode(text).length > PACK_LIMITS.textBytes)
				throw new AppError(
					'PACK_TOO_LARGE',
					'The encoded workspace exceeds the 48 MiB pack limit.',
				);
			const newParents: string[] = [];
			for (const parent of sortDirectories(parents(path))) {
				const stats = await lstatIfExists(parent);
				if (!stats) newParents.push(parent);
				if (stats && (!stats.isDirectory() || stats.isSymbolicLink()))
					throw new AppError(
						'PACK_EXPORT_BLOCKED',
						`${parent} must be a regular folder to save the pack.`,
					);
			}
			options.signal?.throwIfAborted();
			const createdParents: string[] = [];
			let createdFile = false;
			try {
				for (const parent of newParents) {
					await zenfs.promises.mkdir(parent);
					createdParents.push(parent);
				}
				const handle = await zenfs.promises.open(path, 'wx');
				createdFile = true;
				try {
					await handle.writeFile(text);
				} finally {
					await handle.close();
				}
			} catch (error) {
				const remaining: string[] = [];
				if (createdFile) {
					try {
						await zenfs.promises.unlink(path);
					} catch {
						remaining.push(path);
					}
				}
				for (const parent of createdParents.reverse()) {
					try {
						await zenfs.promises.rmdir(parent);
					} catch {
						remaining.push(parent);
					}
				}
				throw new AppError(
					'PACK_EXPORT_FAILED',
					`Could not save ${path}. ${error instanceof Error ? error.message : String(error)} ${remaining.length ? `Inspect remaining new paths: ${remaining.join(', ')}.` : 'No new export items remain.'}`,
				);
			}
			let warning: string | undefined;
			try {
				await workspaceService.refresh();
			} catch {
				warning = 'The pack was saved, but the file list could not refresh. Reload to view it.';
			}
			activityService.record({
				actor: options.actor ?? 'human',
				action: 'Workspace exported',
				detail: `Saved ${files} files and ${directories} folders in a workspace pack. System data, Trash, and other packs were omitted.`,
				path,
			});
			return {
				path,
				files,
				directories,
				totalBytes,
				omitted: [...PACK_OMISSIONS],
				skippedPacks,
				...(warning ? { warning } : {}),
			};
		});
	}

	async importPack(path: string, options: PackImportOptions = {}) {
		return this.importPackText(await readPack(path), options);
	}

	async importPackText(text: string, options: PackImportOptions = {}): Promise<PackImportResult> {
		if (
			options.conflictMode !== undefined &&
			!['stop', 'preserve'].includes(options.conflictMode)
		) {
			throw new AppError('INVALID_INPUT', 'conflictMode must be stop or preserve.');
		}
		const decoded = decodePack(text);
		await workspaceService.ready();
		return workspaceService.mutate(async () => {
			options.signal?.throwIfAborted();
			let preview = await preflight(decoded);
			const result: PackImportResult = {
				status: 'blocked',
				createdFiles: [],
				createdDirectories: [],
				skippedFiles: preview.existingFiles,
				collisions: preview.collisions,
				rolledBack: [],
				remainingPaths: [],
				preservedFiles: [],
				restoredOriginals: [],
			};
			if (!preview.canImport && !(preview.canPreserve && options.conflictMode === 'preserve'))
				return result;
			const backupDirectories: string[] = [];
			let backups: { from: string; to: string }[] = [];
			if (preview.collisions.length) {
				const imports = await lstatIfExists('/Imports');
				if (
					(imports && (!imports.isDirectory() || imports.isSymbolicLink())) ||
					decoded.files.has('/Imports')
				) {
					throw new AppError(
						'PACK_BACKUP_BLOCKED',
						'Keep both needs /Imports to be a regular folder. Move that conflicting item aside in Finder first.',
					);
				}
				const backupRoot = `/Imports/Conflicts-${crypto.randomUUID()}`;
				if (
					(await lstatIfExists(backupRoot)) ||
					decoded.pack.entries.some(
						(entry) => entry.path === backupRoot || entry.path.startsWith(`${backupRoot}/`),
					)
				) {
					throw new AppError(
						'PACK_BACKUP_BLOCKED',
						'The backup folder already exists. Try importing again.',
					);
				}
				backups = preview.collisions.map(({ path }) => ({
					from: path,
					to: `${backupRoot}${path}`,
				}));
				if (backups.some(({ to }) => to.length > 2048))
					throw new AppError(
						'PACK_BACKUP_BLOCKED',
						'A conflicting path is too long to preserve in Imports. Move it aside in Finder first.',
					);
			}
			try {
				if (backups.length) {
					const neededParents = sortDirectories(new Set(backups.flatMap(({ to }) => parents(to))));
					for (const path of neededParents) {
						options.signal?.throwIfAborted();
						if (await lstatIfExists(path)) continue;
						await zenfs.promises.mkdir(path);
						backupDirectories.push(path);
					}
					for (const backup of backups) {
						options.signal?.throwIfAborted();
						const blocked = draftBlock(backup.from);
						if (blocked) throw new AppError('OPEN_DRAFT', blocked);
						await zenfs.promises.rename(backup.from, backup.to);
						result.preservedFiles.push(backup);
					}
					preview = await preflight(decoded);
					if (!preview.canImport)
						throw new AppError(
							'PACK_IMPORT_CHANGED',
							'Workspace paths changed during import. The original files will be restored.',
						);
					result.collisions = [];
				}
				for (const path of preview.newDirectories) {
					options.signal?.throwIfAborted();
					await zenfs.promises.mkdir(path);
					result.createdDirectories.push(path);
				}
				for (const path of preview.newFiles) {
					options.signal?.throwIfAborted();
					const blocked = draftBlock(path);
					if (blocked) throw new AppError('OPEN_DRAFT', blocked);
					const handle = await zenfs.promises.open(path, 'wx');
					result.createdFiles.push(path);
					try {
						const changedDraft = draftBlock(path);
						if (changedDraft) throw new AppError('OPEN_DRAFT', changedDraft);
						await handle.writeFile(decoded.files.get(path)!);
					} finally {
						await handle.close();
					}
				}
				result.status = 'imported';
			} catch (error) {
				result.status = 'failed';
				result.error = error instanceof Error ? error.message : String(error);
				// These paths were created exclusively while holding the shared mutation queue.
				// Never recurse during cleanup or remove a pre-existing item.
				for (const path of [...result.createdFiles].reverse()) {
					try {
						await zenfs.promises.unlink(path);
						result.rolledBack.push(path);
					} catch {
						result.remainingPaths.push(path);
					}
				}
				for (const path of [...result.createdDirectories].reverse()) {
					try {
						await zenfs.promises.rmdir(path);
						result.rolledBack.push(path);
					} catch {
						result.remainingPaths.push(path);
					}
				}
				for (const backup of [...result.preservedFiles].reverse()) {
					try {
						if (await lstatIfExists(backup.from))
							throw new Error('The original path could not be cleared.');
						await zenfs.promises.rename(backup.to, backup.from);
						result.restoredOriginals.push(backup.from);
						result.preservedFiles = result.preservedFiles.filter((entry) => entry !== backup);
					} catch {
						result.remainingPaths.push(backup.to);
					}
				}
				for (const path of [...backupDirectories].reverse()) {
					try {
						await zenfs.promises.rmdir(path);
						result.rolledBack.push(path);
					} catch {
						result.remainingPaths.push(path);
					}
				}
			}
			try {
				await workspaceService.refresh();
			} catch {
				result.warning =
					'The file list could not refresh. Reload the desktop to inspect the reported paths.';
			}
			activityService.record({
				actor: options.actor ?? 'human',
				action: result.status === 'imported' ? 'Workspace imported' : 'Workspace import failed',
				detail:
					result.status === 'imported'
						? `Imported ${result.createdFiles.length} files and ${result.createdDirectories.length} folders; kept ${result.skippedFiles} identical files and preserved ${result.preservedFiles.length} original files in Imports.`
						: `Import failed. Removed ${result.rolledBack.length} new items and restored ${result.restoredOriginals.length} originals; ${result.remainingPaths.length} paths need inspection. ${result.error}`,
			});
			return result;
		});
	}
}

export const packService = new PackService();
