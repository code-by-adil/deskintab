import { openApp } from '🍎/state/apps.svelte';

export type FinderAction = 'new-folder' | 'new-document';

export const finderState = $state({
	path: '/Projects/Launch',
	selectedPath: '',
	pendingAction: null as FinderAction | null,
});

export function requestFinderAction(action: FinderAction) {
	finderState.pendingAction = action;
	openApp('finder');
}

const listeners: Array<(state: { path: string; selectedPath: string }) => void> = [];

export function revealInFinder(path: string, selectedPath = '') {
	finderState.path = path;
	finderState.selectedPath = selectedPath;
	for (const listener of listeners) listener({ path, selectedPath });
}

export function subscribeToFinderReveal(
	listener: (state: { path: string; selectedPath: string }) => void,
) {
	listeners.push(listener);
	return () => {
		const index = listeners.indexOf(listener);
		if (index >= 0) listeners.splice(index, 1);
	};
}
