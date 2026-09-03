import { AppError } from '../errors';
import { configureSingle, fs } from '@zenfs/core';
import { IndexedDB } from '@zenfs/dom';
import { activityService, type ActivityActor } from '../activity/activity';
import { textRevision } from './text-revision';
import { commitVersion, prepareVersion, HISTORY_ROOT, type FileVersion } from '../activity/history';
import {
	normalizeWorkspacePath,
	workspaceBasename,
	workspaceDirname,
	workspaceExtension,
} from './path';

export type WorkspaceEntry = {
	path: string;
	name: string;
	kind: 'file' | 'directory';
	size: number;
	modifiedAt: string;
	extension: string;
	versionId?: string;
	recoveryWarning?: string;
};

export type WorkspaceSearchResult = WorkspaceEntry & {
	matches: string[];
};

export type MutationContext = {
	actor?: ActivityActor;
	quiet?: boolean;
};

export type TextWriteOptions = MutationContext & {
	expectedContent?: string;
	expectedRevision?: string;
	requireRevision?: boolean;
	createOnly?: boolean;
	// Recheck an open draft inside the mutation queue, immediately before writing.
	beforeWrite?: () => void;
};

export type WorkspaceMutationOptions = MutationContext & {
	overwrite?: boolean;
};

export type BinaryWriteOptions = MutationContext & {
	createOnly?: boolean;
	expectedBytes?: Uint8Array;
	beforeWrite?: () => void;
};

export function isBinaryDocument(path: string) {
	return /\.(docx?|odt|ott|rtf|pdf|ods|xlsx)$/i.test(path);
}

const SEED_VERSION = '/System/.seeded-v1';

const seedFiles: Record<string, string> = {
	'/Projects/Launch/brief.md': `# Launch brief

This sample project tracks the Deskstead launch. Use it to try a report and handoff workflow.

Read the notes in this folder, summarize completed work and open tasks, and save a status report beside the sources. Record any question that needs a human answer.
`,
	'/Projects/Launch/research.md': `# Research notes

- WebMCP tools should describe user intent, not UI gestures.
- Human and agent actions must reach the same application services.
- The terminal should work against the same files shown in Finder.
- The final result needs to survive a page reload.
`,
	'/Projects/Launch/meeting-notes.md': `# Meeting notes

The desktop shell and persistent workspace are in place. A status report and a walkthrough video are still needed. The report should cite the source notes and identify the next task.
`,
	'/Projects/Launch/todo.md': `# Launch tasks

- [x] Port the macOS-inspired desktop shell
- [x] Add a persistent shared workspace
- [ ] Prepare a concise project status report
- [ ] Record the final demo video
`,
	'/Documents/Welcome.md': `# Welcome to Deskstead

A shared desktop for you and your AI agent.

Write a report, review a spreadsheet, or plan a project together. Your saved work stays here, ready for either of you to continue.

## Start here

Open Finder to explore the sample notes in /Projects/Launch. Notepad edits Markdown and text. Documents and Sheets open office files. All of them share this workspace with your connected agent.

Try asking your agent:

> Read the notes in /Projects/Launch and prepare a short status report. Save it beside the sources and open it in Notepad. Create a project with links to the sources and report. Leave a handoff with the remaining work and any question you need me to answer.

Open Projects to review the handoff and answer any question. A later agent session can read the saved brief and continue.

## Make it yours

Save your working preferences in Home. Bring your own files and requests into Inbox. Keep repeatable procedures in Shortcuts, or try App Studio to turn data into an app you can search and filter. Activity records changes and gives you access to saved file versions.

## Keep a copy

Files are saved in this browser profile. Download important work or export a workspace pack from Home before clearing site data. Packs let you carry saved files and settings to another browser workspace. There is no cloud backup or automatic sync.

The apps work on their own. To work with an agent, use a browser or client that supports WebMCP. That connection can read and change workspace content; its provider may receive content the agent reads.
`,
	'/Notes/Ideas.md': `# Ideas

- Let an agent prepare a handoff that remains useful after the chat ends.
- Keep one visible workspace instead of hiding agent output in a transcript.
- Make a good result easy to inspect and continue editing.
`,
};

export async function lstatIfExists(path: string) {
	try {
		return await fs.promises.lstat(path);
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
		throw error;
	}
}

export async function copyWorkspacePath(
	source: string,
	destination: string,
	options: { recursive?: boolean } = {},
): Promise<void> {
	if (!options.recursive || !(await fs.promises.lstat(source)).isDirectory()) {
		await fs.promises.cp(source, destination, options);
		return;
	}
	await fs.promises.mkdir(destination, { recursive: true });
	const names = await fs.promises.readdir(source);
	// ZenFS cp rejects before its other recursive branches settle. Finish every
	// branch before reporting failure or releasing the mutation queue.
	const results = await Promise.allSettled(
		names.map((name) => copyWorkspacePath(`${source}/${name}`, `${destination}/${name}`, options)),
	);
	const failed = results.find((result) => result.status === 'rejected');
	if (failed?.status === 'rejected') throw failed.reason;
}

// ZenFS keeps inode IDs and paths in memory. A second mounted instance can
// overwrite unrelated files even when its writes do not overlap in time.
const lockState: { ready?: Promise<void> } = import.meta.hot?.data.workspaceLock ?? {};
if (import.meta.hot) import.meta.hot.data.workspaceLock = lockState;

function acquireWorkspaceLock() {
	return (lockState.ready ??= new Promise<void>((resolve, reject) => {
		if (!globalThis.navigator?.locks?.request) {
			reject(
				new AppError(
					'WORKSPACE_LOCK_UNAVAILABLE',
					'This browser cannot protect the saved workspace.',
					'Open this site in a current browser over HTTPS or localhost, then reload.',
				),
			);
			return;
		}
		void navigator.locks
			.request('webmcp-desktop:workspace', { ifAvailable: true }, (lock) => {
				if (!lock) {
					reject(
						new AppError(
							'WORKSPACE_IN_USE',
							'This workspace is open in another tab.',
							'Close that tab, then reload here.',
						),
					);
					return;
				}
				resolve();
				// The browser releases this lock when the document closes. Releasing
				// it sooner would leave a live filesystem with stale inode tables.
				return new Promise<void>(() => {});
			})
			.catch(() => {
				reject(
					new AppError(
						'WORKSPACE_LOCK_UNAVAILABLE',
						'The browser could not protect the saved workspace.',
						'Close other tabs using this workspace, then reload.',
					),
				);
			});
	}));
}

class WorkspaceService {
	#readyPromise: Promise<void> | null = null;
	#listeners = new Set<() => void>();
	#paths = new Set<string>(['/']);
	#mutationQueue: Promise<unknown> = Promise.resolve();
	#moveListeners = new Set<(source: string, destination: string) => void>();

	// All writers, including the shell, share this queue. A checked save must
	// compare and write without another mutation slipping between the two.
	mutate<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.#mutationQueue.then(operation);
		this.#mutationQueue = result.catch(() => {});
		return result;
	}

	subscribeToMoves(listener: (source: string, destination: string) => void) {
		this.#moveListeners.add(listener);
		return () => this.#moveListeners.delete(listener);
	}

	notifyMove(source: string, destination: string) {
		for (const listener of this.#moveListeners) listener(source, destination);
	}

	ready() {
		this.#readyPromise ??= this.#initialize();
		return this.#readyPromise;
	}

	async #initialize() {
		await acquireWorkspaceLock();
		await configureSingle({ backend: IndexedDB, storeName: 'webmcp-desktop' });
		await this.#seed();
		await this.#refreshPaths();
	}

	async #seed() {
		if (await fs.promises.exists(SEED_VERSION)) return;

		for (const [path, content] of Object.entries(seedFiles)) {
			await fs.promises.mkdir(workspaceDirname(path), { recursive: true });
			await fs.promises.writeFile(path, content, 'utf8');
		}

		await fs.promises.mkdir('/System', { recursive: true });
		await fs.promises.writeFile(SEED_VERSION, new Date().toISOString(), 'utf8');
		activityService.record({
			actor: 'system',
			action: 'Workspace prepared',
			detail: 'Added the starter project, documents, and notes.',
		});
	}

	#notify() {
		for (const listener of this.#listeners) listener();
	}

	#record(
		context: MutationContext,
		action: string,
		detail: string,
		path?: string,
		versionId?: string,
	) {
		if (context.quiet) return;
		activityService.record({
			actor: context.actor ?? 'human',
			action,
			detail,
			path,
			...(versionId ? { versionId } : {}),
		});
	}

	async finishVersion(
		version: FileVersion | null,
	): Promise<{ versionId?: string; recoveryWarning?: string }> {
		if (!version) return {};
		try {
			await commitVersion(version);
			return {
				versionId: version.id,
				...(!version.recovery ? { recoveryWarning: version.reason } : {}),
			};
		} catch {
			// The user's file is already saved. Never report a failed save that could
			// prompt a duplicate mutation. Prepared snapshots remain inspectable.
			const recoveryWarning =
				'File saved, but recovery finalization failed. Review may show an unconfirmed version; restore as a copy.';
			activityService.record({
				actor: 'system',
				action: 'Recovery needs attention',
				detail: recoveryWarning,
				path: version.path,
				versionId: version.id,
			});
			return { versionId: version.id, recoveryWarning };
		}
	}

	async #refreshPaths() {
		const next = new Set<string>(['/']);

		const walk = async (directory: string) => {
			if (directory === HISTORY_ROOT) return;
			for (const name of await fs.promises.readdir(directory)) {
				const path = normalizeWorkspacePath(name, directory);
				next.add(path);
				const stats = await fs.promises.lstat(path);
				if (stats.isDirectory()) await walk(path);
			}
		};

		await walk('/');
		this.#paths = next;
		this.#notify();
	}

	async refresh() {
		await this.ready();
		await this.#refreshPaths();
	}

	subscribe(listener: () => void) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	getAllPaths() {
		return [...this.#paths];
	}

	async exists(path: string) {
		await this.ready();
		return fs.promises.exists(normalizeWorkspacePath(path));
	}

	async stat(path: string): Promise<WorkspaceEntry> {
		await this.ready();
		const normalized = normalizeWorkspacePath(path);
		const stats = await fs.promises.stat(normalized);
		return {
			path: normalized,
			name: workspaceBasename(normalized),
			kind: stats.isDirectory() ? 'directory' : 'file',
			size: stats.size,
			modifiedAt: stats.mtime.toISOString(),
			extension: workspaceExtension(normalized),
		};
	}

	async list(path = '/') {
		await this.ready();
		const normalized = normalizeWorkspacePath(path);
		const names = await fs.promises.readdir(normalized);
		const entries = await Promise.all(names.map((name) => this.stat(`${normalized}/${name}`)));
		return entries.sort((left, right) => {
			if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
			return left.name.localeCompare(right.name);
		});
	}

	async readText(path: string) {
		await this.ready();
		if (isBinaryDocument(path))
			throw new AppError(
				'BINARY_DOCUMENT',
				'Use Sheets for ODS/XLSX workbooks, Documents for other office files, or download the original bytes.',
			);
		return fs.promises.readFile(normalizeWorkspacePath(path), 'utf8');
	}

	async readBytes(path: string) {
		await this.ready();
		return new Uint8Array(await fs.promises.readFile(normalizeWorkspacePath(path)));
	}

	async writeBytes(path: string, bytes: Uint8Array, context: BinaryWriteOptions = {}) {
		return this.mutate(async () => {
			await this.ready();
			const normalized = normalizeWorkspacePath(path);
			const existed = await fs.promises.exists(normalized);
			if (context.createOnly && existed)
				throw new AppError('PATH_EXISTS', `${normalized} already exists. Choose a new filename.`);
			if (context.expectedBytes) {
				if (!existed)
					throw new AppError(
						'FILE_MISSING',
						'The document was removed. Save a copy to keep your changes.',
					);
				const current = await this.readBytes(normalized);
				if (
					current.length !== context.expectedBytes.length ||
					current.some((value, index) => value !== context.expectedBytes[index])
				) {
					throw new AppError(
						'FILE_CHANGED',
						'This file changed elsewhere. Save a copy to keep both versions.',
					);
				}
			}
			await fs.promises.mkdir(workspaceDirname(normalized), { recursive: true });
			const version = await prepareVersion(normalized, bytes, context.actor ?? 'human');
			context.beforeWrite?.();
			await fs.promises.writeFile(normalized, bytes);
			const recovery = await this.finishVersion(version);
			await this.refresh();
			this.#record(
				context,
				existed ? 'Document updated' : 'Document created',
				`Saved ${workspaceBasename(normalized)}.`,
				normalized,
				version?.id,
			);
			return { ...(await this.stat(normalized)), ...recovery };
		});
	}

	async writeText(path: string, content: string, context: TextWriteOptions = {}) {
		if (isBinaryDocument(path))
			throw new AppError(
				'BINARY_DOCUMENT',
				'Create or edit ODS/XLSX workbooks through Sheets and other office files through Documents; files_write writes UTF-8 text.',
			);
		return this.mutate(async () => {
			await this.ready();
			const normalized = normalizeWorkspacePath(path);
			const existed = await fs.promises.exists(normalized);
			if (context.createOnly && existed) {
				throw new AppError('PATH_EXISTS', `${normalized} already exists.`);
			}
			if (context.expectedContent !== undefined) {
				if (!existed) throw new AppError('FILE_MISSING', 'This file was moved or removed.');
				if ((await this.readText(normalized)) !== context.expectedContent) {
					throw new AppError('FILE_CHANGED', 'This file changed elsewhere.');
				}
			}
			if (context.requireRevision && existed && !context.expectedRevision) {
				throw new AppError(
					'REVISION_REQUIRED',
					'Replacing an existing file requires expectedRevision.',
					'Read the current file with files_read or notes_get_context, then pass its revision.',
				);
			}
			if (context.expectedRevision) {
				if (!existed) throw new AppError('FILE_MISSING', 'This file was moved or removed.');
				await this.#checkTextRevision(await this.readText(normalized), context.expectedRevision);
			}
			await fs.promises.mkdir(workspaceDirname(normalized), { recursive: true });
			const version = await prepareVersion(
				normalized,
				new TextEncoder().encode(content),
				context.actor ?? 'human',
			);
			context.beforeWrite?.();
			await fs.promises.writeFile(normalized, content, 'utf8');
			const recovery = await this.finishVersion(version);
			await this.refresh();
			this.#record(
				context,
				existed ? 'Document updated' : 'Document created',
				existed
					? `Saved changes to ${workspaceBasename(normalized)}.`
					: `Created ${workspaceBasename(normalized)}.`,
				normalized,
				version?.id,
			);
			return { ...(await this.stat(normalized)), ...recovery };
		});
	}

	async #checkTextRevision(content: string, expected?: string) {
		if (expected !== undefined && (await textRevision(content)) !== expected) {
			throw new AppError(
				'FILE_CHANGED',
				'This file changed since it was read. No agent edit was applied.',
				'Read the latest content and revision, then reapply the intended change.',
			);
		}
	}

	async createDirectory(path: string, context: MutationContext = {}) {
		return this.mutate(async () => {
			await this.ready();
			const normalized = normalizeWorkspacePath(path);
			if (await fs.promises.exists(normalized)) {
				const entry = await this.stat(normalized);
				if (entry.kind !== 'directory') {
					throw new AppError(
						'PATH_EXISTS',
						`${normalized} is already a file.`,
						'Choose a different folder path.',
					);
				}
				return entry;
			}
			await fs.promises.mkdir(normalized, { recursive: true });
			await this.refresh();
			this.#record(
				context,
				'Folder created',
				`Created ${workspaceBasename(normalized)}.`,
				normalized,
			);
			return this.stat(normalized);
		});
	}

	move(source: string, destination: string, options: WorkspaceMutationOptions = {}) {
		return this.#transfer('move', source, destination, options);
	}

	copy(source: string, destination: string, options: WorkspaceMutationOptions = {}) {
		return this.#transfer('copy', source, destination, options);
	}

	async #transfer(
		operation: 'move' | 'copy',
		source: string,
		destination: string,
		options: WorkspaceMutationOptions,
	) {
		return this.mutate(async () => {
			await this.ready();
			const from = normalizeWorkspacePath(source);
			const to = normalizeWorkspacePath(destination);
			for (const path of [from, to])
				if (['/', '/System', '/Trash'].includes(path))
					throw new AppError('PROTECTED_PATH', `${path} is a protected workspace folder.`);
			if (from === to || to.startsWith(`${from}/`) || from.startsWith(`${to}/`)) {
				throw new AppError(
					'INVALID_DESTINATION',
					'The source and destination must be separate files or folders.',
					'Choose a destination outside the source folder and its parent folders.',
				);
			}
			const sourceStat = await fs.promises.lstat(from);
			const destinationStat = await lstatIfExists(to);
			if (destinationStat?.dev === sourceStat.dev && destinationStat.ino === sourceStat.ino)
				throw new AppError(
					'INVALID_DESTINATION',
					'The source and destination refer to the same file.',
				);
			if (destinationStat && !options.overwrite) {
				throw new AppError(
					'PATH_EXISTS',
					`${to} already exists.`,
					'Choose another destination or set overwrite to true.',
				);
			}
			await fs.promises.mkdir(workspaceDirname(to), { recursive: true });
			const staged = operation === 'copy' ? `/System/.copy-${crypto.randomUUID()}` : null;
			try {
				if (staged) await copyWorkspacePath(from, staged, { recursive: true });
				// Native rename replaces unlinked regular files atomically. Preserve
				// directories and hard-linked targets so their other names stay valid.
				const backup =
					destinationStat &&
					(!sourceStat.isFile() || !destinationStat.isFile() || destinationStat.nlink > 1)
						? await this.#trashPath(to)
						: null;
				if (backup) await fs.promises.rename(to, backup);
				try {
					await fs.promises.rename(staged ?? from, to);
				} catch (error) {
					if (backup) {
						try {
							await fs.promises.rename(backup, to);
						} catch {
							this.notifyMove(to, backup);
							throw new AppError(
								'TRANSFER_RECOVERY_REQUIRED',
								`The transfer failed. The previous destination is preserved at ${backup}.`,
								`Move ${backup} back to ${to} to restore it.`,
							);
						}
					}
					throw error;
				}
				if (backup) this.notifyMove(to, backup);
				if (operation === 'move') this.notifyMove(from, to);
				const verb = operation === 'move' ? 'Moved' : 'Copied';
				this.#record(
					options,
					`Item ${verb.toLowerCase()}`,
					`${verb} ${workspaceBasename(from)} to ${to}.`,
					to,
				);
				return this.stat(to);
			} finally {
				if (staged) await fs.promises.rm(staged, { recursive: true, force: true });
				await this.refresh();
			}
		});
	}

	async #trashPath(path: string) {
		await fs.promises.mkdir('/Trash', { recursive: true });
		const name = workspaceBasename(path);
		const dot = name.lastIndexOf('.');
		const stem = dot > 0 ? name.slice(0, dot) : name;
		const extension = dot > 0 ? name.slice(dot) : '';
		let trashPath = `/Trash/${name}`;
		let suffix = 2;
		while (await lstatIfExists(trashPath)) trashPath = `/Trash/${stem} ${suffix++}${extension}`;
		return trashPath;
	}

	async patchText(
		path: string,
		find: string,
		replace: string,
		expectedOccurrences = 1,
		context: TextWriteOptions = {},
	) {
		return this.mutate(async () => {
			await this.ready();
			const normalized = normalizeWorkspacePath(path);
			if (!find) {
				throw new AppError('INVALID_INPUT', 'The text to find cannot be empty.');
			}
			const content = await this.readText(normalized);
			await this.#checkTextRevision(content, context.expectedRevision);
			const occurrences = content.split(find).length - 1;
			if (occurrences !== expectedOccurrences) {
				throw new AppError(
					'MATCH_COUNT_MISMATCH',
					`Expected ${expectedOccurrences} matching passage${expectedOccurrences === 1 ? '' : 's'}, but found ${occurrences}.`,
					'Read the current file and use an exact passage that identifies the intended edit.',
				);
			}

			const updated = content.split(find).join(replace);
			const version = await prepareVersion(
				normalized,
				new TextEncoder().encode(updated),
				context.actor ?? 'human',
			);
			context.beforeWrite?.();
			await fs.promises.writeFile(normalized, updated, 'utf8');
			const recovery = await this.finishVersion(version);
			await this.refresh();
			this.#record(
				context,
				'Document edited',
				`Replaced ${occurrences} passage${occurrences === 1 ? '' : 's'} in ${workspaceBasename(normalized)}.`,
				normalized,
				version?.id,
			);
			return {
				entry: { ...(await this.stat(normalized)), ...recovery },
				replacements: occurrences,
				revision: await textRevision(updated),
			};
		});
	}

	async trash(path: string, context: MutationContext = {}) {
		return this.mutate(async () => {
			await this.ready();
			const normalized = normalizeWorkspacePath(path);
			if (normalized === '/' || normalized === '/System' || normalized === '/Trash') {
				throw new AppError('PROTECTED_PATH', `${normalized} cannot be moved to Trash.`);
			}
			if (!(await fs.promises.exists(normalized))) {
				throw new AppError(
					'PATH_NOT_FOUND',
					`No file or folder exists at ${normalized}.`,
					`List ${workspaceDirname(normalized)} to inspect the available items.`,
				);
			}

			const name = workspaceBasename(normalized);
			const trashPath = await this.#trashPath(normalized);

			await fs.promises.rename(normalized, trashPath);
			this.notifyMove(normalized, trashPath);
			await this.refresh();
			this.#record(context, 'Item moved to Trash', `Moved ${name} to Trash.`, trashPath);
			return {
				entry: await this.stat(trashPath),
				originalPath: normalized,
				trashPath,
			};
		});
	}

	async search(query: string, root = '/', limit = 50, { includeTrash = false } = {}) {
		await this.ready();
		const needle = query.trim().toLowerCase();
		if (!needle) return [];
		const normalizedRoot = normalizeWorkspacePath(root);
		const results: WorkspaceSearchResult[] = [];

		for (const path of this.#paths) {
			if (results.length >= limit) break;
			if (path === '/') continue;
			if (!includeTrash && (path === '/Trash' || path.startsWith('/Trash/'))) continue;
			if (
				normalizedRoot !== '/' &&
				path !== normalizedRoot &&
				!path.startsWith(`${normalizedRoot}/`)
			)
				continue;
			const entry = await this.stat(path);
			const matches: string[] = [];
			if (entry.name.toLowerCase().includes(needle)) matches.push('File name');

			if (entry.kind === 'file' && entry.size < 1_000_000 && !isBinaryDocument(path)) {
				const content = await this.readText(path);
				const lines = content
					.split('\n')
					.filter((line) => line.toLowerCase().includes(needle))
					.slice(0, 3)
					.map((line) => line.trim());
				matches.push(...lines);
			}

			if (matches.length) results.push({ ...entry, matches });
		}

		return results;
	}
}

export const workspaceService = new WorkspaceService();
export { fs as zenfs };
