import { AppError } from '../errors';
import { normalizeWorkspacePath, workspaceBasename, workspaceDirname } from './path';
import { workspaceService, zenfs } from './workspace';

type SaveStatus = 'loading' | 'saved' | 'edited' | 'saving' | 'conflict' | 'missing' | 'error';
export type Note = {
	path: string;
	content: string;
	base: string | null;
	status: SaveStatus;
	error: string;
};

const SESSION_PATH = '/System/notepad.json';
const DEFAULT_PATH = '/Notes/Ideas.md';

class NotepadService {
	path = DEFAULT_PATH;
	#notes = new Map<string, Note>();
	#listeners = new Set<() => void>();
	#ready: Promise<void> | undefined;
	#timers = new Map<Note, ReturnType<typeof setTimeout>>();
	#saves = new Map<Note, Promise<void>>();
	#opens = new Map<Note, Promise<void>>();
	#checkpoint: Promise<void> | undefined;
	#checkpointRevision = 0;
	checkpointError = '';
	#refreshRevision = 0;

	get current(): Note {
		return (
			this.#notes.get(this.path) ?? {
				path: this.path,
				content: '',
				base: null,
				status: 'loading',
				error: '',
			}
		);
	}

	get hasPendingWrites() {
		return Boolean(this.#checkpoint || this.checkpointError);
	}

	subscribe(listener: () => void) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#notify() {
		for (const listener of this.#listeners) listener();
	}

	ready() {
		return (this.#ready ??= this.#initialize());
	}

	async #initialize() {
		await workspaceService.ready();
		if (await workspaceService.exists(SESSION_PATH)) {
			try {
				const session = JSON.parse(await workspaceService.readText(SESSION_PATH));
				if (typeof session.path === 'string' && session.path.startsWith('/')) {
					this.path = normalizeWorkspacePath(session.path);
				}
				for (const draft of Array.isArray(session.drafts) ? session.drafts : []) {
					if (
						typeof draft.path !== 'string' ||
						!draft.path.startsWith('/') ||
						typeof draft.content !== 'string' ||
						!(typeof draft.base === 'string' || draft.base === null)
					)
						continue;
					const path = normalizeWorkspacePath(draft.path);
					this.#notes.set(path, {
						path,
						content: draft.content,
						base: draft.base,
						status: 'edited',
						error: '',
					});
				}
			} catch {
				this.checkpointError =
					'The saved Notepad session could not be read. Your files are still available in Finder.';
			}
		}
		workspaceService.subscribeToMoves((source, destination) => {
			for (const [path, note] of [...this.#notes]) {
				if (path !== source && !path.startsWith(`${source}/`)) continue;
				const next = `${destination}${path.slice(source.length)}`;
				this.#notes.delete(path);
				note.path = next;
				this.#notes.set(next, note);
				if (this.path === path) this.path = next;
			}
			this.#persist();
			this.#notify();
		});
		workspaceService.subscribe(() => {
			void this.refresh();
		});
		await this.open(this.path);
		await this.refresh();
		for (const note of this.#notes.values()) {
			if (note.status === 'edited') void this.save(note);
		}
	}

	async open(input: string) {
		const path = normalizeWorkspacePath(input);
		this.path = path;
		let note = this.#notes.get(path);
		if (!note) {
			note = { path, content: '', base: null, status: 'loading', error: '' };
			this.#notes.set(path, note);
			this.#notify();
			const opening = this.#load(note).finally(() => this.#opens.delete(note));
			this.#opens.set(note, opening);
		}
		await this.#opens.get(note);
		this.#persist();
		this.#notify();
		return note;
	}

	async #load(note: Note) {
		try {
			const content = await workspaceService.readText(note.path);
			Object.assign(note, { content, base: content, status: 'saved' });
		} catch (error) {
			note.status = 'missing';
			note.error = error instanceof Error ? error.message : 'This note could not be opened.';
		}
	}

	edit(content: string) {
		const note = this.current;
		if (note.status === 'loading' || content === note.content) return;
		note.content = content;
		if (!['conflict', 'missing', 'error'].includes(note.status)) {
			note.status = content === note.base ? 'saved' : 'edited';
		}
		// Checkpoint every edit in the same filesystem. Only the document write
		// is debounced. Closing a window never owns or cancels this work.
		this.#persist();
		clearTimeout(this.#timers.get(note));
		this.#timers.set(
			note,
			setTimeout(() => {
				void this.save(note);
			}, 400),
		);
		this.#notify();
	}

	save(note = this.current): Promise<void> {
		const existing = this.#saves.get(note);
		if (existing) return existing;
		clearTimeout(this.#timers.get(note));
		const result = this.#save(note).finally(() => this.#saves.delete(note));
		this.#saves.set(note, result);
		return result;
	}

	async #save(note: Note) {
		while (
			note.content !== note.base &&
			!['loading', 'conflict', 'missing'].includes(note.status)
		) {
			const { path, content, base } = note;
			if (base === null) return;
			note.status = 'saving';
			note.error = '';
			this.#notify();
			try {
				await workspaceService.writeText(path, content, { actor: 'human', expectedContent: base });
				note.base = content;
				note.status = note.content === content ? 'saved' : 'edited';
			} catch (error) {
				if (note.path !== path) continue;
				note.status =
					error instanceof AppError && error.code === 'FILE_CHANGED'
						? 'conflict'
						: error instanceof AppError && error.code === 'FILE_MISSING'
							? 'missing'
							: 'error';
				note.error = error instanceof Error ? error.message : 'This note could not be saved.';
				break;
			}
		}
		this.#persist();
		this.#notify();
	}

	async refresh() {
		const revision = ++this.#refreshRevision;
		for (const note of this.#notes.values()) {
			if (note.status === 'loading' || this.#saves.has(note)) continue;
			const { path, base } = note;
			try {
				const disk = await workspaceService.readText(path);
				if (
					revision !== this.#refreshRevision ||
					note.path !== path ||
					note.base !== base ||
					this.#saves.has(note)
				)
					continue;
				if (disk === note.content || note.content === base) {
					Object.assign(note, { content: disk, base: disk, status: 'saved', error: '' });
				} else if (disk !== base) note.status = 'conflict';
				else if (note.status === 'missing') note.status = 'edited';
			} catch {
				if (note.path === path && !this.#saves.has(note)) note.status = 'missing';
			}
		}
		this.#notify();
	}

	getNote(path: string) {
		return this.#notes.get(normalizeWorkspacePath(path));
	}

	async prepareAgentWrite(path: string) {
		await this.ready();
		const normalized = normalizeWorkspacePath(path);
		const note = this.#notes.get(normalized);
		if (note) {
			await this.#opens.get(note);
			if (note.status === 'edited' || note.status === 'saving') await this.save(note);
		}
		const beforeWrite = () => {
			if (note && note.path !== normalized) {
				throw new AppError('FILE_CHANGED', 'This note was moved. Read its new path.');
			}
			const current = this.#notes.get(normalized);
			if (!current) return;
			if (
				current.status === 'loading' ||
				current.status === 'saving' ||
				current.content !== current.base ||
				['conflict', 'missing', 'error'].includes(current.status)
			) {
				throw new AppError(
					'NOTE_DRAFT_CONFLICT',
					'This note has a pending or conflicting human draft. No agent edit was applied.',
					'Read notes_get_context for the current note. Let autosave finish, or resolve the draft in Notepad before retrying.',
				);
			}
		};
		beforeWrite();
		return beforeWrite;
	}

	async useFileVersion() {
		const note = this.current;
		const disk = await workspaceService.readText(note.path);
		Object.assign(note, { content: disk, base: disk, status: 'saved', error: '' });
		this.#persist();
		this.#notify();
	}

	async create(content = '', name = 'Untitled') {
		let suffix = 1;
		while (true) {
			const path = `/Notes/${name}${suffix === 1 ? '' : ` ${suffix}`}.md`;
			try {
				await workspaceService.writeText(path, content, { actor: 'human', createOnly: true });
				await this.open(path);
				return;
			} catch (error) {
				if (!(error instanceof AppError && error.code === 'PATH_EXISTS')) throw error;
				suffix++;
			}
		}
	}

	async saveCopy() {
		const note = this.current;
		await this.create(
			note.content,
			`${workspaceBasename(note.path).replace(/\.[^.]+$/, '')} recovered`,
		);
		this.#notes.delete(note.path);
		this.#persist();
	}

	async rename(name: string) {
		const note = this.current;
		const trimmed = name.trim();
		if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/')) {
			throw new Error('Choose a name without slashes.');
		}
		const extension = workspaceBasename(note.path).match(/\.[^.]+$/)?.[0] ?? '.md';
		const filename = /\.[^.]+$/.test(trimmed) ? trimmed : `${trimmed}${extension}`;
		const destination = `${workspaceDirname(note.path)}/${filename}`;
		if (destination !== note.path)
			await workspaceService.move(note.path, destination, { actor: 'human' });
	}

	#persist() {
		this.#checkpointRevision++;
		if (this.#checkpoint) return;
		this.#checkpoint = this.#writeCheckpoint()
			.catch((error) => {
				this.checkpointError = `Draft recovery is unavailable. ${error instanceof Error ? error.message : 'Try saving again.'}`;
			})
			.finally(() => {
				this.#checkpoint = undefined;
				this.#notify();
			});
	}

	async #writeCheckpoint() {
		let revision: number;
		do {
			revision = this.#checkpointRevision;
			await workspaceService.mutate(async () => {
				const data = JSON.stringify({
					path: this.path,
					drafts: [...this.#notes.values()]
						.filter((note) => note.status !== 'loading' && note.content !== note.base)
						.map(({ path, content, base }) => ({ path, content, base })),
				});
				await zenfs.promises.writeFile(`${SESSION_PATH}.tmp`, data, 'utf8');
				await zenfs.promises.rename(`${SESSION_PATH}.tmp`, SESSION_PATH);
			});
			this.checkpointError = '';
		} while (revision !== this.#checkpointRevision);
	}
}

export const notepadService = new NotepadService();
