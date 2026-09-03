import { AppError } from '../errors';
import { workspaceService, type WorkspaceEntry } from './workspace';
import { normalizeWorkspacePath } from './path';
import { textRevision } from './text-revision';
import type { ActivityActor } from '../activity/activity';

export type JsonRecord<T> = { path: string; data: T; revision: string; entry?: WorkspaceEntry };
export type JsonSnapshot<T> = {
	path: string | null;
	data: T | null;
	revision: string | null;
	loading: boolean;
	error: string;
	warning: string;
};
export function appFilePath(path: string, suffix: string | readonly string[]) {
	if (typeof path !== 'string' || !path.startsWith('/') || path.length > 2048)
		throw new AppError('INVALID_PATH', 'Use an absolute workspace file path.');
	path = normalizeWorkspacePath(path);
	if (
		!(typeof suffix === 'string' ? [suffix] : suffix).some((ending) => path.endsWith(ending)) ||
		path.startsWith('/System/') ||
		path.startsWith('/Trash/')
	)
		throw new AppError('INVALID_PATH', `Choose a ${suffix} file outside System and Trash.`);
	return path;
}
export function objectValue(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new AppError('INVALID_DATA', 'Expected a JSON object.');
	return value as Record<string, unknown>;
}
export function boundedText(value: unknown, name: string, max: number, empty = false) {
	if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()))
		throw new AppError(
			'INVALID_DATA',
			`${name} must be ${empty ? 'a string' : 'non-empty text'} up to ${max} characters.`,
		);
	return value;
}
export function fileLink(value: unknown) {
	if (value === null || value === undefined || value === '') return null;
	const path = boundedText(value, 'File link', 2048);
	if (!path.startsWith('/'))
		throw new AppError('INVALID_PATH', 'File links must be absolute workspace paths.');
	return normalizeWorkspacePath(path);
}
export async function checkFileLink(path: string | null) {
	if (path && (await workspaceService.stat(path)).kind !== 'file')
		throw new AppError('NOT_A_FILE', `${path} is not a file.`);
}

// Tasks and Canvas have the same real second use: validated, revision-checked
// JSON documents in ZenFS. UI-only drafts stay in their components.
export class WorkspaceJson<T> {
	#state: JsonSnapshot<T> = {
		path: null,
		data: null,
		revision: null,
		loading: false,
		error: '',
		warning: '',
	};
	#listeners = new Set<() => void>();
	#generation = 0;
	#initial: Promise<void> | undefined;
	#closeGuard: (() => boolean | Promise<boolean>) | undefined;
	#openGuard: ((path: string) => Promise<void>) | undefined;
	setOpenGuard(guard: (path: string) => Promise<void>) {
		this.#openGuard = guard;
		return () => {
			if (this.#openGuard === guard) this.#openGuard = undefined;
		};
	}
	#pendingGuard: ((path: string) => boolean) | undefined;
	setPendingGuard(guard: (path: string) => boolean) {
		this.#pendingGuard = guard;
		return () => {
			if (this.#pendingGuard === guard) this.#pendingGuard = undefined;
		};
	}
	hasPendingEdits(path: string) {
		return this.#pendingGuard?.(path) ?? false;
	}
	setCloseGuard(guard: () => boolean | Promise<boolean>) {
		this.#closeGuard = guard;
		return () => {
			if (this.#closeGuard === guard) this.#closeGuard = undefined;
		};
	}
	beforeClose() {
		return this.#closeGuard?.() ?? true;
	}
	constructor(
		readonly suffix: string | readonly string[],
		readonly defaultPath: string,
		readonly sessionPath: string,
		readonly empty: () => T,
		readonly parse: (value: unknown) => T,
		readonly maxBytes = 1_000_000,
	) {
		workspaceService.subscribe(() => {
			if (this.#state.path) void this.refresh();
		});
		workspaceService.subscribeToMoves((from, to) => {
			const path = this.#state.path;
			if (path && (path === from || path.startsWith(`${from}/`))) {
				this.#set({ path: to + path.slice(from.length) });
				void this.#remember();
			}
		});
	}
	snapshot() {
		return this.#state;
	}
	subscribe(listener: () => void) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
	#set(value: Partial<JsonSnapshot<T>>) {
		this.#state = { ...this.#state, ...value };
		for (const listener of this.#listeners) listener();
	}
	async resolvePath(): Promise<string> {
		if (this.#state.path) return this.#state.path;
		await workspaceService.ready();
		if (await workspaceService.exists(this.sessionPath)) {
			try {
				if ((await workspaceService.stat(this.sessionPath)).size <= 8192)
					return appFilePath(
						JSON.parse(await workspaceService.readText(this.sessionPath)).path,
						this.suffix,
					);
			} catch {
				/* A malformed checkpoint must not create or replace a document. */
			}
		}
		return this.defaultPath;
	}
	async read(path?: string): Promise<JsonRecord<T>> {
		path ??= await this.resolvePath();
		path = appFilePath(path, this.suffix);
		const entry = await workspaceService.stat(path);
		if (entry.kind !== 'file' || entry.size > this.maxBytes)
			throw new AppError(
				'INVALID_DATA',
				`Open a JSON document smaller than ${this.maxBytes / 1_000_000} MB.`,
			);
		const content = await workspaceService.readText(path);
		let data: T;
		try {
			data = this.parse(JSON.parse(content));
		} catch (error) {
			throw new AppError(
				'INVALID_DATA',
				`Cannot read ${path}: ${error instanceof Error ? error.message : 'invalid JSON'}`,
				'The file was not replaced. Repair it in Notepad or restore a saved version in Activity.',
			);
		}
		return { path, data, revision: await textRevision(content) };
	}
	async open(path: string) {
		path = appFilePath(path, this.suffix);
		await this.#openGuard?.(path);
		this.#set({ path, data: null, revision: null, loading: true, error: '' });
		await this.refresh();
		if (this.#state.path === path && this.#state.error)
			throw new AppError('OPEN_FAILED', this.#state.error);
		await this.#remember();
	}
	async refresh() {
		const path = this.#state.path;
		if (!path) return;
		const turn = ++this.#generation;
		try {
			const record = await this.read(path);
			if (turn === this.#generation && this.#state.path === path)
				this.#set({ ...record, loading: false, error: '' });
		} catch (error) {
			if (turn === this.#generation && this.#state.path === path)
				this.#set({
					loading: false,
					error: error instanceof Error ? error.message : String(error),
				});
		}
	}
	async #remember() {
		const path = this.#state.path;
		try {
			await workspaceService.writeText(this.sessionPath, JSON.stringify({ path }), {
				quiet: true,
				actor: 'system',
			});
		} catch {
			this.#set({
				warning: 'The last-opened file could not be remembered. Your document is still saved.',
			});
		}
	}
	async ensure() {
		this.#initial ??= (async () => {
			await workspaceService.ready();
			let path = this.defaultPath;
			if (await workspaceService.exists(this.sessionPath)) {
				try {
					path = appFilePath(
						JSON.parse(await workspaceService.readText(this.sessionPath)).path,
						this.suffix,
					);
				} catch {
					this.#set({
						warning: 'Could not read the last-opened file. Showing the default document.',
					});
				}
			}
			if (this.#state.path) return;
			// Only a deliberate app launch creates its first empty document.
			if (path === this.defaultPath && !(await workspaceService.exists(path)))
				await this.write(path, this.empty(), undefined, true, 'human');
			if (!this.#state.path) await this.open(path);
		})();
		try {
			await this.#initial;
		} catch (error) {
			this.#initial = undefined;
			throw error;
		}
	}
	async write(
		path: string,
		data: T,
		expectedRevision: string | undefined,
		createOnly: boolean,
		actor: ActivityActor,
		signal?: AbortSignal,
		guard?: () => void,
	): Promise<JsonRecord<T>> {
		path = appFilePath(path, this.suffix);
		data = this.parse(data);
		const content = JSON.stringify(data, null, 2) + '\n';
		if (new TextEncoder().encode(content).length > this.maxBytes)
			throw new AppError(
				'FILE_TOO_LARGE',
				`Keep this document under ${this.maxBytes / 1_000_000} MB.`,
			);
		signal?.throwIfAborted();
		const entry = await workspaceService.writeText(path, content, {
			actor,
			createOnly,
			requireRevision: !createOnly,
			expectedRevision,
			beforeWrite: () => {
				signal?.throwIfAborted();
				guard?.();
			},
		});
		if (this.#state.path === path) await this.refresh();
		return { path, data, revision: await textRevision(content), entry };
	}
}
