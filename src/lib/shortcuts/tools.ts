import { openApp } from '../../state/apps.svelte';
import {
	shortcutService,
	shortcutsDocument,
	type ShortcutInput,
	type PrepareShortcutInput,
} from './shortcuts';
import { objectValue } from '../workspace/json-document';
import { absolutePath, defineTool, requiredString, successfulResult } from '../webmcp/tool-utils';

const path = {
	type: 'string',
	maxLength: 2048,
	description: 'Absolute .shortcut.json outside System/Trash.',
};
const revision = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const fields = {
	title: { type: 'string', minLength: 1, maxLength: 160 },
	description: { type: 'string', maxLength: 1000 },
	procedure: {
		type: 'string',
		minLength: 1,
		maxLength: 16000,
		description: 'Saved procedure guidance; never auto-executed.',
	},
	requiredInputs: {
		type: 'array',
		maxItems: 20,
		uniqueItems: true,
		items: { type: 'string', minLength: 1, maxLength: 300 },
		description: 'Agent checklist. Preparation checks input presence only.',
	},
	sourcePaths: {
		type: 'array',
		maxItems: 30,
		uniqueItems: true,
		items: { type: 'string', maxLength: 2048 },
		description: 'Existing template/reference files outside System/Trash.',
	},
	outputGuidance: { type: 'string', minLength: 1, maxLength: 4000 },
};
async function show(path: string) {
	openApp('shortcuts');
	try {
		await shortcutsDocument.open(path);
		return {};
	} catch (cause) {
		return { displayWarning: cause instanceof Error ? cause.message : String(cause) };
	}
}
export const shortcutTools: WebMCP.ModelContextTool[] = [
	defineTool({
		name: 'shortcuts_list',
		title: 'List shortcuts',
		description:
			'List up to 100 shortcuts, input counts, and malformed-file warnings. Opens/creates nothing. Use shortcuts_read for procedure/revision.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		async execute() {
			const result = await shortcutService.list();
			return successfulResult(result, `Found ${result.shortcuts.length} shortcuts.`);
		},
	}),
	defineTool({
		name: 'shortcuts_read',
		title: 'Read shortcut',
		description:
			'Read procedure guidance, inputs, outputs, source existence, and revision for update/prepare. Runs nothing.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path'],
			properties: { path },
			additionalProperties: false,
		},
		async execute(input) {
			const result = await shortcutService.read(absolutePath(input, 'path'));
			return successfulResult(result, `Read ${result.data.title}.`);
		},
	}),
	defineTool({
		name: 'shortcuts_create',
		title: 'Save shortcut',
		description:
			'Save/open a new .shortcut.json procedure, inputs, existing templates, and outputs. Never overwrites files or installs/executes tools.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path', 'title', 'procedure', 'outputGuidance'],
			properties: { path, ...fields },
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const { path: _path, ...values } = input;
			const result = await shortcutService.create(
				absolutePath(input, 'path'),
				values as ShortcutInput,
				{ actor: 'agent', signal },
			);
			return successfulResult(
				{ ...result, ...(await show(result.path)) },
				`Saved ${result.data.title}.`,
			);
		},
	}),
	defineTool({
		name: 'shortcuts_update',
		title: 'Edit shortcut',
		description:
			'Update at current revision; arrays replace. Sources must exist. Rejects stale edits/drafts. Prepared work orders retain their snapshot.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path', 'expectedRevision', 'changes'],
			properties: {
				path,
				expectedRevision: revision,
				changes: {
					type: 'object',
					minProperties: 1,
					properties: fields,
					additionalProperties: false,
				},
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const result = await shortcutService.update(
				absolutePath(input, 'path'),
				requiredString(input, 'expectedRevision', { maxLength: 71 }),
				objectValue(input.changes) as Partial<ShortcutInput>,
				{ actor: 'agent', signal },
			);
			return successfulResult(
				{ ...result, ...(await show(result.path)) },
				`Updated ${result.data.title}.`,
			);
		},
	}),
	defineTool({
		name: 'shortcuts_prepare',
		title: 'Prepare work order',
		description:
			'Save a Markdown procedure/input/Home snapshot and linked paused run with pending steps. No execution. Use projectRevision for a project without working/waiting runs, or newProject to create it. Inputs/templates must exist; verify checklist. Failures identify any saved work order for recovery.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path', 'expectedRevision', 'projectPath', 'workOrderPath'],
			additionalProperties: false,
			properties: {
				path,
				expectedRevision: revision,
				projectPath: {
					type: 'string',
					maxLength: 2048,
					description: 'Absolute .project.json handoff path.',
				},
				projectRevision: revision,
				newProject: {
					type: 'object',
					required: ['title', 'objective'],
					additionalProperties: false,
					properties: {
						title: { type: 'string', minLength: 1, maxLength: 160 },
						objective: { type: 'string', minLength: 1, maxLength: 2000 },
						context: { type: 'string', maxLength: 12000 },
					},
				},
				inputPaths: {
					type: 'array',
					maxItems: 40,
					uniqueItems: true,
					items: { type: 'string', maxLength: 2048 },
				},
				inputText: { type: 'string', maxLength: 12000 },
				workOrderPath: {
					type: 'string',
					maxLength: 2048,
					description: 'New .md path outside System/Trash; never overwrites.',
				},
			},
		},
		async execute(input, { signal }) {
			const { path: _path, expectedRevision: _revision, ...values } = input;
			const result = await shortcutService.prepare(
				absolutePath(input, 'path'),
				requiredString(input, 'expectedRevision', { maxLength: 71 }),
				values as PrepareShortcutInput,
				{ actor: 'agent', signal },
			);
			return successfulResult(
				{ ...result, ...(await show(result.shortcutPath)) },
				`Prepared work in ${result.workOrderPath}. No agent has been started.`,
			);
		},
	}),
];
