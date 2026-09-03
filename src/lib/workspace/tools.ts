import { tick } from 'svelte';
import { AppError } from '../errors';
import { apps } from '../../state/apps.svelte';
import { notepadService } from './notepad';
import { noteEditorSnapshot, waitForNoteEditor } from './notepad-editor';
import { textRevision } from './text-revision';
import { workspaceBasename } from './path';
import { workspaceService } from './workspace';
import {
	absolutePath,
	defineTool,
	optionalAbsolutePath,
	optionalBoolean,
	optionalInteger,
	optionalString,
	requiredString,
	successfulResult,
} from '../webmcp/tool-utils';

const pathProperty = {
	type: 'string',
	description: 'Absolute workspace path.',
};

const revisionProperty = {
	type: 'string',
	pattern: '^sha256:[a-f0-9]{64}$',
	description: 'files_read/notes_get_context revision; rejects changed files.',
};

function expectedRevision(input: Record<string, unknown>) {
	const revision = optionalString(input, 'expectedRevision', { maxLength: 71 });
	if (revision !== undefined && !/^sha256:[a-f0-9]{64}$/.test(revision)) {
		throw new AppError(
			'INVALID_INPUT',
			'expectedRevision must be a content revision returned by a read tool.',
		);
	}
	return revision;
}

async function finishNoteWrite(path: string, savedRevision: string, signal: AbortSignal) {
	await notepadService.refresh();
	await tick();
	let displayError: string | undefined;
	if (apps.open.textedit && noteEditorSnapshot()?.path === path) {
		try {
			await waitForNoteEditor(path, signal);
		} catch (error) {
			// The file is already saved. Report display failures separately so an
			// agent does not retry a successful mutation under a false failure.
			displayError = error instanceof Error ? error.message : String(error);
		}
	}
	const note = notepadService.getNote(path);
	const editor = apps.open.textedit ? noteEditorSnapshot() : null;
	const displayedRevision = editor?.ready ? await textRevision(editor.content) : null;
	return {
		saved: true,
		note: note ? { saveStatus: note.status, hasUnsavedChanges: note.content !== note.base } : null,
		displayed: Boolean(
			editor?.path === path &&
				editor.visible &&
				displayedRevision === savedRevision &&
				apps.open.textedit &&
				!apps.minimized.textedit,
		),
		...(displayError ? { displayError } : {}),
	};
}

export const workspaceTools: WebMCP.ModelContextTool[] = [
	defineTool({
		name: 'notes_get_context',
		title: 'Read note and selection',
		description:
			'Read current/last Notepad draft, revision, save state, selection; no opens/saves. Formatted selection is rendered text, not Markdown offsets. Match content for files_patch at expectedRevision. More saved text: files_read; open notes: desktop_reveal.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			properties: {
				maxChars: {
					type: 'integer',
					minimum: 1,
					maximum: 200000,
					default: 20000,
					description: 'Content/selection character limit.',
				},
			},
			additionalProperties: false,
		},
		async execute(input) {
			const maxChars = optionalInteger(input, 'maxChars', 20000, 1, 200000);
			await notepadService.ready();
			await notepadService.refresh();
			await tick();
			const note = { ...notepadService.current };
			const editor = apps.open.textedit ? noteEditorSnapshot() : null;
			const ready = editor?.path === note.path && editor.ready && editor.content === note.content;
			const selection = ready ? editor.selection : null;
			return successfulResult(
				{
					path: note.path,
					title: workspaceBasename(note.path),
					content: note.content.slice(0, maxChars),
					totalChars: note.content.length,
					truncated: note.content.length > maxChars,
					revision: note.status === 'loading' ? null : await textRevision(note.content),
					saveStatus: note.status,
					hasUnsavedChanges: note.content !== note.base,
					isOpen: apps.open.textedit,
					isFocused: apps.active === 'textedit' && !apps.minimized.textedit,
					editorReady: Boolean(ready),
					editorVisible: Boolean(
						ready && editor.visible && apps.open.textedit && !apps.minimized.textedit,
					),
					mode: editor?.mode ?? null,
					selection: selection
						? {
								...selection,
								text: selection.text.slice(0, maxChars),
								truncated: selection.text.length > maxChars,
							}
						: null,
					...(note.error ? { error: note.error } : {}),
				},
				`Read ${note.path}${selection ? ' and its selected passage' : ''}. Save status: ${note.status}.`,
			);
		},
	}),
	defineTool({
		name: 'files_list',
		title: 'List a folder',
		description: 'List immediate workspace folder contents.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			properties: { path: { ...pathProperty, default: '/' } },
			additionalProperties: false,
		},
		async execute(input) {
			const path = optionalAbsolutePath(input, 'path') ?? '/';
			const entries = await workspaceService.list(path);
			return successfulResult({ path, entries }, `Found ${entries.length} items in ${path}.`);
		},
	}),
	defineTool({
		name: 'files_stat',
		title: 'Inspect file or folder',
		description: 'Get type, size, modified time and normalized file/folder path.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path'],
			properties: { path: pathProperty },
			additionalProperties: false,
		},
		async execute(input) {
			const entry = await workspaceService.stat(absolutePath(input, 'path'));
			return successfulResult({ entry }, `${entry.path} is a ${entry.kind}.`);
		},
	}),
	defineTool({
		name: 'files_read',
		title: 'Read a text file',
		description:
			'Read saved UTF-8 lines and whole-file revision. notes_get_context reads live Notepad drafts/selections.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path'],
			properties: {
				path: pathProperty,
				startLine: {
					type: 'integer',
					minimum: 1,
					default: 1,
					description: 'First line, 1-based.',
				},
				maxLines: {
					type: 'integer',
					minimum: 1,
					maximum: 1000,
					default: 500,
					description: 'Line limit.',
				},
			},
			additionalProperties: false,
		},
		async execute(input) {
			const path = absolutePath(input, 'path');
			const startLine = optionalInteger(input, 'startLine', 1, 1, 1_000_000);
			const maxLines = optionalInteger(input, 'maxLines', 500, 1, 1_000);
			const content = await workspaceService.readText(path);
			const lines = content.split('\n');
			if (startLine > lines.length) {
				throw new AppError(
					'LINE_OUT_OF_RANGE',
					`${path} has ${lines.length} lines, so line ${startLine} cannot be read.`,
					'Use a startLine within the reported total line count.',
				);
			}
			const selected = lines.slice(startLine - 1, startLine - 1 + maxLines);
			const endLine = startLine + selected.length - 1;
			const truncated = endLine < lines.length;
			return successfulResult(
				{
					path,
					content: selected.join('\n'),
					revision: await textRevision(content),
					startLine,
					endLine,
					totalLines: lines.length,
					truncated,
				},
				`Read lines ${startLine}-${endLine} of ${lines.length} from ${path}.`,
			);
		},
	}),
	defineTool({
		name: 'files_write',
		title: 'Write a text file',
		description:
			'Write UTF-8. Replacement needs read revision; createOnly rejects existing paths. Saves safe Notepad edits; rejects draft/revision conflicts. Returns saved revision/display/save status.',
		annotations: { readOnlyHint: false, untrustedContentHint: false },
		inputSchema: {
			type: 'object',
			required: ['path', 'content'],
			properties: {
				path: pathProperty,
				content: { type: 'string', maxLength: 200000, description: 'Complete text.' },
				expectedRevision: revisionProperty,
				createOnly: {
					type: 'boolean',
					default: false,
					description: 'Reject existing paths; excludes expectedRevision.',
				},
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const path = absolutePath(input, 'path');
			const content = requiredString(input, 'content', { allowEmpty: true, maxLength: 200_000 });
			const revision = expectedRevision(input);
			const createOnly = optionalBoolean(input, 'createOnly');
			if (createOnly && revision)
				throw new AppError('INVALID_INPUT', 'createOnly and expectedRevision cannot be combined.');
			const beforeWrite = await notepadService.prepareAgentWrite(path);
			const entry = await workspaceService.writeText(path, content, {
				actor: 'agent',
				expectedRevision: revision,
				requireRevision: true,
				createOnly,
				beforeWrite: () => {
					signal.throwIfAborted();
					beforeWrite();
				},
			});
			const savedRevision = await textRevision(content);
			const state = await finishNoteWrite(entry.path, savedRevision, signal);
			return successfulResult(
				{ entry, created: !revision, revision: savedRevision, ...state },
				`${revision ? 'Updated' : 'Created'} ${entry.path}.${state.note?.hasUnsavedChanges ? ' A newer human draft is also present in Notepad.' : ''}`,
			);
		},
	}),
	defineTool({
		name: 'files_patch',
		title: 'Edit exact text',
		description:
			'Replace exact text at files_read/notes_get_context revision. Rejects stale revisions/wrong match count. Saves safe Notepad edits; returns saved revision/display/save status.',
		annotations: { readOnlyHint: false, untrustedContentHint: false },
		inputSchema: {
			type: 'object',
			required: ['path', 'find', 'replace'],
			properties: {
				path: pathProperty,
				find: {
					type: 'string',
					minLength: 1,
					maxLength: 50000,
					description: 'Exact old text.',
				},
				replace: {
					type: 'string',
					maxLength: 50000,
					description: 'New text; empty deletes.',
				},
				expectedOccurrences: {
					type: 'integer',
					minimum: 1,
					maximum: 1000,
					default: 1,
					description: 'Required match count.',
				},
				expectedRevision: revisionProperty,
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const path = absolutePath(input, 'path');
			const find = requiredString(input, 'find', { maxLength: 50_000 });
			const replace = requiredString(input, 'replace', { allowEmpty: true, maxLength: 50_000 });
			const expected = optionalInteger(input, 'expectedOccurrences', 1, 1, 1_000);
			const revision = expectedRevision(input);
			const beforeWrite = await notepadService.prepareAgentWrite(path);
			const result = await workspaceService.patchText(path, find, replace, expected, {
				actor: 'agent',
				expectedRevision: revision,
				beforeWrite: () => {
					signal.throwIfAborted();
					beforeWrite();
				},
			});
			const state = await finishNoteWrite(result.entry.path, result.revision, signal);
			return successfulResult(
				{ ...result, ...state },
				`Edited ${path} with ${result.replacements} exact replacement${result.replacements === 1 ? '' : 's'}.${state.note?.hasUnsavedChanges ? ' A newer human draft is also present in Notepad.' : ''}`,
			);
		},
	}),
	defineTool({
		name: 'files_search',
		title: 'Search files',
		description: 'Search names and UTF-8 text below a folder; includeTrash enables Trash results.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['query'],
			properties: {
				query: { type: 'string', minLength: 1, maxLength: 500, description: 'Text to find.' },
				path: { ...pathProperty, default: '/' },
				includeTrash: {
					type: 'boolean',
					default: false,
					description: 'Include /Trash, even if path is /Trash.',
				},
				limit: {
					type: 'integer',
					minimum: 1,
					maximum: 100,
					default: 50,
					description: 'File match limit.',
				},
			},
			additionalProperties: false,
		},
		async execute(input) {
			const query = requiredString(input, 'query', { maxLength: 500 });
			const path = optionalAbsolutePath(input, 'path') ?? '/';
			const limit = optionalInteger(input, 'limit', 50, 1, 100);
			const includeTrash = optionalBoolean(input, 'includeTrash');
			const results = await workspaceService.search(query, path, limit, { includeTrash });
			return successfulResult(
				{ query, path, includeTrash, results },
				`Found ${results.length} matching files.`,
			);
		},
	}),
	defineTool({
		name: 'files_mkdir',
		title: 'Create a folder',
		description: 'Create a folder and missing parents.',
		annotations: { readOnlyHint: false, untrustedContentHint: false },
		inputSchema: {
			type: 'object',
			required: ['path'],
			properties: { path: pathProperty },
			additionalProperties: false,
		},
		async execute(input) {
			const path = absolutePath(input, 'path');
			const existed = await workspaceService.exists(path);
			const entry = await workspaceService.createDirectory(path, { actor: 'agent' });
			return successfulResult(
				{ entry, created: !existed },
				existed ? `${entry.path} already exists.` : `Created ${entry.path}.`,
			);
		},
	}),
	defineTool({
		name: 'files_move',
		title: 'Move or rename',
		description: 'Move/rename a file or folder; overwrite replaces the destination.',
		annotations: { readOnlyHint: false, untrustedContentHint: false },
		inputSchema: {
			type: 'object',
			required: ['source', 'destination'],
			properties: {
				source: { ...pathProperty, description: 'Existing source path.' },
				destination: { ...pathProperty, description: 'New absolute path.' },
				overwrite: {
					type: 'boolean',
					default: false,
					description: 'Replace destination.',
				},
			},
			additionalProperties: false,
		},
		async execute(input) {
			const source = absolutePath(input, 'source');
			const destination = absolutePath(input, 'destination');
			const overwrite = optionalBoolean(input, 'overwrite');
			const entry = await workspaceService.move(source, destination, { actor: 'agent', overwrite });
			return successfulResult({ entry, source, destination }, `Moved ${source} to ${destination}.`);
		},
	}),
	defineTool({
		name: 'files_copy',
		title: 'Copy file or folder',
		description: 'Copy a file or folder; overwrite replaces the destination.',
		annotations: { readOnlyHint: false, untrustedContentHint: false },
		inputSchema: {
			type: 'object',
			required: ['source', 'destination'],
			properties: {
				source: { ...pathProperty, description: 'Existing source path.' },
				destination: { ...pathProperty, description: 'Absolute destination.' },
				overwrite: {
					type: 'boolean',
					default: false,
					description: 'Replace destination.',
				},
			},
			additionalProperties: false,
		},
		async execute(input) {
			const source = absolutePath(input, 'source');
			const destination = absolutePath(input, 'destination');
			const overwrite = optionalBoolean(input, 'overwrite');
			const entry = await workspaceService.copy(source, destination, { actor: 'agent', overwrite });
			return successfulResult(
				{ entry, source, destination },
				`Copied ${source} to ${destination}.`,
			);
		},
	}),
	defineTool({
		name: 'files_trash',
		title: 'Trash file or folder',
		description: 'Move to /Trash. Returns original/trash paths for restoration with files_move.',
		annotations: { readOnlyHint: false, untrustedContentHint: false },
		inputSchema: {
			type: 'object',
			required: ['path'],
			properties: { path: pathProperty },
			additionalProperties: false,
		},
		async execute(input) {
			const result = await workspaceService.trash(absolutePath(input, 'path'), { actor: 'agent' });
			return successfulResult(result, `Moved ${result.originalPath} to ${result.trashPath}.`);
		},
	}),
];
