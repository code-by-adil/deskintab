import type { AppID } from '🍎/state/apps.svelte.ts';

export type DesktopCommand =
	| 'undo'
	| 'redo'
	| 'bold'
	| 'italic'
	| 'title'
	| 'heading'
	| 'subheading'
	| 'body'
	| 'bullet'
	| 'ordered'
	| 'checklist'
	| 'add-link'
	| 'download'
	| 'toggle-notes'
	| 'toggle-source'
	| 'clear'
	| 'close'
	| 'copy-result'
	| 'duplicate'
	| 'find'
	| 'go-documents'
	| 'go-notes'
	| 'go-projects'
	| 'go-trash'
	| 'minimize'
	| 'new-document'
	| 'new-folder'
	| 'open'
	| 'rename'
	| 'save'
	| 'select-all'
	| 'trash'
	| 'zoom';

export interface DesktopCommandEvent {
	target: AppID;
	command: DesktopCommand;
}

type DesktopCommandListener = (event: DesktopCommandEvent) => void;

const listeners = new Set<DesktopCommandListener>();

export function issueDesktopCommand(target: AppID, command: DesktopCommand) {
	for (const listener of listeners) listener({ target, command });
}

export function subscribeToDesktopCommands(listener: DesktopCommandListener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
