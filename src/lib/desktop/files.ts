import { waitForApp, appNavigationContext } from './navigation';
import { tick } from 'svelte';
import { openApp } from '../../state/apps.svelte';
import { AppError } from '../errors';
import { workspaceService, type WorkspaceEntry } from '../workspace/workspace';
import { workspaceDirname } from '../workspace/path';
import { revealInFinder } from '../workspace/finder-state.svelte';
import { notepadService } from '../workspace/notepad';
import { noteEditorSnapshot, waitForNoteEditor } from '../workspace/notepad-editor';
import { notepadView } from '../workspace/notepad-view.svelte';
import { isDocumentPath, isSheetPath, officeService, sheetsService } from '../office/office';
import { isPreviewPath, previewService } from '../preview/preview';
import { isTasksPath, tasksDocument } from '../tasks/tasks';
import { isCanvasPath, canvasDocument, canvasService } from '../canvas/canvas';
import { isProjectPath, projectsDocument } from '../projects/projects';
import { HOME_PROFILE_PATH, homeService } from '../home/home';
import { isInboxPath, inboxDocument } from '../inbox/inbox';
import { isShortcutPath, shortcutDocument } from '../shortcuts/shortcuts';
import { isStudioPath, studioService } from '../studio/studio';

export const revealTargets = [
	'home',
	'inbox',
	'shortcuts',
	'studio',
	'projects',
	'finder',
	'textedit',
	'documents',
	'sheets',
	'preview',
	'tasks',
	'canvas',
	'terminal',
	'activity',
	'calculator',
	'wallpapers',
] as const;

export type RevealTarget = (typeof revealTargets)[number];
type FileApp = Exclude<
	RevealTarget,
	'finder' | 'terminal' | 'activity' | 'calculator' | 'wallpapers'
>;

export function appForFile(entry: Pick<WorkspaceEntry, 'path' | 'kind'>): FileApp | 'finder' {
	if (entry.kind === 'directory') return 'finder';
	if (entry.path === HOME_PROFILE_PATH) return 'home';
	if (isInboxPath(entry.path)) return 'inbox';
	if (isShortcutPath(entry.path)) return 'shortcuts';
	if (isStudioPath(entry.path)) return 'studio';
	if (isProjectPath(entry.path)) return 'projects';
	if (isTasksPath(entry.path)) return 'tasks';
	if (isCanvasPath(entry.path)) return 'canvas';
	if (isPreviewPath(entry.path)) return 'preview';
	if (isSheetPath(entry.path)) return 'sheets';
	if (isDocumentPath(entry.path)) return 'documents';
	return 'textedit';
}

const fileOpeners: Record<FileApp, (path: string, signal: AbortSignal) => Promise<unknown>> = {
	home: (path) => {
		if (path !== HOME_PROFILE_PATH)
			throw new AppError(
				'INVALID_PATH',
				'Home opens /Home/profile.json. Open other files in Finder or Notepad.',
			);
		return homeService.read();
	},
	inbox: (path) => inboxDocument.open(path),
	shortcuts: (path) => shortcutDocument.open(path),
	studio: (path) => studioService.open(path),
	projects: (path) => projectsDocument.open(path),
	textedit: async (path) => {
		const note = await notepadService.open(path);
		if (note.status === 'missing')
			throw new AppError('FILE_MISSING', note.error || 'This note is unavailable.');
		await notepadService.refresh();
	},
	documents: (path) => officeService.open(path),
	sheets: (path) => sheetsService.open(path),
	preview: (path, signal) => previewService.open(path, 1, signal),
	tasks: (path) => tasksDocument.open(path),
	canvas: (path) => canvasDocument.open(path),
};

// Finder, result links, and WebMCP all open files through this command.
export async function revealDesktop(options: {
	path?: string;
	target?: RevealTarget;
	signal?: AbortSignal;
}) {
	const signal = options.signal ?? new AbortController().signal;
	signal.throwIfAborted();
	if (!options.target && !options.path)
		throw new AppError('INVALID_INPUT', 'Provide an app, a workspace path, or both.');

	const entry = options.path ? await workspaceService.stat(options.path) : undefined;
	const target = options.target ?? appForFile(entry!);
	const path = entry?.path;
	if (path && ['terminal', 'activity', 'calculator', 'wallpapers'].includes(target))
		throw new AppError('INVALID_INPUT', 'Open this app without a file path.');
	if (entry?.kind === 'directory' && target !== 'finder')
		throw new AppError('NOT_A_FILE', `${entry.path} is a folder. Open it in Finder.`);

	signal.throwIfAborted();
	openApp(target);
	if (target === 'finder' && entry) {
		revealInFinder(
			entry.kind === 'directory' ? entry.path : workspaceDirname(entry.path),
			entry.kind === 'file' ? entry.path : '',
		);
	} else if (
		target !== 'finder' &&
		target !== 'terminal' &&
		target !== 'activity' &&
		target !== 'calculator' &&
		target !== 'wallpapers'
	) {
		const filePath = path ?? (target === 'textedit' ? notepadService.path : undefined);
		if (filePath) await fileOpeners[target](filePath, signal);
	}
	await tick();
	await waitForApp(target, signal);
	if (target === 'textedit') {
		if (noteEditorSnapshot()?.visible === false) {
			notepadView.sidebar = false;
			await tick();
		}
		const editor = await waitForNoteEditor(path ?? notepadService.path, signal);
		return {
			target,
			...(entry ? { entry } : {}),
			editorReady: true,
			mode: editor.mode,
			saveStatus: notepadService.current.status,
		};
	}
	const view =
		target === 'documents' || target === 'sheets'
			? (target === 'documents' ? officeService : sheetsService).snapshot()
			: target === 'canvas'
				? canvasService.snapshot()
				: appNavigationContext(target as Parameters<typeof appNavigationContext>[0]);
	return {
		target,
		...(entry ? { entry } : {}),
		appReady: true,
		view,
	};
}
