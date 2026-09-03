import { AppError } from '../errors';
export type NoteSelection = {
	text: string;
	before: string;
	after: string;
	// Only source/plain-text views have offsets into the stored text.
	sourceStart?: number;
	sourceEnd?: number;
};

export type NoteEditorSnapshot = {
	path: string;
	content: string;
	ready: boolean;
	visible: boolean;
	mode: 'formatted' | 'markdown' | 'plain';
	selection: NoteSelection | null;
};

let readEditor: (() => NoteEditorSnapshot) | undefined;
const listeners = new Set<() => void>();

export function noteEditorSnapshot() {
	return readEditor?.() ?? null;
}

export function notifyNoteEditor() {
	for (const listener of listeners) listener();
}

export function connectNoteEditor(read: () => NoteEditorSnapshot) {
	readEditor = read;
	notifyNoteEditor();
	return () => {
		if (readEditor === read) readEditor = undefined;
		notifyNoteEditor();
	};
}

// Svelte mounting and Milkdown creation have separate lifecycles. Resolve only
// when the actual editor is ready, without polling the DOM or driving controls.
export function waitForNoteEditor(path: string, signal: AbortSignal) {
	return new Promise<NoteEditorSnapshot>((resolve, reject) => {
		const finish = (error?: unknown, snapshot?: NoteEditorSnapshot) => {
			clearTimeout(timeout);
			listeners.delete(check);
			signal.removeEventListener('abort', abort);
			if (error) reject(error);
			else resolve(snapshot!);
		};
		const abort = () => finish(signal.reason);
		const check = () => {
			const snapshot = noteEditorSnapshot();
			if (snapshot && snapshot.path !== path) {
				finish(new AppError('NOTE_CHANGED', 'A different note is now open.'));
			} else if (snapshot?.ready) finish(undefined, snapshot);
		};
		const timeout = setTimeout(
			() =>
				finish(
					new AppError(
						'EDITOR_NOT_READY',
						'The note editor did not finish opening.',
						'Try desktop_reveal again to show the saved file.',
					),
				),
			10_000,
		);
		listeners.add(check);
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		else check();
	});
}
