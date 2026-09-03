import { tasksService, tasksDocument, TASK_STATUSES, type TaskInput } from './tasks';
import { objectValue } from '../workspace/json-document';
import { openApp } from '../../state/apps.svelte';
import {
	absolutePath,
	defineTool,
	optionalAbsolutePath,
	optionalBoolean,
	optionalEnum,
	optionalString,
	requiredString,
	successfulResult,
} from '../webmcp/tool-utils';
const path = { type: 'string', description: 'Absolute .tasks.json workspace path.' };
const revision = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const fields = {
	title: { type: 'string', minLength: 1, maxLength: 200 },
	status: { type: 'string', enum: TASK_STATUSES },
	dueDate: { type: ['string', 'null'], description: 'YYYY-MM-DD; null clears.' },
	notes: { type: 'string', maxLength: 5000 },
	sourcePath: {
		type: ['string', 'null'],
		description: 'Existing source path; null clears.',
	},
	outputPath: {
		type: ['string', 'null'],
		description: 'Existing output path; null clears.',
	},
};
async function show(path: string) {
	openApp('tasks');
	try {
		if (tasksDocument.snapshot().path !== path) await tasksDocument.open(path);
		else await tasksDocument.refresh();
		return {};
	} catch (error) {
		return { displayWarning: String(error) };
	}
}
export const taskTools: WebMCP.ModelContextTool[] = [
	defineTool({
		name: 'tasks_list',
		title: 'Read tasks',
		description:
			'Read tasks/IDs/revision/evidence checks. Defaults current/remembered list; absent returns path:null/availableLists. Filter status/title/notes. desktop_get_context reads drafts/selection. Use revision for writes.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			properties: {
				path,
				status: { type: 'string', enum: TASK_STATUSES },
				query: { type: 'string', maxLength: 200 },
			},
			additionalProperties: false,
		},
		async execute(input) {
			const result = await tasksService.list(optionalAbsolutePath(input, 'path'));
			const status = optionalEnum(input, 'status', TASK_STATUSES),
				query = optionalString(input, 'query', { allowEmpty: true, maxLength: 200 })?.toLowerCase();
			return successfulResult(
				{
					path: result.path,
					...('availableLists' in result
						? {
								availableLists: result.availableLists,
								listsTruncated: result.listsTruncated,
								missingPath: result.missingPath,
								message: result.message,
							}
						: {}),
					title: result.data.title,
					revision: result.revision,
					tasks: result.tasks.filter(
						(t) =>
							(!status || t.status === status) &&
							(!query || `${t.title} ${t.notes}`.toLowerCase().includes(query)),
					),
				},
				result.path ? `Read ${result.path}.` : result.message!,
			);
		},
	}),
	defineTool({
		name: 'tasks_create',
		title: 'Create task',
		description:
			'Add/show a task. Creates absent list; existing list needs tasks_list expectedRevision. Links must exist. Max 250 tasks/list. Activity/Review record saves.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path', 'title'],
			properties: {
				path,
				...fields,
				listTitle: { type: 'string', maxLength: 120 },
				expectedRevision: revision,
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const target = absolutePath(input, 'path');
			const result = await tasksService.create(target, input as TaskInput, {
				expectedRevision: optionalString(input, 'expectedRevision', { maxLength: 71 }),
				listTitle: optionalString(input, 'listTitle', { maxLength: 120 }),
				actor: 'agent',
				signal,
			});
			return successfulResult(
				{ ...result, ...(await show(result.path)) },
				`Created ${result.task.title} in ${result.path}.`,
			);
		},
	}),
	defineTool({
		name: 'tasks_update',
		title: 'Update or remove task',
		description:
			'Update stable ID at list revision; rejects stale writes. null clears sourcePath/outputPath/dueDate. remove:true deletes; recover via Activity versions.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path', 'id', 'expectedRevision'],
			properties: {
				path,
				id: { type: 'string', maxLength: 80 },
				expectedRevision: revision,
				changes: { type: 'object', properties: fields, additionalProperties: false },
				remove: { type: 'boolean', default: false },
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const result = await tasksService.update(
				absolutePath(input, 'path'),
				requiredString(input, 'id', { maxLength: 80 }),
				requiredString(input, 'expectedRevision', { maxLength: 71 }),
				objectValue(input.changes ?? {}) as Partial<TaskInput>,
				{ remove: optionalBoolean(input, 'remove'), actor: 'agent', signal },
			);
			return successfulResult(
				{ ...result, ...(await show(result.path)) },
				`Updated ${result.path}.`,
			);
		},
	}),
];
