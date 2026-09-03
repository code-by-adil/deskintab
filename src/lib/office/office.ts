import type { ExtendedDocumentOperation } from './document-edit-inputs';
import { AppError } from '../errors';
import { openApp, apps } from '../../state/apps.svelte';
import { activityService, type ActivityActor } from '../activity/activity';
import { workspaceService } from '../workspace/workspace';
import { normalizeWorkspacePath, workspaceBasename } from '../workspace/path';
import { maxImageBytes, prepareOfficeImage } from './image';
import { documentBlocks, documentOperation, documentReadInput, officeRevision } from './inputs';
import type { OfficeBridge as Bridge } from './protocol';
import {
	rangeInput,
	sheetOperation,
	sheetChart,
	workbookSheets,
	sheetName,
	type WorkbookSheet,
} from './sheets-inputs';

export const isOfficePath = (path: string) => /\.(docx?|odt|rtf)$/i.test(path);
export const isSheetPath = (path: string) => /\.(ods|xlsx)$/i.test(path);
export const isDocumentPath = (path: string) => isOfficePath(path) || /\.pdf$/i.test(path);
export const officeFrameUrl = `/office/index.html?v=${__OFFICE_BUILD_ID__}`;
export type OfficeFormat = 'odt' | 'docx' | 'ods' | 'xlsx' | 'pdf';
export type DocumentBlock =
	| { type: 'paragraph'; text: string; style?: string }
	| { type: 'table'; rows: string[][] };
export type DocumentOperation =
	| ExtendedDocumentOperation
	| { type: 'replace'; find: string; replace: string; expectedOccurrences: number }
	| { type: 'paragraph'; index: number; text?: string; style?: string }
	| { type: 'table-cell'; table: string; cell: string; text: string }
	| { type: 'insert-image'; imagePath: string; position: 'cursor' | 'end'; description: string }
	| { type: 'append'; blocks: DocumentBlock[] };
export type ImageInsertionTarget = { path: string; revision: number };
export type OfficeSnapshot = {
	path: string | null;
	preview: { path: string; url: string } | null;
	status: 'idle' | 'loading' | 'ready' | 'error';
	engineRequested: boolean;
	engineSession: number;
	message: string;
	busy: boolean;
	dirty: boolean;
};
const mime = {
	odt: 'application/vnd.oasis.opendocument.text',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	pdf: 'application/pdf',
	ods: 'application/vnd.oasis.opendocument.spreadsheet',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function validateOfficeFile(path: string, bytes: Uint8Array) {
	const extension = path.split('.').pop()?.toLowerCase();
	const zip = [80, 75, 3, 4].every((value, index) => bytes[index] === value);
	const ole = [208, 207, 17, 224, 161, 177, 26, 225].every(
		(value, index) => bytes[index] === value,
	);
	const rtf = new TextDecoder().decode(bytes.slice(0, 5)) === '{\\rtf';
	if (
		!bytes.length ||
		(['odt', 'docx', 'ods', 'xlsx'].includes(extension) && !zip) ||
		(extension === 'rtf' && !rtf) ||
		(extension === 'doc' && !ole && !rtf)
	)
		throw new AppError(
			'INVALID_DOCUMENT',
			`This file does not contain a valid ${extension?.toUpperCase()} document. Check the file and import it again.`,
		);
}

class OfficeService {
	#state: OfficeSnapshot = {
		path: null,
		preview: null,
		status: 'idle',
		engineRequested: false,
		engineSession: 0,
		message: '',
		busy: false,
		dirty: false,
	};
	#listeners = new Set<() => void>();
	#actions = new Set<(action: string) => void>();
	#bridge: Bridge | null = null;
	#frame: HTMLIFrameElement | null = null;
	#queue: Promise<unknown> = Promise.resolve();
	#base: Uint8Array | undefined;
	#revision = 0;
	#savedRevision = 0;
	#loaded = false;
	#generation = 0;
	#operationSequence = 0;
	#signal: AbortSignal | undefined;
	#autosave: ReturnType<typeof setTimeout> | undefined;
	#mountWaiters = new Set<{ resolve: (bridge: Bridge) => void; reject: (e: unknown) => void }>();

	constructor(readonly appId: 'documents' | 'sheets' = 'documents') {
		if (typeof window !== 'undefined')
			window.addEventListener('beforeunload', (event) => {
				if (this.#state.dirty) {
					event.preventDefault();
					event.returnValue = '';
				}
			});
		workspaceService.subscribeToMoves((source, destination) => {
			const path = this.#state.path;
			if (path && (path === source || path.startsWith(`${source}/`))) {
				this.#update({ path: destination + path.slice(source.length) });
				void this.#remember();
			}
		});
	}
	get sessionPath() {
		return this.appId === 'sheets' ? '/System/sheets-session.json' : '/System/office-session.json';
	}
	get appName() {
		return this.appId === 'sheets' ? 'Sheets' : 'Documents';
	}
	get defaultPath() {
		return this.appId === 'sheets' ? '/Documents/Untitled.ods' : '/Documents/Untitled.odt';
	}
	acceptsPath(path: string) {
		return this.appId === 'sheets' ? isSheetPath(path) : isOfficePath(path);
	}
	snapshot() {
		return this.#state;
	}
	subscribe(listener: () => void) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
	onAction(listener: (action: string) => void) {
		this.#actions.add(listener);
		return () => this.#actions.delete(listener);
	}
	#update(part: Partial<OfficeSnapshot>) {
		this.#state = { ...this.#state, ...part };
		for (const listener of this.#listeners) listener();
	}
	#error(error: unknown) {
		this.#update({
			message: error instanceof Error ? error.message : String(error),
			status: this.#loaded ? 'ready' : 'error',
		});
	}

	// Opening the app is separate from mounting its engine: PDF-only viewing
	// never needs an iframe. Recheck after the session read in case another
	// human/agent request or Close overtook this default launch.
	async show(forceWriter = false) {
		const generation = this.#generation;
		if ((!forceWriter && this.#state.preview) || this.#state.busy || this.#state.engineRequested)
			return;
		let path = this.#state.path;
		if (!path) {
			try {
				path = JSON.parse(await workspaceService.readText(this.sessionPath)).path;
			} catch {}
		}
		const exists = path && (await workspaceService.exists(path));
		if (
			generation !== this.#generation ||
			(!forceWriter && this.#state.preview) ||
			this.#state.busy ||
			this.#state.engineRequested
		)
			return;
		if (exists) await this.open(path!);
		else await this.newDocument();
	}
	attach(frame: HTMLIFrameElement) {
		this.#frame = frame;
		this.#update({ status: 'loading', message: 'Loading Office…' });
		let connected: Bridge | undefined;
		let failed = false;
		let runtimeStarted = false;
		const currentBridge = () => {
			try {
				return (frame.contentWindow as Window & { officeBridge?: Bridge })?.officeBridge;
			} catch {
				return undefined;
			}
		};
		const rejectStartup = (error: unknown) => {
			if (failed || this.#frame !== frame) return;
			failed = true;
			clearTimeout(deadline);
			currentBridge()?.dispose();
			this.#error(error);
			for (const waiter of this.#mountWaiters) waiter.reject(error);
			this.#mountWaiters.clear();
			// A failed startup owns no user draft. Release its workers immediately.
			this.#update({ engineRequested: false });
		};
		let deadline = setTimeout(
			() =>
				rejectStartup(
					new Error(
						'Office assets took too long to load. Check your connection and choose Try Again.',
					),
				),
			180_000,
		);
		const connect = async () => {
			if (failed || this.#frame !== frame) return;
			const bridge = currentBridge();
			if (!bridge || connected === bridge) return;
			connected = bridge;
			try {
				await bridge.ready;
				if (failed || this.#frame !== frame || currentBridge() !== bridge) return;
				clearTimeout(deadline);
				this.#bridge = bridge;
				this.#update({ status: 'ready', message: '' });
				for (const waiter of this.#mountWaiters) waiter.resolve(bridge);
				this.#mountWaiters.clear();
			} catch (error) {
				rejectStartup(error);
			}
		};
		const receive = (event: MessageEvent) => {
			if (
				failed ||
				event.origin !== location.origin ||
				event.source !== frame.contentWindow ||
				event.data?.source !== 'desktop-office'
			)
				return;
			const data = event.data;
			if (data.type === 'progress') {
				this.#update({ message: data.message });
				if (data.phase === 'runtime' && !runtimeStarted) {
					runtimeStarted = true;
					clearTimeout(deadline);
					deadline = setTimeout(
						() =>
							rejectStartup(
								new Error(
									'Office finished downloading but did not become ready. Choose Try Again to restart it.',
								),
							),
						60_000,
					);
				}
			}
			// Connect on the explicit handshake as well as iframe load. Readiness
			// must not depend on catching one browser load event at the right time.
			if (data.type === 'boot' || data.type === 'ready') void connect();
			if (data.type === 'error') {
				if (!this.#loaded) rejectStartup(new Error(data.message));
				else this.#error(new Error(data.message));
			}
			if (data.type === 'focus') apps.active = this.appId;
			if (data.type === 'changed') {
				this.#revision = Math.max(this.#revision, data.revision);
				this.#update({ dirty: this.#revision !== this.#savedRevision });
				clearTimeout(this.#autosave);
				if (!this.#state.busy && this.#loaded)
					this.#autosave = setTimeout(() => {
						void this.save().catch(() => {});
					}, 750);
			}
			if (data.type === 'action') {
				if (data.action === 'save') void this.save().catch(() => {});
				else for (const listener of this.#actions) listener(data.action);
			}
		};
		const loaded = () => {
			if (frame.contentDocument?.URL === 'about:blank') return;
			if (!currentBridge())
				rejectStartup(new Error('The Office frame did not initialize. Choose Try Again.'));
			else void connect();
		};
		window.addEventListener('message', receive);
		frame.addEventListener('load', loaded);
		void connect();
		return () => {
			clearTimeout(deadline);
			window.removeEventListener('message', receive);
			frame.removeEventListener('load', loaded);
			currentBridge()?.dispose();
			if (this.#frame !== frame) return;
			clearTimeout(this.#autosave);
			this.#bridge = null;
			this.#frame = null;
			this.#loaded = false;
			for (const waiter of this.#mountWaiters)
				waiter.reject(new Error(`${this.appName} was closed before loading completed.`));
			this.#mountWaiters.clear();
		};
	}
	detachView() {
		this.#generation++;
		this.closePreview();
		this.#update({ status: 'idle', engineRequested: false, busy: false });
	}
	async #ready() {
		this.#signal?.throwIfAborted();
		if (this.#state.status === 'error' && !this.#bridge)
			this.#update({ engineSession: this.#state.engineSession + 1, status: 'idle' });
		this.#update({ engineRequested: true });
		openApp(this.appId);
		if (this.#bridge) return this.#bridge;
		return new Promise<Bridge>((resolve, reject) => {
			const signal = this.#signal;
			const abort = () => {
				this.#mountWaiters.delete(waiter);
				waiter.reject(signal?.reason);
				if (!this.#loaded && !this.#bridge) this.#update({ engineRequested: false });
			};
			const clean = () => {
				clearTimeout(timer);
				signal?.removeEventListener('abort', abort);
			};
			const timer = setTimeout(() => {
				if (this.#frame) return; // The frame owns the asset/runtime deadlines.
				this.#mountWaiters.delete(waiter);
				waiter.reject(
					new Error(`${this.appName} did not mount its editor. Close it and try again.`),
				);
			}, 10_000);
			const waiter = {
				resolve: (bridge: Bridge) => {
					clean();
					resolve(bridge);
				},
				reject: (e: unknown) => {
					clean();
					reject(e);
				},
			};
			signal?.addEventListener('abort', abort, { once: true });
			this.#mountWaiters.add(waiter);
		});
	}
	#run<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		this.#operationSequence++;
		const generation = this.#generation;
		const result = this.#queue.then(async () => {
			if (generation !== this.#generation)
				throw new AppError('DOCUMENTS_CLOSED', `${this.appName} was closed. Reopen it to retry.`);
			signal?.throwIfAborted();
			this.#signal = signal;
			this.#update({ busy: true, message: '' });
			clearTimeout(this.#autosave);
			try {
				const value = await action();
				if (this.#bridge) this.#update({ status: 'ready' });
				return value;
			} catch (error) {
				// Error objects from the iframe have a different realm/prototype.
				// Normalize them here so the UI retains their actionable message.
				const failure =
					error && typeof error === 'object' && 'message' in error
						? 'code' in error
							? new AppError(String(error.code), String(error.message))
							: new Error(String(error.message))
						: new Error(String(error));
				if (generation === this.#generation) this.#error(failure);
				throw failure;
			} finally {
				this.#signal = undefined;
				if (generation === this.#generation) this.#update({ busy: false });
				if (
					generation === this.#generation &&
					this.#state.dirty &&
					!this.#state.message &&
					this.#loaded
				)
					this.#autosave = setTimeout(() => {
						void this.save().catch(() => {});
					}, 750);
			}
		});
		this.#queue = result.catch(() => {});
		return result;
	}
	async #remember() {
		await workspaceService.writeText(this.sessionPath, JSON.stringify({ path: this.#state.path }), {
			quiet: true,
		});
	}
	#format(path: string): OfficeFormat {
		const extension = path.split('.').pop()?.toLowerCase();
		const formats = this.appId === 'sheets' ? ['ods', 'xlsx', 'pdf'] : ['odt', 'docx', 'pdf'];
		if (!formats.includes(extension))
			throw new AppError(
				'UNSUPPORTED_FORMAT',
				`Use ${formats.map((value) => '.' + value).join(', ')}.`,
			);
		return extension as OfficeFormat;
	}
	async #save(actor: ActivityActor = 'human') {
		if (!this.#loaded || !this.#state.path) return;
		// The iframe's changed notification can still be queued after typing.
		// Query the worker before deciding that it is safe to switch or close.
		const state = await this.#bridge!.request('state');
		this.#revision = Math.max(this.#revision, state.revision);
		this.#update({ dirty: state.modified || this.#revision !== this.#savedRevision });
		if (!this.#state.dirty && this.#base) return workspaceService.stat(this.#state.path);
		const result = await this.#bridge!.request('serialize', {
			format: this.#format(this.#state.path),
		});
		const bytes = new Uint8Array(result.bytes);
		this.#signal?.throwIfAborted();
		const entry = await workspaceService.writeBytes(this.#state.path, bytes, {
			expectedBytes: this.#base,
			createOnly: !this.#base,
			actor,
		});
		this.#base = bytes;
		this.#savedRevision = result.revision;
		await this.#bridge!.request('mark-saved', { revision: result.revision });
		this.#update({ dirty: this.#revision !== this.#savedRevision });
		await this.#remember();
		return entry;
	}
	async #open(path: string) {
		path = normalizeWorkspacePath(path);
		if (!this.acceptsPath(path))
			throw new AppError(
				'UNSUPPORTED_FORMAT',
				this.appId === 'sheets'
					? 'Open an ODS or XLSX workbook.'
					: 'Open an ODT, DOCX, DOC, or RTF document.',
			);
		const bridge = await this.#ready();
		if (this.#loaded && this.#state.path === path) {
			const current = await workspaceService.readBytes(path);
			if (
				this.#base &&
				current.length === this.#base.length &&
				current.every((value, index) => value === this.#base[index])
			) {
				this.closePreview();
				return;
			}
			if (this.#state.dirty)
				throw new AppError(
					'DOCUMENT_CHANGED',
					'The workspace file changed while you were editing. Use Save As to preserve your changes.',
				);
		}
		await this.#save();
		const bytes = await workspaceService.readBytes(path);
		if (bytes.length > 50 * 1024 * 1024)
			throw new AppError('FILE_TOO_LARGE', 'Open a document smaller than 50 MiB.');
		validateOfficeFile(path, bytes);
		const extension = path.split('.').pop().toLowerCase();
		this.#signal?.throwIfAborted();
		const result = await bridge.request('open', { bytes, extension, app: this.appId });
		this.#loaded = true;
		this.#base = bytes;
		this.#revision = this.#savedRevision = result.revision;
		await this.#bridge!.request('mark-saved', { revision: result.revision });
		this.closePreview();
		this.#update({ path, dirty: false });
		// Legacy input formats are preserved. Editing saves an ODT copy.
		if (extension === 'doc' || extension === 'rtf') {
			let destination = path.replace(/\.[^.]+$/, '.odt');
			if (await workspaceService.exists(destination)) destination = path + '.odt';
			await this.#saveAs(destination, 'human');
		}
		await this.#remember();
	}
	open(path: string) {
		return this.#run(async () => {
			if (this.appId === 'sheets' || !/\.pdf$/i.test(path)) return this.#open(path);
			await this.#save();
			const bytes = await workspaceService.readBytes(path);
			if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
				throw new AppError('INVALID_PDF', 'This file does not contain a PDF document.');
			this.closePreview();
			const url = URL.createObjectURL(new Blob([bytes], { type: mime.pdf }));
			this.#update({ preview: { path, url } });
			openApp(this.appId);
		});
	}
	closePreview() {
		if (this.#state.preview) URL.revokeObjectURL(this.#state.preview.url);
		this.#update({ preview: null });
	}
	newDocument(
		path?: string,
		input: unknown = [],
		actor: ActivityActor = 'human',
		signal?: AbortSignal,
		sheets?: WorkbookSheet[],
	) {
		const blocks = documentBlocks(input);
		return this.#run(async () => {
			const bridge = await this.#ready();
			await this.#save();
			if (!path) {
				path = this.defaultPath;
				let index = 2;
				while (await workspaceService.exists(path))
					path = this.defaultPath.replace('Untitled.', `Untitled ${index++}.`);
			}
			path = normalizeWorkspacePath(path);
			if (this.#format(path) === 'pdf')
				throw new AppError(
					'INVALID_FORMAT',
					this.appId === 'sheets'
						? 'Create an ODS or XLSX, then export a PDF.'
						: 'Create an ODT or DOCX, then export a PDF.',
				);
			if (await workspaceService.exists(path))
				throw new AppError('PATH_EXISTS', `${path} already exists. Choose another filename.`);
			this.#signal?.throwIfAborted();
			const result = await bridge.request('create', { blocks, app: this.appId, sheets });
			this.#loaded = true;
			this.#base = undefined;
			this.#revision = result.revision;
			this.#savedRevision = -1;
			this.closePreview();
			this.#update({ path, dirty: true });
			return this.#save(actor);
		}, signal);
	}
	save() {
		return this.#run(() => this.#save());
	}
	async #saveAs(path: string, actor: ActivityActor) {
		path = normalizeWorkspacePath(path);
		const format = this.#format(path);
		if (format === 'pdf')
			throw new AppError(
				'INVALID_FORMAT',
				this.appId === 'sheets'
					? 'Save as ODS or XLSX. Use Export for PDF.'
					: 'Save as ODT or DOCX. Use Export for PDF.',
			);
		const result = await this.#bridge!.request('serialize', { format });
		const bytes = new Uint8Array(result.bytes);
		this.#signal?.throwIfAborted();
		const entry = await workspaceService.writeBytes(path, bytes, { createOnly: true, actor });
		this.#base = bytes;
		this.#savedRevision = result.revision;
		await this.#bridge!.request('mark-saved', { revision: result.revision });
		this.#update({ path, dirty: this.#revision !== this.#savedRevision });
		await this.#remember();
		return entry;
	}
	#checkSource(expectedSourcePath?: string) {
		if (expectedSourcePath !== undefined && this.#state.path !== expectedSourcePath)
			throw new AppError(
				'DOCUMENT_CHANGED',
				`The open ${this.appId === 'sheets' ? 'workbook' : 'document'} changed. Cancel and reopen the dialog for the current file.`,
			);
	}
	saveAs(path: string, expectedSourcePath?: string) {
		return this.#run(async () => {
			this.#checkSource(expectedSourcePath);
			await this.#ready();
			return this.#saveAs(path, 'human');
		});
	}
	importFile(file: File) {
		return this.#run(async () => {
			if (!this.acceptsPath(file.name))
				throw new AppError(
					'UNSUPPORTED_FORMAT',
					this.appId === 'sheets'
						? 'Choose an ODS or XLSX workbook.'
						: 'Choose an ODT, DOCX, DOC, or RTF document.',
				);
			if (file.size > 50 * 1024 * 1024)
				throw new AppError('FILE_TOO_LARGE', 'Choose a file smaller than 50 MiB.');
			const path = `/Documents/${file.name.replaceAll('/', '_')}`;
			const bytes = new Uint8Array(await file.arrayBuffer());
			validateOfficeFile(path, bytes);
			await workspaceService.writeBytes(path, bytes, {
				createOnly: true,
			});
			await this.#open(path);
		});
	}
	read(path: string, signal?: AbortSignal, input: unknown = {}) {
		const scope = documentReadInput(input);
		return this.#run(async () => {
			await this.#open(path);
			this.#signal?.throwIfAborted();
			return { path: this.#state.path, ...(await this.#bridge!.request('read', scope)) };
		}, signal);
	}

	selectDocument(
		path: string,
		revision: unknown,
		input: Record<string, unknown>,
		signal?: AbortSignal,
	) {
		const expectedRevision = officeRevision(revision);
		const position = (key: string, fallback: number) => {
			const n = input[key] ?? fallback;
			if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100000000)
				throw new AppError('INVALID_INPUT', `Invalid ${key}.`);
			return n;
		};
		const index = position('index', 0),
			start = position('start', 0),
			end = position('end', start);
		if (end < start) throw new AppError('INVALID_INPUT', 'end must be at or after start.');
		return this.#run(async () => {
			await this.#open(path);
			this.#signal?.throwIfAborted();
			return {
				path: this.#state.path,
				...(await this.#bridge!.request('select', { expectedRevision, index, start, end })),
			};
		}, signal);
	}
	selectWorkbook(path: string, revision: unknown, input: unknown, signal?: AbortSignal) {
		const expectedRevision = officeRevision(revision),
			scope = rangeInput(input);
		if (!scope.range) throw new AppError('INVALID_INPUT', 'Supply a cell range to select.');
		return this.#run(async () => {
			await this.#open(path);
			this.#signal?.throwIfAborted();
			return {
				path: this.#state.path,
				...(await this.#bridge!.request('sheet-select', {
					expectedRevision,
					sheet: scope.sheet,
					range: scope.range!,
				})),
			};
		}, signal);
	}
	newWorkbook(path: string, sheets: unknown, actor: ActivityActor = 'agent', signal?: AbortSignal) {
		return this.newDocument(path, [], actor, signal, workbookSheets(sheets));
	}
	readWorkbook(path?: string, input: unknown = {}, signal?: AbortSignal) {
		const scope = rangeInput(input);
		return this.#run(async () => {
			const source = path || this.#state.path;
			if (!source) throw new AppError('NO_WORKBOOK', 'Open or create a workbook first.');
			await this.#open(source);
			this.#signal?.throwIfAborted();
			return { path: this.#state.path, ...(await this.#bridge!.request('sheet-read', scope)) };
		}, signal);
	}
	editWorkbook(
		path: string,
		revision: unknown,
		input: unknown,
		actor: ActivityActor = 'agent',
		signal?: AbortSignal,
	) {
		const expectedRevision = officeRevision(revision);
		const operation = sheetOperation(input);
		return this.#run(async () => {
			await this.#open(path);
			this.#signal?.throwIfAborted();
			const result = await this.#bridge!.request('sheet-edit', { expectedRevision, operation });
			this.#revision = result.revision;
			this.#update({ dirty: true });
			return { entry: await this.#save(actor), revision: result.revision };
		}, signal);
	}
	chartWorkbook(
		path: string,
		revision: unknown,
		input: unknown,
		actor: ActivityActor = 'agent',
		signal?: AbortSignal,
	) {
		const expectedRevision = officeRevision(revision);
		const chart = sheetChart(input);
		return this.#run(async () => {
			await this.#open(path);
			this.#signal?.throwIfAborted();
			const result = await this.#bridge!.request('sheet-chart', { expectedRevision, chart });
			this.#revision = result.revision;
			this.#update({ dirty: true });
			return { entry: await this.#save(actor), revision: result.revision, chart: result.chart };
		}, signal);
	}
	exportChart(
		path: string,
		sheet: string,
		name: string,
		destination: string,
		actor: ActivityActor = 'agent',
		signal?: AbortSignal,
	) {
		sheetName(sheet);
		if (!name || name.length > 100)
			throw new AppError('INVALID_INPUT', 'Specify a chart name returned by sheets_read.');
		if (!destination.startsWith('/') || !/\.png$/i.test(destination))
			throw new AppError(
				'INVALID_INPUT',
				'Export charts to an absolute workspace path ending in .png.',
			);
		return this.#run(async () => {
			if (await workspaceService.exists(destination))
				throw new AppError(
					'PATH_EXISTS',
					'Choose a new destination; existing files are preserved.',
				);
			await this.#open(path);
			await this.#save(actor);
			const result = await this.#bridge!.request('sheet-export-chart', { sheet, name });
			this.#signal?.throwIfAborted();
			return workspaceService.writeBytes(destination, new Uint8Array(result.bytes), {
				createOnly: true,
				actor,
			});
		}, signal);
	}
	edit(
		path: string,
		revision: unknown,
		input: unknown,
		actor: ActivityActor = 'agent',
		signal?: AbortSignal,
	) {
		const expectedRevision = officeRevision(revision);
		const operation = documentOperation(input);
		return this.#run(async () => {
			await this.#open(path);
			return this.#applyEdit(expectedRevision, operation, actor);
		}, signal);
	}
	async #applyEdit(
		expectedRevision: number,
		operation: DocumentOperation,
		actor: ActivityActor,
		image?: Awaited<ReturnType<typeof prepareOfficeImage>>,
	) {
		if (operation.type === 'insert-image' && !image)
			image = await prepareOfficeImage(
				operation.imagePath,
				await workspaceService.readBytes(operation.imagePath),
			);
		this.#signal?.throwIfAborted();
		const result = await this.#bridge!.request('edit', { expectedRevision, operation, image });
		this.#revision = result.revision;
		this.#update({ dirty: true });
		const entry = await this.#save(actor);
		return { entry, revision: result.revision };
	}
	insertImage(target: ImageInsertionTarget, source: string | File, description = '') {
		return this.#run(async () => {
			if (!this.#loaded || this.#state.preview || this.#state.path !== target.path)
				throw new AppError(
					'DOCUMENT_CHANGED',
					'The open document changed. Close this picker and choose Insert Image again.',
				);
			const state = await this.#bridge!.request('state');
			if (state.revision !== target.revision)
				throw new AppError(
					'DOCUMENT_CHANGED',
					'The document was edited while choosing an image. Close this picker and choose Insert Image again.',
				);
			let imagePath: string;
			let image: Awaited<ReturnType<typeof prepareOfficeImage>> | undefined;
			if (typeof source === 'string') imagePath = normalizeWorkspacePath(source);
			else {
				if (source.size > maxImageBytes)
					throw new AppError('FILE_TOO_LARGE', 'Choose an image smaller than 10 MiB.');
				image = await prepareOfficeImage(source.name, new Uint8Array(await source.arrayBuffer()));
				const name = workspaceBasename(source.name);
				const stem = name.replace(/\.[^.]+$/, '');
				const extension = name.split('.').pop();
				imagePath = `/Pictures/${name}`;
				let index = 2;
				while (await workspaceService.exists(imagePath))
					imagePath = `/Pictures/${stem} ${index++}.${extension}`;
				await workspaceService.writeBytes(imagePath, image.bytes, { createOnly: true });
			}
			const result = await this.#applyEdit(
				target.revision,
				{
					type: 'insert-image',
					imagePath,
					position: 'cursor',
					description,
				},
				'human',
				image,
			);
			return { ...result, imagePath };
		});
	}
	exportDocument(
		path: string,
		{
			actor = 'human',
			source,
			signal,
			expectedSourcePath,
		}: {
			actor?: ActivityActor;
			source?: string;
			signal?: AbortSignal;
			expectedSourcePath?: string;
		} = {},
	) {
		return this.#run(async () => {
			this.#checkSource(expectedSourcePath);
			if (source) await this.#open(source);
			else await this.#ready();
			await this.#save(actor);
			const result = await this.#bridge!.request('serialize', { format: this.#format(path) });
			this.#signal?.throwIfAborted();
			const entry = await workspaceService.writeBytes(path, new Uint8Array(result.bytes), {
				createOnly: true,
				actor,
			});
			activityService.record({
				actor,
				action: 'Document exported',
				detail: `Exported ${workspaceBasename(path)}.`,
				path,
			});
			return entry;
		}, signal);
	}
	download(format: OfficeFormat) {
		return this.#run(async () => {
			await this.#ready();
			await this.#save();
			const result = await this.#bridge!.request('serialize', { format });
			const url = URL.createObjectURL(
				new Blob([new Uint8Array(result.bytes)], { type: mime[format] }),
			);
			const link = document.createElement('a');
			link.href = url;
			link.download =
				workspaceBasename(this.#state.path || 'Document').replace(/\.[^.]+$/, '') + '.' + format;
			link.click();
			setTimeout(() => URL.revokeObjectURL(url), 30_000);
		});
	}
	async beforeClose() {
		if (!this.#loaded) {
			this.#generation++;
			for (const waiter of this.#mountWaiters)
				waiter.reject(
					new AppError('DOCUMENTS_CLOSED', `${this.appName} was closed before loading completed.`),
				);
			this.#mountWaiters.clear();
			this.#update({ engineRequested: false, busy: false });
			return true;
		}
		const saving = this.save();
		const closingSequence = this.#operationSequence;
		await saving;
		// A newer request (for example opening a PDF while this save runs) wins
		// over the pending close, so its successful result stays visible.
		return closingSequence === this.#operationSequence;
	}
	async retry() {
		if (this.#loaded) return this.save();
		this.#bridge = null;
		this.#update({
			status: 'idle',
			message: '',
			engineRequested: false,
			engineSession: this.#state.engineSession + 1,
		});
		await this.show(true);
	}
}

export const officeService = new OfficeService();
export const sheetsService = new OfficeService('sheets');
