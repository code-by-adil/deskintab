import { AppError } from '../errors';
import { revealDesktop } from './files';
import { navigateApp, controlWindow, type AppNavigation, type WindowOperation } from './navigation';
import { apps, type AppID } from '../../state/apps.svelte';
import { appIds } from '../../configs/apps/apps-config';
import {
	defineTool,
	optionalAbsolutePath,
	optionalBoolean,
	optionalEnum,
	optionalInteger,
	optionalString,
	successfulResult,
} from '../webmcp/tool-utils';
import { canvasService } from '../canvas/canvas';

const enumField = (values: readonly string[]) => ({ type: 'string', enum: values });
const stringField = { type: 'string', maxLength: 2048 };
const pathField = {
	...stringField,
	description: 'Optional workspace file to open before choosing the view.',
};
function enumValue<const T extends readonly string[]>(
	input: Record<string, unknown>,
	key: string,
	values: T,
) {
	return optionalEnum(input, key, values);
}
function booleanValue(input: Record<string, unknown>, key: string) {
	return input[key] === undefined ? undefined : optionalBoolean(input, key);
}
function navigationTool<K extends Exclude<keyof AppNavigation, 'review'>>(
	target: K,
	name: string,
	description: string,
	properties: Record<string, object>,
	parse: (input: Record<string, unknown>) => AppNavigation[K],
) {
	return defineTool({
		name,
		title: `Navigate ${target === 'textedit' ? 'Notepad' : target}`,
		description,
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			properties: { ...(target === 'activity' ? {} : { path: pathField }), ...properties },
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const options = parse(input);
			await revealDesktop({ target, path: optionalAbsolutePath(input, 'path'), signal });
			const view = await navigateApp(target, options, signal);
			return successfulResult({ target, view }, 'Opened the requested view.');
		},
	});
}
export const navigationTools: WebMCP.ModelContextTool[] = [
	navigationTool(
		'home',
		'home_navigate',
		'Open Home Preferences, Toolbox or Workspace packs; select a skill by path. Preserves unsaved form edits.',
		{ pane: enumField(['preferences', 'toolbox', 'packs']), skillPath: stringField },
		(input) => ({
			pane: enumValue(input, 'pane', ['preferences', 'toolbox', 'packs']),
			skillPath: optionalAbsolutePath(input, 'skillPath'),
		}),
	),
	navigationTool(
		'projects',
		'projects_navigate',
		'Show project overview, Handoff, Work or Context and optionally a historical run. Use projects_read to discover run IDs. Preserves pending edits.',
		{ view: enumField(['overview', 'handoff', 'work', 'context']), runId: stringField },
		(input) => ({
			view: enumValue(input, 'view', ['overview', 'handoff', 'work', 'context']),
			runId: optionalString(input, 'runId', { maxLength: 2048 }),
		}),
	),
	navigationTool(
		'tasks',
		'tasks_navigate',
		'Open a task list, select a task and set its visible status filter. Selecting a hidden task clears the filter unless an explicit compatible filter is given. Preserves unsaved edits.',
		{ taskId: stringField, filter: enumField(['all', 'todo', 'in-progress', 'done']) },
		(input) => ({
			taskId: optionalString(input, 'taskId', { maxLength: 2048 }),
			filter: enumValue(input, 'filter', ['all', 'todo', 'in-progress', 'done']),
		}),
	),
	navigationTool(
		'inbox',
		'inbox_navigate',
		'Open an Inbox request and choose the visible request status filter. Returns visible request paths.',
		{ filter: enumField(['all', 'new', 'filed', 'done']) },
		(input) => ({ filter: enumValue(input, 'filter', ['all', 'new', 'filed', 'done']) }),
	),
	navigationTool(
		'finder',
		'finder_navigate',
		'Show a folder or file, search within the current folder, and select a visible result. Empty query clears search; empty selectedPath clears selection. Returns visible paths.',
		{ query: { type: 'string', maxLength: 500 }, selectedPath: stringField },
		(input) => ({
			query: optionalString(input, 'query', { allowEmpty: true, maxLength: 500 }),
			selectedPath: optionalString(input, 'selectedPath', { allowEmpty: true, maxLength: 2048 }),
		}),
	),
	navigationTool(
		'textedit',
		'notepad_navigate',
		'Open a note, choose formatted/markdown view (plain files stay plain), and optionally select source character offsets. Selection switches Markdown to source view. Does not edit content.',
		{
			mode: enumField(['formatted', 'markdown', 'plain']),
			sidebar: { type: 'boolean' },
			selection: {
				type: 'object',
				properties: {
					start: { type: 'integer', minimum: 0 },
					end: { type: 'integer', minimum: 0 },
				},
				required: ['start', 'end'],
				additionalProperties: false,
			},
		},
		(input) => {
			let selection: { start: number; end: number } | undefined;
			if (input.selection !== undefined) {
				if (
					!input.selection ||
					typeof input.selection !== 'object' ||
					Array.isArray(input.selection)
				)
					throw new AppError(
						'INVALID_INPUT',
						'selection must contain start and end source offsets.',
					);
				const value = input.selection as Record<string, unknown>;
				if (
					Object.keys(value).some((key) => !['start', 'end'].includes(key)) ||
					value.start === undefined ||
					value.end === undefined
				)
					throw new AppError('INVALID_INPUT', 'selection must contain only start and end.');
				selection = {
					start: optionalInteger(value, 'start', 0, 0, Number.MAX_SAFE_INTEGER),
					end: optionalInteger(value, 'end', 0, 0, Number.MAX_SAFE_INTEGER),
				};
			}
			return {
				mode: enumValue(input, 'mode', ['formatted', 'markdown', 'plain']),
				sidebar: booleanValue(input, 'sidebar'),
				selection,
			};
		},
	),
	navigationTool(
		'preview',
		'preview_navigate',
		'Set Preview zoom from 0.5 to 2 (1 fits the page) or show PDF text view. Use preview_reveal to choose a page.',
		{ zoom: { type: 'number', minimum: 0.5, maximum: 2 }, textView: { type: 'boolean' } },
		(input) => {
			if (
				input.zoom !== undefined &&
				(typeof input.zoom !== 'number' ||
					!Number.isFinite(input.zoom) ||
					input.zoom < 0.5 ||
					input.zoom > 2)
			)
				throw new AppError('INVALID_INPUT', 'zoom must be between 0.5 and 2.');
			return { zoom: input.zoom as number | undefined, textView: booleanValue(input, 'textView') };
		},
	),
	navigationTool(
		'activity',
		'activity_navigate',
		'Show Activity or Review; filter events or open a saved version or work summary by ID. Use review_list to discover IDs. Does not restore files or alter summaries.',
		{
			tab: enumField(['activity', 'review']),
			filter: enumField(['all', 'human', 'agent', 'terminal', 'system', 'terminal-events']),
			versionId: stringField,
			sessionId: stringField,
		},
		(input) => ({
			tab: enumValue(input, 'tab', ['activity', 'review']),
			filter: enumValue(input, 'filter', [
				'all',
				'human',
				'agent',
				'terminal',
				'system',
				'terminal-events',
			]),
			versionId: optionalString(input, 'versionId', { maxLength: 2048 }),
			sessionId: optionalString(input, 'sessionId', { maxLength: 2048 }),
		}),
	),
	defineTool({
		name: 'desktop_window',
		title: 'Manage app window',
		description:
			"Close, minimize, maximize, restore or move an open app window. Move uses desktop pixel coordinates and clamps to visible bounds. Close honors each app's existing save/draft guards.",
		annotations: { readOnlyHint: false, untrustedContentHint: false },
		inputSchema: {
			type: 'object',
			properties: {
				target: enumField(appIds),
				action: enumField(['close', 'minimize', 'maximize', 'restore', 'move']),
				x: { type: 'integer', minimum: 0 },
				y: { type: 'integer', minimum: 0 },
			},
			required: ['target', 'action'],
			additionalProperties: false,
		},
		async execute(input) {
			const target = enumValue(input, 'target', appIds)!;
			const action = enumValue(input, 'action', [
				'close',
				'minimize',
				'maximize',
				'restore',
				'move',
			])!;
			if (action === 'move' && (input.x === undefined || input.y === undefined))
				throw new AppError('INVALID_INPUT', 'Moving a window requires x and y.');
			if (action !== 'move' && (input.x !== undefined || input.y !== undefined))
				throw new AppError('INVALID_INPUT', 'Coordinates apply only to move.');
			const options: WindowOperation = {
				action,
				x: input.x === undefined ? undefined : optionalInteger(input, 'x', 0, 0, 100000),
				y: input.y === undefined ? undefined : optionalInteger(input, 'y', 0, 0, 100000),
			};
			if (!apps.open[target as AppID])
				throw new AppError('APP_NOT_OPEN', 'Open the app with desktop_reveal first.');
			const window = await controlWindow(target as AppID, options);
			return successfulResult({ target, window }, 'Updated the app window.');
		},
	}),
	defineTool({
		name: 'canvas_select',
		title: 'Select and focus Canvas objects',
		description:
			'Select object IDs in a Canvas and optionally fit them in view. Empty ids clears selection; fit with empty ids fits the whole drawing. Use canvas_read for object IDs.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			properties: {
				path: pathField,
				ids: { type: 'array', items: { type: 'string' }, maxItems: 2000 },
				fit: { type: 'boolean' },
			},
			required: ['ids'],
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			if (
				!Array.isArray(input.ids) ||
				input.ids.length > 2000 ||
				input.ids.some((id) => typeof id !== 'string' || !id)
			)
				throw new AppError('INVALID_INPUT', 'ids must contain at most 2000 non-empty object IDs.');
			const fit = optionalBoolean(input, 'fit');
			await revealDesktop({ target: 'canvas', path: optionalAbsolutePath(input, 'path'), signal });
			await canvasService.ensure();
			await canvasService.focusSelection(input.ids as string[], fit, signal);
			return successfulResult({ view: canvasService.snapshot() }, 'Selected the Canvas objects.');
		},
	}),
];
