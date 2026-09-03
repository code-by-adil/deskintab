import { AppError } from '../errors';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import {
	WorkspaceJson,
	appFilePath,
	boundedText,
	checkFileLink,
	fileLink,
} from '../workspace/json-document';
import { workspaceService } from '../workspace/workspace';
import type { ActivityActor } from '../activity/activity';
import {
	CANVAS_MAX_BYTES,
	emptyScene,
	nativeScene,
	parseCanvasFile,
	sceneKey,
	type CanvasFile,
	type Scene,
} from './scene';
import { loadCanvasSDK } from './sdk';
import { applyOperations, type CanvasOperation } from './operations';
export { isCanvasPath, parseCanvasFile } from './scene';
export type { CanvasOperation } from './operations';

export const canvasDocument = new WorkspaceJson<CanvasFile>(
	['.excalidraw', '.canvas.json'],
	'/Documents/Untitled.excalidraw',
	'/System/canvas-session.json',
	emptyScene,
	parseCanvasFile,
	CANVAS_MAX_BYTES,
);
type Status = 'loading' | 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';
let scene: Scene | null = null,
	path: string | null = null,
	revision: string | null = null;
let status: Status = 'loading',
	error = '',
	selectedIds: string[] = [],
	pointerDown = false,
	editing = false,
	generation = 0;
let api: ExcalidrawImperativeAPI | null = null;
let savedKey = '',
	saving: Promise<void> | null = null,
	loading: Promise<void> = Promise.resolve(),
	loadTurn = 0;
let ensuring: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let userInput = false;
const listeners = new Set<() => void>();
const emit = () => {
	for (const listener of listeners) listener();
};
const dirty = () => !!scene && sceneKey(scene) !== savedKey;
const busy = () => pointerDown || editing;
const fail = (cause: unknown) => {
	error = cause instanceof Error ? cause.message : String(cause);
	status = cause instanceof AppError && cause.code === 'FILE_CHANGED' ? 'conflict' : 'error';
	emit();
};
function requireIdle() {
	if (busy())
		throw new AppError(
			'CANVAS_BUSY',
			'Finish the current stroke or text edit, then retry. Your drawing has not been replaced.',
		);
}
async function showScene(next: Scene, reset = false, undoable = false) {
	if (!api) return;
	const sdk = await loadCanvasSDK();
	userInput = false;
	api.addFiles(Object.values(next.files));
	api.updateScene({
		elements: next.elements,
		appState: {
			...next.appState,
			selectedElementIds: reset ? {} : api.getAppState().selectedElementIds,
		},
		captureUpdate: undoable ? sdk.CaptureUpdateAction.IMMEDIATELY : sdk.CaptureUpdateAction.NEVER,
	});
	if (reset) {
		api.history.clear();
		api.scrollToContent(next.elements, { fitToContent: true, maxZoom: 1 });
	}
}
function syncDocument() {
	const record = canvasDocument.snapshot();
	if (saving || !record.data || !record.revision || !record.path) {
		if (record.error && !saving) {
			error = record.error;
			status = dirty() ? 'conflict' : 'error';
			emit();
		}
		return loading;
	}
	if (record.path === path && record.revision === revision) return loading;
	if (dirty() || busy()) {
		status = 'conflict';
		error =
			'The saved file changed while you were drawing. Save your drawing as a copy, or reload the saved version.';
		emit();
		return loading;
	}
	const turn = ++loadTurn;
	loading = (async () => {
		const next = await nativeScene(record.data!);
		if (turn !== loadTurn || dirty() || busy()) return;
		const reset = path !== record.path;
		path = record.path;
		revision = record.revision;
		scene = next;
		savedKey = sceneKey(next);
		status = 'saved';
		error = '';
		generation++;
		if (reset) selectedIds = [];
		await showScene(next, reset);
		emit();
	})().catch(fail);
	return loading;
}
canvasDocument.subscribe(() => {
	void syncDocument();
});
canvasDocument.setPendingGuard((candidate) => candidate === path && (dirty() || busy()));
canvasDocument.setOpenGuard(async () => {
	if (scene) await canvasService.save();
});
canvasDocument.setCloseGuard(async () => {
	try {
		await canvasService.save();
		return true;
	} catch (cause) {
		fail(cause);
		return false;
	}
});
workspaceService.subscribeToMoves((from, to) => {
	if (path && (path === from || path.startsWith(`${from}/`))) {
		path = to + path.slice(from.length);
		emit();
	}
});
function scheduleSave() {
	clearTimeout(timer);
	if (!busy() && dirty() && status !== 'conflict')
		timer = setTimeout(() => {
			void canvasService.save().catch(fail);
		}, 450);
}
function downloadable(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob),
		a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const canvasService = {
	document: canvasDocument,
	snapshot() {
		return {
			path,
			title: scene?.title ?? 'Canvas',
			status,
			error,
			warning: canvasDocument.snapshot().warning,
			revision,
			elementCount: scene?.elements.length ?? 0,
			selectedIds: [...selectedIds],
			mounted: !!api,
		};
	},
	subscribe(listener: () => void) {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	selection() {
		return [...selectedIds];
	},
	select(ids: string[]) {
		selectedIds = ids.filter((id) => scene?.elements.some((e) => e.id === id));
		api?.updateScene({
			appState: { selectedElementIds: Object.fromEntries(selectedIds.map((id) => [id, true])) },
		});
		emit();
	},
	async ensure() {
		ensuring ??= (async () => {
			await canvasDocument.ensure();
			for (;;) {
				// Opening a known path can still be reading its file when the editor mounts.
				if (canvasDocument.snapshot().loading) {
					await new Promise<void>((resolve) => {
						const unsubscribe = canvasDocument.subscribe(() => {
							if (!canvasDocument.snapshot().loading) {
								unsubscribe();
								resolve();
							}
						});
					});
				}
				const currentLoad = syncDocument();
				await currentLoad;
				// Another open or refresh may have superseded the scene conversion we awaited.
				const document = canvasDocument.snapshot();
				if (document.loading || currentLoad !== loading) continue;
				if (document.error || !scene)
					throw new AppError(
						'OPEN_FAILED',
						document.error || error || 'Canvas could not be loaded.',
					);
				return;
			}
		})().finally(() => {
			ensuring = null;
		});
		await ensuring;
	},
	current() {
		return scene ? structuredClone(scene) : emptyScene();
	},
	attach(editor: ExcalidrawImperativeAPI) {
		api = editor;
		emit();
		return () => {
			if (api === editor) {
				api = null;
				pointerDown = false;
				editing = false;
				emit();
				scheduleSave();
			}
		};
	},
	reportError: fail,
	hasPendingEdits() {
		return dirty() || busy();
	},
	pointer(active: boolean) {
		pointerDown = active;
		if (!active) scheduleSave();
	},
	input() {
		userInput = true;
	},
	changed(elements: readonly ExcalidrawElement[], app: AppState, files: BinaryFiles) {
		if (!scene) return;
		editing = !!app.editingTextElement;
		const selection = Object.keys(app.selectedElementIds)
			.map(String)
			.filter((id) => app.selectedElementIds[id]);
		const selectionChanged = selection.join('|') !== selectedIds.join('|');
		selectedIds = selection;
		try {
			const active = elements.filter((e) => !e.isDeleted),
				used = new Set<string>(
					active.flatMap((e) => (e.type === 'image' && e.fileId ? [e.fileId] : [])),
				);
			const next = parseCanvasFile({
				...scene,
				elements: active,
				appState: app,
				files: Object.fromEntries(Object.entries(files).filter(([id]) => used.has(id))),
			}) as Scene;
			// Excalidraw repairs imported geometry and font metrics during initialization.
			// Treat that as a display baseline, not a human edit of the source file.
			if (!userInput) {
				if (next.elements.length === scene.elements.length) {
					scene = next;
					savedKey = sceneKey(next);
				}
				if (selectionChanged) emit();
				return;
			}
			if (sceneKey(next) !== sceneKey(scene)) {
				scene = next;
				generation++;
				if (status !== 'conflict') {
					status = dirty() ? 'dirty' : 'saved';
					error = '';
				}
				emit();
				scheduleSave();
			} else if (selectionChanged) emit();
			if (!busy()) scheduleSave();
		} catch (cause) {
			fail(cause);
		}
	},
	async save(): Promise<void> {
		clearTimeout(timer);
		requireIdle();
		if (saving) {
			await saving;
			return this.save();
		}
		if (!scene || !path || !revision || !dirty()) return;
		if (status === 'conflict') throw new AppError('FILE_CHANGED', error);
		const draft = structuredClone(scene),
			key = sceneKey(draft),
			target = path,
			base = revision;
		status = 'saving';
		emit();
		saving = (async () => {
			const result = await canvasDocument.write(target, draft, base, false, 'human');
			if (path === target) {
				revision = result.revision;
				savedKey = key;
				status = dirty() ? 'dirty' : 'saved';
				error = '';
			}
		})();
		try {
			await saving;
		} catch (cause) {
			fail(cause);
			throw cause;
		} finally {
			saving = null;
			emit();
		}
		if (dirty()) scheduleSave();
		else await syncDocument();
	},
	async read(candidate?: string) {
		const target = appFilePath(
			candidate ?? path ?? (await canvasDocument.resolvePath()),
			canvasDocument.suffix,
		);
		if (target === path) await this.save();
		const record = await canvasDocument.read(target);
		return { ...record, data: await nativeScene(record.data) };
	},
	async create(target: string, title: string) {
		await this.save();
		await canvasDocument.write(
			target,
			emptyScene(boundedText(title, 'Title', 120)),
			undefined,
			true,
			'human',
		);
		await canvasDocument.open(target);
		await syncDocument();
	},
	async saveCopy(target: string) {
		requireIdle();
		if (!scene) throw new AppError('NO_DOCUMENT', 'Open a scene first.');
		const draft = structuredClone(scene),
			turn = generation,
			originalPath = path;
		const result = await canvasDocument.write(target, draft, undefined, true, 'human');
		if (generation !== turn || busy() || path !== originalPath) {
			error = `A copy was saved to ${result.path}. Newer edits remain in the current canvas.`;
			emit();
			return;
		}
		savedKey = sceneKey(scene);
		status = 'saved';
		error = '';
		await canvasDocument.open(result.path);
		await syncDocument();
	},
	async discard() {
		requireIdle();
		savedKey = scene ? sceneKey(scene) : '';
		revision = null;
		status = 'loading';
		error = '';
		await canvasDocument.refresh();
		await syncDocument();
	},
	async importFile(file: File, target: string) {
		if (file.size > CANVAS_MAX_BYTES)
			throw new AppError('FILE_TOO_LARGE', 'Import a scene smaller than 20 MB.');
		let parsed: CanvasFile;
		try {
			parsed = parseCanvasFile(JSON.parse(await file.text()));
		} catch (cause) {
			throw new AppError('INVALID_DATA', `Cannot import this scene: ${String(cause)}`);
		}
		const next = await nativeScene(parsed);
		await this.save();
		await canvasDocument.write(target, next, undefined, true, 'human');
		await canvasDocument.open(target);
		await syncDocument();
	},
	async download() {
		await this.save();
		if (!scene) return;
		downloadable(
			new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' }),
			`${scene.title.replace(/[\\/:]/g, '-')}.excalidraw`,
		);
	},
	fit() {
		if (scene) api?.scrollToContent(scene.elements, { fitToContent: true, maxZoom: 1 });
	},
	async setSelectionLink(link: string | null) {
		const checked = fileLink(link);
		await checkFileLink(checked);
		if (!path || !revision || !selectedIds.length) return;
		await this.save();
		await this.edit(
			path,
			selectedIds.map((id) => ({ op: 'update', id, changes: { link: checked } })),
			{ expectedRevision: revision!, actor: 'human' },
		);
	},
	async edit(
		target: string,
		operations: CanvasOperation[],
		options: {
			create?: { title: string; width?: number; height?: number };
			expectedRevision?: string;
			actor?: ActivityActor;
			signal?: AbortSignal;
		} = {},
	) {
		target = appFilePath(target, canvasDocument.suffix);
		if (target === path) await this.save();
		const turn = generation;
		const base = options.create ? null : await canvasDocument.read(target);
		if (base && base.revision !== options.expectedRevision)
			throw new AppError(
				'FILE_CHANGED',
				'Read canvas_read and use its current revision before editing.',
			);
		const next = await applyOperations(
			base
				? await nativeScene(base.data)
				: emptyScene(boundedText(options.create?.title, 'Title', 120)),
			operations,
			options.signal,
		);
		const guard = () => {
			if (target === path) {
				requireIdle();
				if (generation !== turn || dirty())
					throw new AppError(
						'FILE_CHANGED',
						'The human changed this sketch. Read canvas_read again before editing.',
					);
			}
		};
		guard();
		if (saving) await saving;
		let result!: Awaited<ReturnType<typeof canvasDocument.write>>;
		let draftConflict = false;
		saving = (async () => {
			result = await canvasDocument.write(
				target,
				next,
				base?.revision,
				!base,
				options.actor ?? 'human',
				options.signal,
				guard,
			);
		})();
		try {
			await saving;
			if (target === path) {
				if (generation !== turn || dirty() || busy()) {
					draftConflict = true;
					status = 'conflict';
					error =
						'The agent save completed while a new human edit began. Your draft is preserved; save it as a copy or reload the saved version.';
					emit();
				} else {
					scene = next;
					revision = result.revision;
					savedKey = sceneKey(next);
					generation++;
					status = 'saved';
					error = '';
					await showScene(next, false, true);
					emit();
				}
			}
		} finally {
			saving = null;
		}
		return { ...result, data: next, ...(draftConflict ? { draftConflict: true } : {}) };
	},
	async render(data: Scene, maxSize = 1600) {
		const sdk = await loadCanvasSDK();
		const canvas = await sdk.exportToCanvas({
			elements: data.elements.filter((e) => !e.isDeleted),
			appState: { ...data.appState, exportBackground: true, exportWithDarkMode: false },
			files: data.files,
			maxWidthOrHeight: maxSize,
			exportPadding: 30,
		});
		const blob = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(value) => (value ? resolve(value) : reject(new Error('PNG export failed.'))),
				'image/png',
			),
		);
		return { blob, width: canvas.width, height: canvas.height };
	},
	async export(
		target: string,
		destination: string,
		expectedRevision: string,
		actor: ActivityActor = 'human',
		signal?: AbortSignal,
	) {
		const record = await this.read(target);
		if (record.revision !== expectedRevision)
			throw new AppError('FILE_CHANGED', 'The scene changed. Read it before exporting.');
		if (!destination.startsWith('/') || !destination.toLowerCase().endsWith('.png'))
			throw new AppError('INVALID_PATH', 'Choose an absolute workspace .png path.');
		const rendered = await this.render(record.data);
		signal?.throwIfAborted();
		const entry = await workspaceService.writeBytes(
			destination,
			new Uint8Array(await rendered.blob.arrayBuffer()),
			{ actor, createOnly: true },
		);
		return {
			path: destination,
			sourcePath: target,
			sourceRevision: record.revision,
			width: rendered.width,
			height: rendered.height,
			entry,
		};
	},
};
