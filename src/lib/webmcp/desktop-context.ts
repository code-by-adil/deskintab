import { apps, type AppID } from '../../state/apps.svelte';
import { apps_config } from '../../configs/apps/apps-config';
import { finderState } from '../workspace/finder-state.svelte';
import { workspaceService } from '../workspace/workspace';
import { notepadService } from '../workspace/notepad';
import { noteEditorSnapshot } from '../workspace/notepad-editor';
import { officeService, sheetsService } from '../office/office';
import { previewService } from '../preview/preview';
import { canvasService } from '../canvas/canvas';
import { terminalService } from '../terminal/terminal';
import { homeService, homeDocument, HOME_PROFILE_PATH } from '../home/home';
import { inboxDocument } from '../inbox/inbox';
import { shortcutDocument } from '../shortcuts/shortcuts';
import { studioDocument } from '../studio/studio';
import {
	isAppVisible,
	tasksInteractionContext,
	projectsInteractionContext,
	reviewInteractionContext,
} from '../workspace/interaction-context';

// Read only the state the apps already hold. Do not restore sessions, mount an
// editor, or save pending work just to answer what the person is looking at.
export async function desktopGetContext() {
	const home = await homeService.getContext();
	const documentContext = (
		id: AppID,
		document: {
			snapshot(): { path: string | null; revision: string | null; loading: boolean; error: string };
			hasPendingEdits(path: string): boolean;
		},
		readTool: string,
	) => {
		if (!isAppVisible(id)) return null;
		const state = document.snapshot();
		return {
			path: state.path,
			revision: state.revision,
			loading: state.loading,
			error: state.error,
			pendingEdits: state.path ? document.hasPendingEdits(state.path) : false,
			readTool,
		};
	};
	const openApps = (Object.keys(apps.open) as AppID[])
		.filter((id) => apps.open[id])
		.sort((a, b) => apps.z_indices[b] - apps.z_indices[a])
		.map((id) => ({
			id,
			title: apps_config[id].title,
			minimized: apps.minimized[id],
			focused: isAppVisible(id) && apps.active === id,
		}));
	const note = isAppVisible('textedit') ? noteEditorSnapshot() : null;
	const canvas = canvasService.snapshot();
	const preview = previewService.context();
	const officeContext = (service: typeof officeService) => {
		const state = service.snapshot();
		return {
			path: state.path,
			previewPath: state.preview?.path ?? null,
			status: state.status,
			dirty: state.dirty,
			busy: state.busy,
			selectionTool: service.appId === 'sheets' ? 'sheets_read' : 'documents_read',
		};
	};
	return {
		workingPreferences: {
			path: HOME_PROFILE_PATH,
			configured: home.profile?.exists ?? false,
			briefText: home.briefText.slice(0, 8000),
			truncated: home.briefText.length > 8000,
			readTool: 'home_get_context',
		},
		activeApp: openApps.find((app) => app.focused)?.id ?? null,
		openApps,
		context: {
			home: isAppVisible('home')
				? {
						path: HOME_PROFILE_PATH,
						pendingEdits: homeDocument.hasPendingEdits(HOME_PROFILE_PATH),
						readTool: 'home_get_context',
					}
				: null,
			inbox: documentContext('inbox', inboxDocument, 'inbox_read'),
			shortcuts: documentContext('shortcuts', shortcutDocument, 'shortcuts_read'),
			studio: documentContext('studio', studioDocument, 'studio_read'),
			finder: isAppVisible('finder')
				? {
						path: finderState.path,
						selectedPath:
							finderState.selectedPath &&
							workspaceService.getAllPaths().includes(finderState.selectedPath)
								? finderState.selectedPath
								: null,
					}
				: null,
			notepad: isAppVisible('textedit')
				? {
						path: notepadService.path,
						status: notepadService.current.status,
						mode: note?.mode ?? null,
						selection:
							note?.visible &&
							note.ready &&
							note.path === notepadService.path &&
							note.content === notepadService.current.content
								? note.selection
								: null,
					}
				: null,
			documents: isAppVisible('documents') ? officeContext(officeService) : null,
			sheets: isAppVisible('sheets') ? officeContext(sheetsService) : null,
			preview: isAppVisible('preview') ? preview : null,
			canvas: isAppVisible('canvas')
				? {
						...canvas,
						selectedIds: canvas.mounted ? canvas.selectedIds : [],
						pendingEdits: canvasService.hasPendingEdits(),
					}
				: null,
			tasks: tasksInteractionContext(),
			projects: projectsInteractionContext(),
			review: reviewInteractionContext(),
			terminal: isAppVisible('terminal') ? { cwd: terminalService.cwd } : null,
		},
	};
}
