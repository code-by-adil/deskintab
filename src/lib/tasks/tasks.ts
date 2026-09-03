import { AppError } from '../errors';
import {
	WorkspaceJson,
	boundedText,
	objectValue,
	fileLink,
	checkFileLink,
} from '../workspace/json-document';
import { workspaceService } from '../workspace/workspace';
import type { ActivityActor } from '../activity/activity';

export const TASK_STATUSES = ['todo', 'in-progress', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type Task = {
	id: string;
	title: string;
	status: TaskStatus;
	dueDate: string | null;
	notes: string;
	sourcePath: string | null;
	outputPath: string | null;
	createdAt: string;
	updatedAt: string;
};
export type TaskFile = { format: 'webmcp-tasks'; version: 1; title: string; tasks: Task[] };
export type TaskInput = {
	title: string;
	status?: TaskStatus;
	dueDate?: string | null;
	notes?: string;
	sourcePath?: string | null;
	outputPath?: string | null;
};
export const isTasksPath = (path: string) => path.endsWith('.tasks.json');
function dueDate(value: unknown) {
	if (value === null || value === undefined || value === '') return null;
	if (
		typeof value !== 'string' ||
		!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
		!Number.isFinite(Date.parse(`${value}T12:00:00Z`)) ||
		new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value
	)
		throw new AppError(
			'INVALID_DATE',
			'Use a real calendar date in YYYY-MM-DD format, or null to clear it.',
		);
	return value;
}
function fields(input: Record<string, unknown>) {
	const status = input.status ?? 'todo';
	if (!TASK_STATUSES.includes(status as TaskStatus))
		throw new AppError('INVALID_STATUS', 'Choose todo, in-progress, or done.');
	return {
		title: boundedText(input.title, 'Title', 200),
		status: status as TaskStatus,
		dueDate: dueDate(input.dueDate),
		notes: boundedText(input.notes ?? '', 'Notes', 5000, true),
		sourcePath: fileLink(input.sourcePath),
		outputPath: fileLink(input.outputPath),
	};
}
export function parseTaskFile(value: unknown): TaskFile {
	const data = objectValue(value);
	if (
		data.format !== 'webmcp-tasks' ||
		data.version !== 1 ||
		!Array.isArray(data.tasks) ||
		data.tasks.length > 250
	)
		throw new AppError(
			'INVALID_DATA',
			'Expected a version 1 webmcp-tasks file with at most 250 tasks.',
		);
	const ids = new Set<string>();
	const tasks = data.tasks.map((raw) => {
		const task = objectValue(raw),
			id = boundedText(task.id, 'Task ID', 80);
		if (ids.has(id)) throw new AppError('INVALID_DATA', 'Task IDs must be unique.');
		ids.add(id);
		return {
			id,
			...fields(task),
			createdAt: boundedText(task.createdAt, 'Created date', 40),
			updatedAt: boundedText(task.updatedAt, 'Updated date', 40),
		};
	});
	return {
		format: 'webmcp-tasks',
		version: 1,
		title: boundedText(data.title, 'List title', 120),
		tasks,
	};
}
export const tasksDocument = new WorkspaceJson<TaskFile>(
	'.tasks.json',
	'/Documents/My tasks.tasks.json',
	'/System/tasks-session.json',
	() => ({ format: 'webmcp-tasks', version: 1, title: 'My Tasks', tasks: [] }),
	parseTaskFile,
);
export const tasksService = {
	document: tasksDocument,
	async list(path?: string) {
		const target = path ?? (await tasksDocument.resolvePath());
		if (path === undefined && !(await workspaceService.exists(target))) {
			const matches = workspaceService
				.getAllPaths()
				.filter(
					(candidate) =>
						isTasksPath(candidate) &&
						!candidate.startsWith('/System/') &&
						!candidate.startsWith('/Trash/'),
				);
			const lists: string[] = [];
			for (const candidate of matches) {
				if ((await workspaceService.stat(candidate)).kind === 'file') lists.push(candidate);
				if (lists.length > 100) break;
			}
			return {
				path: null,
				data: tasksDocument.empty(),
				revision: null,
				tasks: [],
				missingPath: target,
				availableLists: lists.slice(0, 100),
				listsTruncated: lists.length > 100,
				message:
					'No current task list is available. Read an available list by path, or use tasks_create to start one.',
			};
		}
		const record = await tasksDocument.read(target);
		const tasks = await Promise.all(
			record.data.tasks.map(async (task) => ({
				...task,
				sourceExists: task.sourcePath ? await workspaceService.exists(task.sourcePath) : null,
				outputExists: task.outputPath ? await workspaceService.exists(task.outputPath) : null,
			})),
		);
		return { ...record, tasks };
	},
	async create(
		path: string,
		input: TaskInput,
		options: {
			expectedRevision?: string;
			listTitle?: string;
			actor?: ActivityActor;
			signal?: AbortSignal;
		} = {},
	) {
		const parsed = fields(input as unknown as Record<string, unknown>);
		await Promise.all([checkFileLink(parsed.sourcePath), checkFileLink(parsed.outputPath)]);
		const exists = await workspaceService.exists(path);
		const base = exists ? await tasksDocument.read(path) : null;
		if (base && options.expectedRevision !== base.revision)
			throw new AppError(
				'FILE_CHANGED',
				'Read tasks_list and supply its current expectedRevision before adding to an existing list.',
			);
		const now = new Date().toISOString();
		const task: Task = { id: crypto.randomUUID(), ...parsed, createdAt: now, updatedAt: now };
		const data: TaskFile = base?.data ?? {
			format: 'webmcp-tasks',
			version: 1,
			title: options.listTitle ?? 'Tasks',
			tasks: [],
		};
		data.tasks.push(task);
		const result = await tasksDocument.write(
			path,
			data,
			base?.revision,
			!base,
			options.actor ?? 'human',
			options.signal,
		);
		return { ...result, task };
	},
	async update(
		path: string,
		id: string,
		expectedRevision: string,
		changes: Partial<TaskInput>,
		options: { remove?: boolean; actor?: ActivityActor; signal?: AbortSignal } = {},
	) {
		const base = await tasksDocument.read(path);
		if (base.revision !== expectedRevision)
			throw new AppError('FILE_CHANGED', 'The task list changed. Read it again before updating.');
		const task = base.data.tasks.find((task) => task.id === id);
		if (!task) throw new AppError('TASK_NOT_FOUND', 'This task was removed. Refresh the list.');
		const next: Task = {
			...task,
			...fields({ ...task, ...changes }),
			updatedAt: new Date().toISOString(),
		};
		if (!options.remove)
			await Promise.all([
				next.sourcePath !== task.sourcePath ? checkFileLink(next.sourcePath) : Promise.resolve(),
				next.outputPath !== task.outputPath ? checkFileLink(next.outputPath) : Promise.resolve(),
			]);
		base.data.tasks = options.remove
			? base.data.tasks.filter((task) => task.id !== id)
			: base.data.tasks.map((task) => (task.id === id ? next : task));
		const result = await tasksDocument.write(
			path,
			base.data,
			base.revision,
			false,
			options.actor ?? 'human',
			options.signal,
		);
		return { ...result, task: options.remove ? null : next };
	},
};
