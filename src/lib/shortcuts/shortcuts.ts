import { AppError } from '../errors';
import type { ActivityActor } from '../activity/activity';
import { homeService } from '../home/home';
import { projectsDocument, projectsService, type ProjectRecord } from '../projects/projects';
import {
	WorkspaceJson,
	appFilePath,
	boundedText,
	objectValue,
	type JsonRecord,
} from '../workspace/json-document';
import { normalizeWorkspacePath } from '../workspace/path';
import { workspaceService } from '../workspace/workspace';

export type ShortcutInput = {
	title: string;
	description?: string;
	procedure: string;
	requiredInputs?: string[];
	sourcePaths?: string[];
	outputGuidance: string;
};
export type ShortcutFile = Required<ShortcutInput> & {
	format: 'webmcp-shortcut';
	version: 1;
	id: string;
	createdAt: string;
	updatedAt: string;
};
export type ShortcutRecord = JsonRecord<ShortcutFile> & {
	sourceFiles: { path: string; exists: boolean }[];
};
export type ShortcutSummary = Pick<ShortcutFile, 'id' | 'title' | 'description' | 'updatedAt'> & {
	path: string;
	inputCount: number;
};
export type PrepareShortcutInput = {
	projectPath: string;
	projectRevision?: string;
	newProject?: { title: string; objective: string; context?: string };
	inputPaths?: string[];
	inputText?: string;
	workOrderPath: string;
};
export type PreparedShortcut = {
	shortcutPath: string;
	workOrderPath: string;
	projectPath: string;
	runId: string;
	status: 'prepared';
	projectRevision: string;
	briefText: string;
};
type MutationOptions = { actor?: ActivityActor; signal?: AbortSignal };
const fields = [
	'title',
	'description',
	'procedure',
	'requiredInputs',
	'sourcePaths',
	'outputGuidance',
];
export const isShortcutPath = (path: string) => path.endsWith('.shortcut.json');

function strict(value: unknown, keys: readonly string[]) {
	const input = objectValue(value);
	for (const key of Object.keys(input)) {
		if (!keys.includes(key)) throw new AppError('INVALID_INPUT', `Unknown shortcut field ${key}.`);
	}
	return input;
}
function textList(value: unknown, name: string, maximum: number, length: number) {
	if (!Array.isArray(value) || value.length > maximum)
		throw new AppError('INVALID_DATA', `${name} must contain at most ${maximum} items.`);
	const items = value.map((item) => boundedText(item, name, length).trim());
	if (new Set(items).size !== items.length)
		throw new AppError('INVALID_DATA', `${name} must not contain duplicates.`);
	return items;
}
function filePath(value: unknown) {
	const raw = boundedText(value, 'File path', 2048);
	if (!raw.startsWith('/') || raw.startsWith('//') || /[\u0000-\u001f\u007f\\]/.test(raw))
		throw new AppError(
			'INVALID_PATH',
			'Use an absolute workspace path without control characters or backslashes.',
		);
	const path = normalizeWorkspacePath(raw);
	if (path === '/' || /^\/(System|Trash)(\/|$)/.test(path))
		throw new AppError('INVALID_PATH', 'Choose a workspace file outside System and Trash.');
	return path;
}
function shortcutFields(input: Record<string, unknown>): Required<ShortcutInput> {
	const sourcePaths = textList(input.sourcePaths ?? [], 'Template and source paths', 30, 2048).map(
		filePath,
	);
	if (new Set(sourcePaths).size !== sourcePaths.length)
		throw new AppError('INVALID_DATA', 'Include each template or source file once.');
	return {
		title: boundedText(input.title, 'Shortcut title', 160).trim(),
		description: boundedText(input.description ?? '', 'Shortcut description', 1000, true),
		procedure: boundedText(input.procedure, 'Procedure', 16000),
		requiredInputs: textList(input.requiredInputs ?? [], 'Required inputs', 20, 300),
		sourcePaths,
		outputGuidance: boundedText(input.outputGuidance, 'Expected output', 4000),
	};
}
function date(value: unknown) {
	const text = boundedText(value, 'Saved date', 40);
	const time = Date.parse(text);
	if (!Number.isFinite(time) || new Date(time).toISOString() !== text)
		throw new AppError('INVALID_DATA', 'Saved dates must use ISO UTC format.');
	return text;
}
export function parseShortcutFile(value: unknown): ShortcutFile {
	const input = strict(value, [...fields, 'format', 'version', 'id', 'createdAt', 'updatedAt']);
	if (input.format !== 'webmcp-shortcut' || input.version !== 1)
		throw new AppError('INVALID_DATA', 'Expected a version 1 webmcp-shortcut file.');
	return {
		format: 'webmcp-shortcut',
		version: 1,
		id: boundedText(input.id, 'Shortcut ID', 80),
		...shortcutFields(input),
		createdAt: date(input.createdAt),
		updatedAt: date(input.updatedAt),
	};
}
function emptyShortcut(): ShortcutFile {
	const now = new Date().toISOString();
	return {
		format: 'webmcp-shortcut',
		version: 1,
		id: crypto.randomUUID(),
		title: 'New shortcut',
		description: '',
		procedure: 'Describe the work to repeat.',
		requiredInputs: [],
		sourcePaths: [],
		outputGuidance: 'Describe the expected result.',
		createdAt: now,
		updatedAt: now,
	};
}
export const shortcutsDocument = new WorkspaceJson<ShortcutFile>(
	'.shortcut.json',
	'/Shortcuts/My shortcut.shortcut.json',
	'/System/shortcuts-session.json',
	emptyShortcut,
	parseShortcutFile,
	100_000,
);
export const shortcutDocument = shortcutsDocument;
function guardDraft(path: string, options: MutationOptions) {
	if (options.actor === 'agent' && shortcutsDocument.hasPendingEdits(path))
		throw new AppError(
			'OPEN_DRAFT',
			'This shortcut has unsaved edits in Shortcuts.',
			'Save or discard the edits, then read shortcuts_read again.',
		);
}
function requireRevision(value: unknown) {
	if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value))
		throw new AppError('REVISION_REQUIRED', 'Read the saved file and supply its current revision.');
	return value;
}
async function current(path: string, revision: string, options: MutationOptions) {
	path = appFilePath(filePath(path), '.shortcut.json');
	guardDraft(path, options);
	requireRevision(revision);
	const record = await shortcutsDocument.read(path);
	if (record.revision !== revision)
		throw new AppError(
			'FILE_CHANGED',
			'This shortcut changed. Read shortcuts_read again before saving or preparing work.',
		);
	return record;
}
async function checkFiles(paths: string[]) {
	for (const path of paths) {
		if (!(await workspaceService.exists(path)))
			throw new AppError(
				'PATH_NOT_FOUND',
				`Input file ${path} is missing.`,
				'Choose an existing file or save it in the workspace first.',
			);
		if ((await workspaceService.stat(path)).kind !== 'file')
			throw new AppError('NOT_A_FILE', `${path} is a folder. Choose a file.`);
	}
}
async function withSources(record: JsonRecord<ShortcutFile>): Promise<ShortcutRecord> {
	const sourceFiles = await Promise.all(
		record.data.sourcePaths.map(async (path) => {
			try {
				return { path, exists: (await workspaceService.stat(path)).kind === 'file' };
			} catch {
				return { path, exists: false };
			}
		}),
	);
	return { ...record, sourceFiles };
}
function workOrder(record: JsonRecord<ShortcutFile>, input: PrepareShortcutInput, home: string) {
	const shortcut = record.data;
	return [
		`# ${shortcut.title}`,
		'',
		'Prepared for an agent. Work has not started.',
		'',
		`Project file: ${input.projectPath}`,
		`Shortcut file: ${record.path}`,
		`Shortcut revision: ${record.revision}`,
		'',
		shortcut.description,
		'',
		'## Request and inputs',
		'',
		input.inputText || 'Use the linked input files.',
		'',
		...(input.inputPaths ?? []).map((path) => `- ${path}`),
		'',
		...(shortcut.requiredInputs.length
			? [
					'### Input checklist',
					'',
					'Check that the supplied material covers these inputs before starting.',
					'',
					...shortcut.requiredInputs.map((item) => `- [ ] ${item}`),
					'',
				]
			: []),
		'## Procedure',
		'',
		shortcut.procedure,
		'',
		'## Expected output',
		'',
		shortcut.outputGuidance,
		'',
		...(shortcut.sourcePaths.length
			? ['## Templates and references', '', ...shortcut.sourcePaths.map((path) => `- ${path}`), '']
			: []),
		...(home ? ['## Saved working preferences', '', home, ''] : []),
		'## Continue the work',
		'',
		'Read the current project brief before starting. Update its work session with the actual steps and evidence. The procedure is saved guidance; no commands have been executed.',
		'',
	].join('\n');
}

export const shortcutService = {
	document: shortcutsDocument,
	async list() {
		await workspaceService.ready();
		const paths = workspaceService
			.getAllPaths()
			.filter((path) => isShortcutPath(path) && !/^\/(System|Trash)(\/|$)/.test(path))
			.sort();
		const shortcuts: ShortcutSummary[] = [],
			warnings: { path: string; message: string }[] = [];
		for (const path of paths.slice(0, 100)) {
			try {
				if ((await workspaceService.stat(path)).kind !== 'file') continue;
				const { data } = await shortcutsDocument.read(path);
				shortcuts.push({
					path,
					id: data.id,
					title: data.title,
					description: data.description,
					updatedAt: data.updatedAt,
					inputCount: data.requiredInputs.length,
				});
			} catch (cause) {
				warnings.push({ path, message: cause instanceof Error ? cause.message : String(cause) });
			}
		}
		shortcuts.sort((a, b) => a.title.localeCompare(b.title));
		return { shortcuts, warnings, truncated: paths.length > 100 };
	},
	async read(path: string) {
		await workspaceService.ready();
		return withSources(await shortcutsDocument.read(appFilePath(filePath(path), '.shortcut.json')));
	},
	async create(path: string, input: ShortcutInput, options: MutationOptions = {}) {
		path = appFilePath(filePath(path), '.shortcut.json');
		const data = { ...emptyShortcut(), ...shortcutFields(strict(input, fields)) };
		await workspaceService.ready();
		await checkFiles(data.sourcePaths);
		return withSources(
			await shortcutsDocument.write(
				path,
				data,
				undefined,
				true,
				options.actor ?? 'human',
				options.signal,
				() => guardDraft(path, options),
			),
		);
	},
	async update(
		path: string,
		expectedRevision: string,
		changes: Partial<ShortcutInput>,
		options: MutationOptions = {},
	) {
		const patch = strict(changes, fields);
		if (!Object.keys(patch).length)
			throw new AppError('INVALID_INPUT', 'Supply a shortcut field to change.');
		const base = await current(path, expectedRevision, options);
		const data = {
			...base.data,
			...shortcutFields({ ...base.data, ...patch }),
			updatedAt: new Date().toISOString(),
		};
		await checkFiles(data.sourcePaths);
		return withSources(
			await shortcutsDocument.write(
				base.path,
				data,
				base.revision,
				false,
				options.actor ?? 'human',
				options.signal,
				() => guardDraft(base.path, options),
			),
		);
	},
	async prepare(
		path: string,
		expectedRevision: string,
		raw: PrepareShortcutInput,
		options: MutationOptions = {},
	): Promise<PreparedShortcut> {
		const values = strict(raw, [
			'projectPath',
			'projectRevision',
			'newProject',
			'inputPaths',
			'inputText',
			'workOrderPath',
		]);
		const input: PrepareShortcutInput = {
			projectPath: appFilePath(filePath(values.projectPath), '.project.json'),
			workOrderPath: appFilePath(filePath(values.workOrderPath), '.md'),
			inputPaths: textList(values.inputPaths ?? [], 'Input paths', 40, 2048).map(filePath),
			inputText: boundedText(values.inputText ?? '', 'Request and input notes', 12000, true),
		};
		if (values.newProject !== undefined) {
			if (values.projectRevision !== undefined)
				throw new AppError(
					'INVALID_INPUT',
					'Choose a new project or an existing project revision.',
				);
			const project = strict(values.newProject, ['title', 'objective', 'context']);
			input.newProject = {
				title: boundedText(project.title, 'Project title', 160),
				objective: boundedText(project.objective, 'Project objective', 2000),
				context: boundedText(project.context ?? '', 'Project context', 12000, true),
			};
		} else input.projectRevision = requireRevision(values.projectRevision);
		const base = await current(path, expectedRevision, options);
		if (base.data.requiredInputs.length && !input.inputPaths!.length && !input.inputText!.trim())
			throw new AppError('INPUT_REQUIRED', 'Supply input files or notes for this shortcut.');
		await checkFiles([...base.data.sourcePaths, ...input.inputPaths!]);
		if (await workspaceService.exists(input.workOrderPath))
			throw new AppError(
				'PATH_EXISTS',
				`${input.workOrderPath} already exists. Choose a new work-order path.`,
			);
		let project: ProjectRecord | undefined;
		if (input.newProject) {
			if (await workspaceService.exists(input.projectPath))
				throw new AppError(
					'PATH_EXISTS',
					`${input.projectPath} already exists. Choose it as an existing project.`,
				);
		} else {
			project = await projectsService.read(input.projectPath);
			if (project.revision !== input.projectRevision)
				throw new AppError(
					'FILE_CHANGED',
					'This project changed. Refresh its saved brief before preparing work.',
				);
			if (projectsDocument.hasPendingEdits(input.projectPath))
				throw new AppError(
					'OPEN_DRAFT',
					'Save or discard the open Project edits before preparing work.',
				);
			if (project.data.runs.length >= 100)
				throw new AppError(
					'RUN_LIMIT',
					'This project already has 100 work sessions. Create a new project for this work.',
				);
			if (['working', 'waiting'].includes(project.brief.latestRun?.status ?? ''))
				throw new AppError(
					'RUN_ACTIVE',
					'Pause or complete the current project run before preparing more work.',
				);
		}
		const home = await homeService.getContext();
		const content = workOrder(base, input, home.briefText);
		// Preflight revisions again after reading inputs. Each write still checks its own revision.
		await current(base.path, expectedRevision, options);
		options.signal?.throwIfAborted();
		await workspaceService.writeText(input.workOrderPath, content, {
			createOnly: true,
			actor: options.actor ?? 'human',
			beforeWrite: () => {
				options.signal?.throwIfAborted();
				guardDraft(base.path, options);
			},
		});
		try {
			project ??= await projectsService.create(input.projectPath, input.newProject!, options);
			const prepared = await projectsService.prepare(
				project.path,
				project.revision,
				{
					objective: base.data.title,
					steps: [
						'Read the work order and check its inputs',
						'Follow the saved procedure',
						'Save the result and evidence',
					],
					summary: `Prepared ${base.data.title}. The work order is saved; no agent has been started.`,
					nextAction:
						input.workOrderPath.length < 1900
							? `Read ${input.workOrderPath}, then start work from this saved brief.`
							: 'Read the linked work order, then start work from this saved brief.',
					evidence: [
						{
							label: 'Work order',
							target: input.workOrderPath,
							detail: 'Saved request, procedure, input links, and working preferences.',
						},
						{
							label: 'Reusable shortcut',
							target: base.path,
							detail: 'Procedure used to prepare this work.',
						},
					],
				},
				options,
			);
			return {
				shortcutPath: base.path,
				workOrderPath: input.workOrderPath,
				projectPath: project.path,
				runId: prepared.run.id,
				status: 'prepared',
				projectRevision: prepared.revision,
				briefText: prepared.briefText,
			};
		} catch (cause) {
			throw new AppError(
				'PREPARE_INCOMPLETE',
				`The work order was saved at ${input.workOrderPath}, but the project handoff was not prepared. ${cause instanceof Error ? cause.message : String(cause)}`,
				'Read the saved work order and current project before retrying with a new output path.',
			);
		}
	},
};
