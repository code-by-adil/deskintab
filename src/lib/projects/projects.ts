import { AppError } from '../errors';
import type { ActivityActor } from '../activity/activity';
import {
	WorkspaceJson,
	appFilePath,
	boundedText,
	objectValue,
	type JsonRecord,
} from '../workspace/json-document';
import { normalizeWorkspacePath } from '../workspace/path';
import { workspaceService } from '../workspace/workspace';
import { tasksDocument, type Task } from '../tasks/tasks';

export const PROJECT_RUN_STATUSES = ['working', 'waiting', 'paused', 'completed'] as const;
export const PROJECT_STEP_STATUSES = ['pending', 'in-progress', 'done', 'skipped'] as const;
export type ProjectRunStatus = (typeof PROJECT_RUN_STATUSES)[number];
export type ProjectStepStatus = (typeof PROJECT_STEP_STATUSES)[number];
export type ProjectEvidence = { label: string; target: string; detail: string };
export type ProjectEvidenceWithExists = ProjectEvidence & { exists: boolean | null };
export type ProjectStep = { id: string; title: string; status: ProjectStepStatus };
export type ProjectRun = {
	id: string;
	agent: string;
	objective: string;
	status: ProjectRunStatus;
	summary: string;
	nextAction: string;
	steps: ProjectStep[];
	evidence: ProjectEvidence[];
	basedOn: string | null;
	createdAt: string;
	updatedAt: string;
};
export type ProjectDecision = {
	id: string;
	runId: string;
	question: string;
	options: string[];
	answer: string | null;
	createdAt: string;
	answeredAt: string | null;
};
export type ProjectFile = {
	format: 'webmcp-project';
	version: 1;
	id: string;
	title: string;
	objective: string;
	context: string;
	taskListPath: string | null;
	references: ProjectEvidence[];
	decisions: ProjectDecision[];
	runs: ProjectRun[];
	createdAt: string;
	updatedAt: string;
};
export type ProjectInput = {
	title: string;
	objective: string;
	context?: string;
	taskListPath?: string | null;
	references?: ProjectEvidence[];
};
export type StartRunInput = {
	agent: string;
	objective: string;
	steps: string[];
	basedOn?: string | null;
};
export type PrepareRunInput = {
	objective: string;
	steps: string[];
	summary: string;
	nextAction: string;
	evidence: ProjectEvidence[];
};
export type CheckpointInput = {
	status?: ProjectRunStatus;
	summary?: string;
	nextAction?: string;
	steps?: ProjectStep[];
	evidence?: ProjectEvidence[];
	decision?: { question: string; options?: string[] };
};
type MutationOptions = { actor?: ActivityActor; signal?: AbortSignal };
export type ProjectSummary = {
	path: string;
	id: string;
	title: string;
	objective: string;
	updatedAt: string;
	runCount: number;
	openDecisionCount: number;
	latestRun: {
		id: string;
		agent: string;
		status: ProjectRunStatus;
		summary: string;
		nextAction: string;
		updatedAt: string;
		completedSteps: number;
		totalSteps: number;
	} | null;
};
export type ProjectBrief = {
	projectId: string;
	title: string;
	objective: string;
	context: string;
	references: ProjectEvidenceWithExists[];
	latestRun: (Omit<ProjectRun, 'evidence'> & { evidence: ProjectEvidenceWithExists[] }) | null;
	openDecisions: ProjectDecision[];
	recentDecisions: ProjectDecision[];
	omittedDecisions: number;
	taskList: {
		path: string;
		title: string;
		revision: string;
		tasks: Pick<Task, 'id' | 'title' | 'status' | 'sourcePath' | 'outputPath'>[];
		omittedTasks: number;
	} | null;
	warnings: string[];
	reportingNote: string;
};
export type ProjectRecord = JsonRecord<ProjectFile> & {
	brief: ProjectBrief;
	briefText: string;
};
export const isProjectPath = (path: string) => path.endsWith('.project.json');

function strictObject(value: unknown, keys: readonly string[]) {
	const result = objectValue(value);
	for (const key of Object.keys(result)) {
		if (!keys.includes(key))
			throw new AppError('INVALID_INPUT', `Unknown field ${key}. Check the project schema.`);
	}
	return result;
}
function list(value: unknown, name: string, maximum: number): unknown[] {
	if (!Array.isArray(value) || value.length > maximum)
		throw new AppError('INVALID_DATA', `${name} must be an array with at most ${maximum} items.`);
	return value;
}
function id(value: unknown, name: string) {
	return boundedText(value, name, 80);
}
function date(value: unknown, name: string) {
	const text = boundedText(value, name, 40);
	const time = Date.parse(text);
	if (!Number.isFinite(time) || new Date(time).toISOString() !== text)
		throw new AppError('INVALID_DATE', `${name} must be an ISO date in UTC.`);
	return text;
}
function status<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
	if (typeof value !== 'string' || !allowed.includes(value as T))
		throw new AppError('INVALID_STATUS', `${name} must be ${allowed.join(', ')}.`);
	return value as T;
}
function uniqueIds(items: { id: string }[], name: string) {
	if (new Set(items.map((item) => item.id)).size !== items.length)
		throw new AppError('INVALID_DATA', `${name} IDs must be unique.`);
}
function evidenceTarget(value: unknown) {
	const target = boundedText(value, 'Evidence target', 2048);
	if (/[\u0000-\u001f\u007f\\]/.test(target))
		throw new AppError(
			'INVALID_PATH',
			'Evidence targets cannot contain control characters or backslashes.',
		);
	if (target.startsWith('/') && !target.startsWith('//')) {
		const path = normalizeWorkspacePath(target);
		if (path === '/' || /^\/(System|Trash)(\/|$)/.test(path))
			throw new AppError('INVALID_PATH', 'Link a workspace file outside System and Trash.');
		return path;
	}
	try {
		const url = new URL(target);
		if (
			!/^https?:\/\//i.test(target) ||
			!['http:', 'https:'].includes(url.protocol) ||
			url.username ||
			url.password
		)
			throw new Error('unsupported URL');
		return url.href;
	} catch {
		throw new AppError(
			'INVALID_PATH',
			'Use an absolute workspace file path or an http(s) URL without credentials.',
		);
	}
}
function evidenceList(value: unknown): ProjectEvidence[] {
	const result = list(value, 'Evidence', 40).map((raw) => {
		const item = strictObject(raw, ['label', 'target', 'detail']);
		return {
			label: boundedText(item.label, 'Evidence label', 200),
			target: evidenceTarget(item.target),
			detail: boundedText(item.detail, 'Evidence detail', 2000, true),
		};
	});
	if (new Set(result.map((item) => item.target)).size !== result.length)
		throw new AppError('INVALID_DATA', 'Include each evidence target once.');
	return result;
}
function taskPath(value: unknown) {
	if (value === null || value === undefined) return null;
	return appFilePath(boundedText(value, 'Task list path', 2048), '.tasks.json');
}
function projectFields(input: Record<string, unknown>) {
	return {
		title: boundedText(input.title, 'Project title', 160),
		objective: boundedText(input.objective, 'Project objective', 2000),
		context: boundedText(
			input.context === undefined ? '' : input.context,
			'Project context',
			12000,
			true,
		),
		taskListPath: taskPath(input.taskListPath),
		references: evidenceList(input.references === undefined ? [] : input.references),
	};
}
function steps(value: unknown): ProjectStep[] {
	const result = list(value, 'Run steps', 40).map((raw) => {
		const item = strictObject(raw, ['id', 'title', 'status']);
		return {
			id: id(item.id, 'Step ID'),
			title: boundedText(item.title, 'Step title', 240),
			status: status(item.status, PROJECT_STEP_STATUSES, 'Step status'),
		};
	});
	if (!result.length) throw new AppError('INVALID_DATA', 'A run needs at least one step.');
	uniqueIds(result, 'Step');
	if (result.filter((step) => step.status === 'in-progress').length > 1)
		throw new AppError('INVALID_DATA', 'Only one step can be in progress in a run.');
	return result;
}
function decisionFields(value: unknown) {
	const item = strictObject(value, ['question', 'options']);
	const options = list(item.options === undefined ? [] : item.options, 'Decision options', 8).map(
		(option) => boundedText(option, 'Decision option', 500),
	);
	if (new Set(options).size !== options.length)
		throw new AppError('INVALID_DATA', 'Decision options must be distinct.');
	return { question: boundedText(item.question, 'Decision question', 2000), options };
}

export function parseProjectFile(value: unknown): ProjectFile {
	const input = strictObject(value, [
		'format',
		'version',
		'id',
		'title',
		'objective',
		'context',
		'taskListPath',
		'references',
		'decisions',
		'runs',
		'createdAt',
		'updatedAt',
	]);
	if (input.format !== 'webmcp-project' || input.version !== 1)
		throw new AppError('INVALID_DATA', 'Expected a version 1 webmcp-project file.');
	const runs: ProjectRun[] = list(input.runs, 'Project runs', 100).map((raw) => {
		const run = strictObject(raw, [
			'id',
			'agent',
			'objective',
			'status',
			'summary',
			'nextAction',
			'steps',
			'evidence',
			'basedOn',
			'createdAt',
			'updatedAt',
		]);
		return {
			id: id(run.id, 'Run ID'),
			agent: boundedText(run.agent, 'Reporting agent', 120),
			objective: boundedText(run.objective, 'Run objective', 2000),
			status: status(run.status, PROJECT_RUN_STATUSES, 'Run status'),
			summary: boundedText(run.summary, 'Run summary', 6000, true),
			nextAction: boundedText(run.nextAction, 'Next action', 2000, true),
			steps: steps(run.steps),
			evidence: evidenceList(run.evidence),
			basedOn: run.basedOn === null ? null : id(run.basedOn, 'Previous run ID'),
			createdAt: date(run.createdAt, 'Run created date'),
			updatedAt: date(run.updatedAt, 'Run updated date'),
		};
	});
	uniqueIds(runs, 'Run');
	const decisions: ProjectDecision[] = list(input.decisions, 'Project decisions', 250).map(
		(raw) => {
			const item = strictObject(raw, [
				'id',
				'runId',
				'question',
				'options',
				'answer',
				'createdAt',
				'answeredAt',
			]);
			const answer =
				item.answer === null ? null : boundedText(item.answer, 'Decision answer', 4000);
			const answeredAt =
				item.answeredAt === null ? null : date(item.answeredAt, 'Decision answered date');
			if ((answer === null) !== (answeredAt === null))
				throw new AppError(
					'INVALID_DATA',
					'A decision answer and its date must be saved together.',
				);
			return {
				id: id(item.id, 'Decision ID'),
				runId: id(item.runId, 'Decision run ID'),
				...decisionFields({ question: item.question, options: item.options }),
				answer,
				createdAt: date(item.createdAt, 'Decision created date'),
				answeredAt,
			};
		},
	);
	uniqueIds(decisions, 'Decision');
	const runIds = new Set(runs.map((run) => run.id));
	if (decisions.some((decision) => !runIds.has(decision.runId)))
		throw new AppError('INVALID_DATA', 'Each decision must belong to a saved run.');
	for (const [index, run] of runs.entries()) {
		if (run.basedOn !== (index === 0 ? null : runs[index - 1].id))
			throw new AppError('INVALID_DATA', 'Each run must name the previous run in basedOn.');
		if (index < runs.length - 1 && ['working', 'waiting'].includes(run.status))
			throw new AppError('INVALID_DATA', 'Pause the previous run before starting another.');
		const open = decisions.some(
			(decision) => decision.runId === run.id && decision.answer === null,
		);
		if (run.status === 'waiting' && !open)
			throw new AppError('INVALID_DATA', 'A waiting run needs an unanswered decision.');
		if (
			run.status === 'completed' &&
			(open ||
				!run.summary.trim() ||
				run.steps.some((step) => !['done', 'skipped'].includes(step.status)))
		)
			throw new AppError(
				'INVALID_DATA',
				'Complete or skip every step, answer open decisions, and save an outcome before completing a run.',
			);
		if (run.status === 'paused' && !run.nextAction.trim())
			throw new AppError('INVALID_DATA', 'A paused run needs a next action for the next agent.');
	}
	return {
		format: 'webmcp-project',
		version: 1,
		id: id(input.id, 'Project ID'),
		...projectFields(input),
		decisions,
		runs,
		createdAt: date(input.createdAt, 'Project created date'),
		updatedAt: date(input.updatedAt, 'Project updated date'),
	};
}
function emptyProject(): ProjectFile {
	const now = new Date().toISOString();
	return {
		format: 'webmcp-project',
		version: 1,
		id: crypto.randomUUID(),
		title: 'My project',
		objective: 'Describe the work to continue.',
		context: '',
		taskListPath: null,
		references: [],
		decisions: [],
		runs: [],
		createdAt: now,
		updatedAt: now,
	};
}
export const projectsDocument = new WorkspaceJson<ProjectFile>(
	'.project.json',
	'/Documents/My project.project.json',
	'/System/projects-session.json',
	emptyProject,
	parseProjectFile,
);

async function checkEvidence(items: ProjectEvidence[]) {
	for (const item of items) {
		if (!item.target.startsWith('/')) continue;
		if (!(await workspaceService.exists(item.target)))
			throw new AppError(
				'PATH_NOT_FOUND',
				`Evidence file ${item.target} is missing.`,
				'Save the output first, then link it in the project.',
			);
		if ((await workspaceService.stat(item.target)).kind !== 'file')
			throw new AppError('NOT_A_FILE', `${item.target} is not a file.`);
	}
}
async function inspectEvidence(items: ProjectEvidence[]): Promise<ProjectEvidenceWithExists[]> {
	return Promise.all(
		items.map(async (item) => {
			let exists: boolean | null = null;
			if (item.target.startsWith('/')) {
				try {
					exists = (await workspaceService.stat(item.target)).kind === 'file';
				} catch {
					exists = false;
				}
			}
			return { ...item, exists };
		}),
	);
}
function guardDraft(path: string, options: MutationOptions) {
	if (options.actor === 'agent' && projectsDocument.hasPendingEdits(path))
		throw new AppError(
			'OPEN_DRAFT',
			'This project has an unsaved edit in Projects.',
			'Ask the user to save or discard it, then read projects_read for a fresh revision.',
		);
}
async function current(path: string, expectedRevision: string, options: MutationOptions) {
	path = appFilePath(path, '.project.json');
	guardDraft(path, options);
	if (typeof expectedRevision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(expectedRevision))
		throw new AppError(
			'REVISION_REQUIRED',
			'Read projects_read and supply its expectedRevision before changing a project.',
		);
	await workspaceService.ready();
	const record = await projectsDocument.read(path);
	if (record.revision !== expectedRevision)
		throw new AppError(
			'FILE_CHANGED',
			'The project changed. Read projects_read again before saving.',
		);
	return record;
}
function projectSummary(record: JsonRecord<ProjectFile>): ProjectSummary {
	const data = record.data,
		run = data.runs.at(-1);
	const excerpt = (value: string, max: number) =>
		value.length > max ? `${value.slice(0, max - 3)}...` : value;
	return {
		path: record.path,
		id: data.id,
		title: data.title,
		objective: excerpt(data.objective, 240),
		updatedAt: data.updatedAt,
		runCount: data.runs.length,
		openDecisionCount: data.decisions.filter((item) => item.answer === null).length,
		latestRun: run
			? {
					id: run.id,
					agent: run.agent,
					status: run.status,
					summary: excerpt(run.summary, 360),
					nextAction: excerpt(run.nextAction, 240),
					updatedAt: run.updatedAt,
					completedSteps: run.steps.filter((step) => ['done', 'skipped'].includes(step.status))
						.length,
					totalSteps: run.steps.length,
				}
			: null,
	};
}
export function formatProjectBrief(path: string, brief: ProjectBrief) {
	const lines = [
		`# ${brief.title}`,
		'',
		brief.objective,
		'',
		`Project file: ${path}`,
		'',
		'## Project context',
		'',
		brief.context || 'No lasting context saved yet.',
	];
	const run = brief.latestRun;
	if (run) {
		lines.push(
			'',
			'## Latest checkpoint',
			'',
			`Session agent: ${run.agent}. Checkpoint saved at ${run.updatedAt}. Status: ${run.status}.`,
			`Run ID: ${run.id}`,
			`Objective: ${run.objective}`,
			'',
			run.summary || 'No outcome reported yet.',
			'',
			`Next action: ${run.nextAction || 'None reported.'}`,
			'',
			...run.steps.map((step, index) => `${index + 1}. [${step.status}] ${step.title}`),
		);
	}
	for (const [title, decisions] of [
		['Needs an answer', brief.openDecisions],
		['Recent decisions', brief.recentDecisions],
	] as const) {
		if (!decisions.length) continue;
		lines.push('', `## ${title}`, '');
		for (const decision of decisions) {
			lines.push(`Question: ${decision.question}`);
			if (decision.answer !== null) lines.push(`Answer: ${decision.answer}`);
			else if (decision.options.length) lines.push(`Options: ${decision.options.join(' | ')}`);
			lines.push(`Decision ID: ${decision.id}`, '');
		}
	}
	const links = [...brief.references, ...(run?.evidence ?? [])];
	if (links.length)
		lines.push(
			'',
			'## References and evidence',
			'',
			...links.map(
				(item) =>
					`- ${item.label}: ${item.target}${item.exists === false ? ' [missing]' : ''}${item.detail ? `. ${item.detail}` : ''}`,
			),
		);
	if (brief.taskList)
		lines.push(
			'',
			'## Linked tasks',
			'',
			`Task list: ${brief.taskList.path}`,
			'',
			...brief.taskList.tasks.map((task) => `- [${task.status}] ${task.title}, task ID ${task.id}`),
			...(brief.taskList.omittedTasks
				? [`${brief.taskList.omittedTasks} more tasks are available through tasks_list.`]
				: []),
		);
	if (brief.omittedDecisions)
		lines.push(
			'',
			`${brief.omittedDecisions} older answered decisions remain in the project file.`,
		);
	if (brief.warnings.length) lines.push('', ...brief.warnings);
	lines.push('', brief.reportingNote);
	return lines.join('\n');
}
async function withBrief(record: JsonRecord<ProjectFile>): Promise<ProjectRecord> {
	const data = record.data,
		run = data.runs.at(-1);
	const references = await inspectEvidence(data.references);
	const evidence = run ? await inspectEvidence(run.evidence) : [];
	const warnings: string[] = [];
	for (const item of [...references, ...evidence])
		if (item.exists === false) warnings.push(`Linked evidence is missing: ${item.target}`);
	let taskList: ProjectBrief['taskList'] = null;
	if (data.taskListPath) {
		try {
			const linked = await tasksDocument.read(data.taskListPath);
			const ordered = [...linked.data.tasks].sort(
				(a, b) => Number(a.status === 'done') - Number(b.status === 'done'),
			);
			taskList = {
				path: linked.path,
				title: linked.data.title,
				revision: linked.revision,
				tasks: ordered.slice(0, 20).map(({ id, title, status, sourcePath, outputPath }) => ({
					id,
					title,
					status,
					sourcePath,
					outputPath,
				})),
				omittedTasks: Math.max(0, ordered.length - 20),
			};
		} catch (error) {
			warnings.push(
				`Cannot read linked task list ${data.taskListPath}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	const answered = data.decisions
		.filter((decision) => decision.answer !== null)
		.sort((a, b) => b.answeredAt!.localeCompare(a.answeredAt!) || b.id.localeCompare(a.id));
	const brief: ProjectBrief = {
		projectId: data.id,
		title: data.title,
		objective: data.objective,
		context: data.context,
		references,
		latestRun: run ? { ...run, evidence } : null,
		openDecisions: data.decisions.filter((decision) => decision.answer === null),
		recentDecisions: answered.slice(0, 10),
		omittedDecisions: Math.max(0, answered.length - 10),
		taskList,
		warnings,
		reportingNote:
			'Agent names, progress, and verification claims are reported context. Projects does not observe agent execution or run the linked checks. Check the evidence before relying on a claim.',
	};
	return { ...record, brief, briefText: formatProjectBrief(record.path, brief) };
}
async function save(base: JsonRecord<ProjectFile>, options: MutationOptions, guard?: () => void) {
	base.data.updatedAt = new Date().toISOString();
	const record = await projectsDocument.write(
		base.path,
		base.data,
		base.revision,
		false,
		options.actor ?? 'human',
		options.signal,
		() => {
			guardDraft(base.path, options);
			guard?.();
		},
	);
	return withBrief(record);
}

export const projectsService = {
	document: projectsDocument,
	async list() {
		await workspaceService.ready();
		const candidates = workspaceService
			.getAllPaths()
			.filter((path) => isProjectPath(path) && !/^\/(System|Trash)(\/|$)/.test(path))
			.sort();
		const projects: ProjectSummary[] = [],
			warnings: { path: string; message: string }[] = [];
		for (const path of candidates.slice(0, 100)) {
			try {
				if ((await workspaceService.stat(path)).kind !== 'file') continue;
				projects.push(projectSummary(await projectsDocument.read(path)));
			} catch (error) {
				warnings.push({ path, message: error instanceof Error ? error.message : String(error) });
			}
		}
		projects.sort(
			(a, b) =>
				Number(b.openDecisionCount > 0) - Number(a.openDecisionCount > 0) ||
				b.updatedAt.localeCompare(a.updatedAt),
		);
		return { projects, warnings, truncated: candidates.length > 100 };
	},
	async read(path?: string) {
		await workspaceService.ready();
		const target = path ?? (await projectsDocument.resolvePath());
		if (!(await workspaceService.exists(target)))
			throw new AppError(
				'PROJECT_NOT_FOUND',
				`No saved project at ${target}.`,
				'Use projects_list to find a project, or projects_create to start one.',
			);
		return withBrief(await projectsDocument.read(target));
	},
	async create(path: string, input: ProjectInput, options: MutationOptions = {}) {
		path = appFilePath(path, '.project.json');
		const data = {
			...emptyProject(),
			...projectFields(
				strictObject(input, ['title', 'objective', 'context', 'taskListPath', 'references']),
			),
		};
		await workspaceService.ready();
		await checkEvidence(data.references);
		if (data.taskListPath) await tasksDocument.read(data.taskListPath);
		const record = await projectsDocument.write(
			path,
			data,
			undefined,
			true,
			options.actor ?? 'human',
			options.signal,
			() => guardDraft(path, options),
		);
		return withBrief(record);
	},
	async update(
		path: string,
		expectedRevision: string,
		changes: Partial<ProjectInput>,
		options: MutationOptions = {},
	) {
		const patch = strictObject(changes, [
			'title',
			'objective',
			'context',
			'taskListPath',
			'references',
		]);
		if (!Object.keys(patch).length)
			throw new AppError('INVALID_INPUT', 'Supply at least one project field to change.');
		const base = await current(path, expectedRevision, options);
		const fields = projectFields({ ...base.data, ...patch });
		if (patch.references !== undefined) await checkEvidence(fields.references);
		if (fields.taskListPath && fields.taskListPath !== base.data.taskListPath)
			await tasksDocument.read(fields.taskListPath);
		base.data = { ...base.data, ...fields };
		return save(base, options);
	},
	async start(
		path: string,
		expectedRevision: string,
		input: StartRunInput,
		options: MutationOptions = {},
	) {
		const values = strictObject(input, ['agent', 'objective', 'steps', 'basedOn']);
		const base = await current(path, expectedRevision, options);
		const previous = base.data.runs.at(-1);
		if (previous && ['working', 'waiting'].includes(previous.status))
			throw new AppError(
				'RUN_ACTIVE',
				'Pause the current run or answer its waiting decision before starting another.',
				'Read projects_read and use projects_checkpoint with a summary and nextAction.',
			);
		if ((values.basedOn ?? null) !== (previous?.id ?? null))
			throw new AppError(
				'HANDOFF_CHANGED',
				'Start from the latest saved run.',
				'Read projects_read and pass brief.latestRun.id as basedOn.',
			);
		const now = new Date().toISOString();
		const run: ProjectRun = {
			id: crypto.randomUUID(),
			agent: boundedText(values.agent, 'Reporting agent', 120),
			objective: boundedText(values.objective, 'Run objective', 2000),
			status: 'working',
			summary: '',
			nextAction: '',
			steps: steps(
				list(values.steps, 'Run steps', 40).map((title, index) => ({
					id: crypto.randomUUID(),
					title,
					status: index === 0 ? 'in-progress' : 'pending',
				})),
			),
			evidence: [],
			basedOn: previous?.id ?? null,
			createdAt: now,
			updatedAt: now,
		};
		base.data.runs.push(run);
		return { ...(await save(base, options)), run };
	},
	async prepare(
		path: string,
		expectedRevision: string,
		input: PrepareRunInput,
		options: MutationOptions = {},
	) {
		const values = strictObject(input, ['objective', 'steps', 'summary', 'nextAction', 'evidence']);
		const base = await current(path, expectedRevision, options);
		const guardPreparedWork = () => guardDraft(base.path, { ...options, actor: 'agent' });
		guardPreparedWork();
		const previous = base.data.runs.at(-1);
		if (previous && ['working', 'waiting'].includes(previous.status))
			throw new AppError(
				'RUN_ACTIVE',
				'Pause or complete the current run before preparing more work.',
			);
		const evidence = evidenceList(values.evidence);
		await checkEvidence(evidence);
		const now = new Date().toISOString();
		const run: ProjectRun = {
			id: crypto.randomUUID(),
			agent: 'Prepared work',
			objective: boundedText(values.objective, 'Run objective', 2000),
			status: 'paused',
			summary: boundedText(values.summary, 'Run summary', 6000),
			nextAction: boundedText(values.nextAction, 'Next action', 2000),
			steps: steps(
				list(values.steps, 'Run steps', 40).map((title) => ({
					id: crypto.randomUUID(),
					title,
					status: 'pending',
				})),
			),
			evidence,
			basedOn: previous?.id ?? null,
			createdAt: now,
			updatedAt: now,
		};
		base.data.runs.push(run);
		return { ...(await save(base, options, guardPreparedWork)), run };
	},
	async checkpoint(
		path: string,
		runId: string,
		expectedRevision: string,
		input: CheckpointInput,
		options: MutationOptions = {},
	) {
		const values = strictObject(input, [
			'status',
			'summary',
			'nextAction',
			'steps',
			'evidence',
			'decision',
		]);
		if (!Object.keys(values).length)
			throw new AppError('INVALID_INPUT', 'Supply a checkpoint field to change.');
		const base = await current(path, expectedRevision, options);
		const run = base.data.runs.at(-1);
		if (!run || run.id !== runId)
			throw new AppError(
				'RUN_NOT_CURRENT',
				'Only the latest run can receive a checkpoint.',
				'Read projects_read for the current run ID. Older runs remain saved as handoffs.',
			);
		if (run.status === 'completed')
			throw new AppError('RUN_COMPLETED', 'This run is complete. Start a new run based on it.');
		if (values.status !== undefined)
			run.status = status(values.status, PROJECT_RUN_STATUSES, 'Run status');
		if (values.summary !== undefined)
			run.summary = boundedText(values.summary, 'Run summary', 6000, true);
		if (values.nextAction !== undefined)
			run.nextAction = boundedText(values.nextAction, 'Next action', 2000, true);
		if (values.steps !== undefined) run.steps = steps(values.steps);
		if (values.evidence !== undefined) {
			run.evidence = evidenceList(values.evidence);
			await checkEvidence(run.evidence);
		}
		let decision: ProjectDecision | undefined;
		if (values.decision !== undefined) {
			if (values.status !== undefined && values.status !== 'waiting')
				throw new AppError(
					'INVALID_STATUS',
					'A checkpoint that asks a decision must use waiting status.',
				);
			decision = {
				id: crypto.randomUUID(),
				runId: run.id,
				...decisionFields(values.decision),
				answer: null,
				createdAt: new Date().toISOString(),
				answeredAt: null,
			};
			base.data.decisions.push(decision);
			run.status = 'waiting';
		}
		run.updatedAt = new Date().toISOString();
		return { ...(await save(base, options)), run, ...(decision ? { decision } : {}) };
	},
	async answer(
		path: string,
		decisionId: string,
		expectedRevision: string,
		answer: string,
		options: MutationOptions = {},
	) {
		answer = boundedText(answer, 'Decision answer', 4000);
		const base = await current(path, expectedRevision, options);
		const decision = base.data.decisions.find((item) => item.id === decisionId);
		if (!decision)
			throw new AppError(
				'DECISION_NOT_FOUND',
				'This decision is missing. Read projects_read again.',
			);
		if (decision.answer !== null)
			throw new AppError(
				'DECISION_ANSWERED',
				'This decision already has an answer. Save changed guidance in the project context or ask a new decision.',
			);
		decision.answer = answer;
		decision.answeredAt = new Date().toISOString();
		const run = base.data.runs.find((item) => item.id === decision.runId)!;
		if (
			run.status === 'waiting' &&
			!base.data.decisions.some((item) => item.runId === run.id && item.answer === null)
		) {
			run.status = 'paused';
			if (!run.nextAction.trim())
				run.nextAction = 'Read the answered decision, then continue the remaining steps.';
			// Answering does not claim the reporting agent has resumed or checked in.
		}
		return { ...(await save(base, options)), decision };
	},
};
