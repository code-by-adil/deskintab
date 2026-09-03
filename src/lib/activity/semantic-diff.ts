export type SemanticChange = { id: string; summary: string; fields: string[] };
export type SemanticDiff = {
	kind: 'tasks' | 'canvas' | 'projects';
	changes: SemanticChange[];
	total: number;
	truncated: boolean;
};
type Item = Record<string, any>;
const equal = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const quoted = (value: unknown) =>
	`"${String(value ?? '')
		.replace(/\s+/g, ' ')
		.slice(0, 160)}"`;
const statusName = (value: string) =>
	({ todo: 'To do', 'in-progress': 'In progress', done: 'Done' })[value] ?? value;
function indexed(items: unknown, max: number): Map<string, Item> {
	if (!Array.isArray(items) || items.length > max) throw new Error('Unsupported records');
	const map = new Map<string, Item>();
	for (const item of items) {
		if (!item || typeof item !== 'object' || typeof item.id !== 'string' || map.has(item.id))
			throw new Error('Invalid IDs');
		if (!item.isDeleted) map.set(item.id, item);
	}
	return map;
}
function canvasItems(file: Item) {
	const native = file.type === 'excalidraw' && file.version === 2;
	if (!native && !(file.format === 'webmcp-canvas' && file.version === 1))
		throw new Error('Unsupported canvas');
	const all = indexed(native ? file.elements : file.objects, 2000);
	const labels = new Map(
		[...all.values()]
			.filter((e) => e.type === 'text' && e.containerId)
			.map((e) => [e.containerId, e]),
	);
	const result = new Map<string, Item>();
	for (const [id, element] of all) {
		if (element.type === 'text' && element.containerId && all.has(element.containerId)) continue;
		const label = labels.get(id);
		result.set(id, {
			...element,
			text: label?.originalText ?? label?.text ?? element.originalText ?? element.text ?? '',
			labelStyle: label
				? [
						label.fontSize,
						label.fontFamily,
						label.strokeColor,
						label.textAlign,
						label.verticalAlign,
						label.opacity,
					]
				: null,
			imageData: element.type === 'image' ? file.files?.[element.fileId]?.dataURL : null,
		});
	}
	return result;
}

const runStatuses = ['working', 'waiting', 'paused', 'completed'];
const stepStatuses = ['pending', 'in-progress', 'done', 'skipped'];
const reportedStatus = (value: string) =>
	({
		working: 'Working',
		waiting: 'Waiting',
		paused: 'Paused',
		completed: 'Completed',
		pending: 'Pending',
		skipped: 'Skipped',
	})[value] ?? statusName(value);
const record = (value: unknown): value is Item =>
	Boolean(value && typeof value === 'object' && !Array.isArray(value));
const strings = (item: Item, keys: string[]) => keys.every((key) => typeof item[key] === 'string');
const nullableString = (value: unknown) => value === null || typeof value === 'string';
const projectDate = (value: unknown) => {
	if (typeof value !== 'string' || value.length > 40) return false;
	const time = Date.parse(value);
	return Number.isFinite(time) && new Date(time).toISOString() === value;
};
function projectObject(value: unknown, keys: string[]): asserts value is Item {
	if (!record(value) || Object.keys(value).some((key) => !keys.includes(key)))
		throw new Error('Unsupported project fields');
}
function projectEvidence(items: unknown) {
	if (!Array.isArray(items) || items.length > 40) throw new Error('Invalid project evidence');
	for (const item of items) {
		projectObject(item, ['label', 'target', 'detail']);
		if (!strings(item, ['label', 'target', 'detail'])) throw new Error('Invalid project evidence');
	}
}
function projectRecords(items: unknown, max: number) {
	const records = indexed(items, max);
	if (records.size !== (items as Item[]).length) throw new Error('Invalid project records');
	return records;
}
const evidenceValues = (items: Item[]) =>
	items.map(({ label, target, detail }) => [label, target, detail]);

// Keep this projection independent of the Projects service and its workspace imports.
// Unknown fields and invalid omitted timestamps must expose the raw saved changes.
function projectItems(file: Item) {
	projectObject(file, [
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
	if (
		file.format !== 'webmcp-project' ||
		file.version !== 1 ||
		!strings(file, ['id', 'title', 'objective', 'context']) ||
		!nullableString(file.taskListPath) ||
		!projectDate(file.createdAt) ||
		!projectDate(file.updatedAt)
	)
		throw new Error('Unsupported project');
	projectEvidence(file.references);
	const runs = projectRecords(file.runs, 100),
		decisions = projectRecords(file.decisions, 250);
	const steps = new Map<string, Map<string, Item>>();
	for (const [id, run] of runs) {
		projectObject(run, [
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
		if (
			!strings(run, ['agent', 'objective', 'summary', 'nextAction']) ||
			!runStatuses.includes(run.status) ||
			!nullableString(run.basedOn) ||
			!projectDate(run.createdAt) ||
			!projectDate(run.updatedAt)
		)
			throw new Error('Invalid run');
		projectEvidence(run.evidence);
		const plan = projectRecords(run.steps, 40);
		for (const step of plan.values()) {
			projectObject(step, ['id', 'title', 'status']);
			if (!strings(step, ['title']) || !stepStatuses.includes(step.status))
				throw new Error('Invalid plan');
		}
		steps.set(id, plan);
	}
	for (const decision of decisions.values()) {
		projectObject(decision, [
			'id',
			'runId',
			'question',
			'options',
			'answer',
			'createdAt',
			'answeredAt',
		]);
		if (
			!strings(decision, ['runId', 'question']) ||
			!projectDate(decision.createdAt) ||
			!nullableString(decision.answer) ||
			!(decision.answeredAt === null || projectDate(decision.answeredAt)) ||
			(decision.answer === null) !== (decision.answeredAt === null) ||
			!Array.isArray(decision.options) ||
			decision.options.length > 8 ||
			decision.options.some((option: unknown) => typeof option !== 'string')
		)
			throw new Error('Invalid decision');
	}
	return { runs, decisions, steps };
}

function projectChanges(previous: Item | null, next: Item): SemanticChange[] {
	const b = projectItems(next),
		a = previous ? projectItems(previous) : null;
	const changes: SemanticChange[] = [];
	if (!previous)
		changes.push({
			id: '$project',
			fields: ['added'],
			summary: `Created project ${quoted(next.title)}.`,
		});
	else {
		const metadata = [
			['id', `Changed project ID from ${quoted(previous.id)} to ${quoted(next.id)}.`],
			['title', `Renamed project from ${quoted(previous.title)} to ${quoted(next.title)}.`],
			['objective', `Changed project objective to ${quoted(next.objective)}.`],
			['context', 'Updated project context.'],
			[
				'taskListPath',
				next.taskListPath
					? `Linked task list ${quoted(next.taskListPath)}.`
					: 'Cleared the task list link.',
			],
			['references', 'Changed project references.'],
		];
		for (const [key, summary] of metadata) {
			const oldValue = key === 'references' ? evidenceValues(previous[key]) : previous[key];
			const nextValue = key === 'references' ? evidenceValues(next[key]) : next[key];
			if (!equal(oldValue, nextValue)) changes.push({ id: `$${key}`, fields: [key], summary });
		}
	}
	for (const id of new Set([...(a?.decisions.keys() ?? []), ...b.decisions.keys()])) {
		const old = a?.decisions.get(id),
			item = b.decisions.get(id),
			name = quoted((item ?? old)!.question);
		if (!old || !item) {
			changes.push({
				id: `decision:${encodeURIComponent(id)}`,
				fields: [old ? 'removed' : 'added'],
				summary: old
					? `Removed decision ${name}.`
					: item!.answer === null
						? `Requested a decision on ${name}.`
						: `Saved decision ${name} with answer ${quoted(item!.answer)}.`,
			});
			continue;
		}
		const fields: string[] = [],
			parts: string[] = [];
		for (const key of ['question', 'options', 'runId', 'answer']) {
			if (equal(old[key], item[key])) continue;
			fields.push(key);
			if (key === 'question') parts.push(`Changed the question from ${quoted(old.question)}`);
			if (key === 'options') parts.push('Changed the answer options');
			if (key === 'runId') parts.push(`Linked run ${quoted(item.runId)}`);
			if (key === 'answer')
				parts.push(
					item.answer === null ? 'Reopened the decision' : `Saved answer ${quoted(item.answer)}`,
				);
		}
		if (fields.length)
			changes.push({
				id: `decision:${encodeURIComponent(id)}`,
				fields,
				summary: `Decision ${name}. ${parts.join('. ')}.`,
			});
	}
	for (const id of new Set([...(a?.runs.keys() ?? []), ...b.runs.keys()])) {
		const old = a?.runs.get(id),
			item = b.runs.get(id),
			name = quoted((item ?? old)!.objective);
		if (!old || !item) {
			changes.push({
				id: `run:${encodeURIComponent(id)}`,
				fields: [old ? 'removed' : 'added'],
				summary: old
					? `Removed run ${name}.`
					: `Added run ${name} for ${quoted(item!.agent)} with reported status ${reportedStatus(item!.status)}.`,
			});
		} else {
			const fields: string[] = [],
				parts: string[] = [];
			for (const key of [
				'agent',
				'objective',
				'status',
				'summary',
				'nextAction',
				'evidence',
				'basedOn',
			]) {
				const oldValue = key === 'evidence' ? evidenceValues(old[key]) : old[key];
				const nextValue = key === 'evidence' ? evidenceValues(item[key]) : item[key];
				if (equal(oldValue, nextValue)) continue;
				fields.push(key);
				if (key === 'agent') parts.push(`Changed reported agent to ${quoted(item.agent)}`);
				if (key === 'objective') parts.push(`Changed the objective from ${quoted(old.objective)}`);
				if (key === 'status')
					parts.push(
						`Changed reported status from ${reportedStatus(old.status)} to ${reportedStatus(item.status)}`,
					);
				if (key === 'summary') parts.push('Updated the saved summary');
				if (key === 'nextAction')
					parts.push(
						item.nextAction
							? `Set next action to ${quoted(item.nextAction)}`
							: 'Cleared the next action',
					);
				if (key === 'evidence') parts.push('Changed the saved evidence links');
				if (key === 'basedOn')
					parts.push(
						item.basedOn
							? `Linked previous run ${quoted(item.basedOn)}`
							: 'Cleared the previous run link',
					);
			}
			const oldOrder = old.steps.map((step: Item) => step.id),
				nextOrder = item.steps.map((step: Item) => step.id);
			if (!equal(oldOrder, nextOrder) && equal([...oldOrder].sort(), [...nextOrder].sort())) {
				fields.push('steps');
				parts.push('Reordered the plan steps');
			}
			if (fields.length)
				changes.push({
					id: `run:${encodeURIComponent(id)}`,
					fields,
					summary: `Updated checkpoint for run ${name}. ${parts.join('. ')}.`,
				});
		}
		if (!item) continue;
		const oldSteps = a?.steps.get(id),
			nextSteps = b.steps.get(id)!;
		for (const stepId of new Set([...(oldSteps?.keys() ?? []), ...nextSteps.keys()])) {
			const oldStep = oldSteps?.get(stepId),
				step = nextSteps.get(stepId),
				stepName = quoted((step ?? oldStep)!.title);
			const changeId = `run:${encodeURIComponent(id)}:step:${encodeURIComponent(stepId)}`;
			if (!oldStep || !step) {
				changes.push({
					id: changeId,
					fields: [oldStep ? 'removed' : 'added'],
					summary: oldStep
						? `Removed step ${stepName} from run ${name}.`
						: `Added step ${stepName} to run ${name} with reported status ${reportedStatus(step!.status)}.`,
				});
				continue;
			}
			const fields: string[] = [],
				parts: string[] = [];
			if (oldStep.title !== step.title) {
				fields.push('title');
				parts.push(`Renamed from ${quoted(oldStep.title)}`);
			}
			if (oldStep.status !== step.status) {
				fields.push('status');
				parts.push(
					`Changed reported status from ${reportedStatus(oldStep.status)} to ${reportedStatus(step.status)}`,
				);
			}
			if (fields.length)
				changes.push({
					id: changeId,
					fields,
					summary: `Step ${stepName} in run ${name}. ${parts.join('. ')}.`,
				});
		}
	}
	return changes;
}

// Describe changes from saved bytes. Never infer completion, authorship, or intent.
export function semanticDiff(path: string, before: string, after: string): SemanticDiff | null {
	const kind = path.endsWith('.tasks.json')
		? 'tasks'
		: path.endsWith('.project.json')
			? 'projects'
			: /\.(excalidraw|canvas\.json)$/.test(path)
				? 'canvas'
				: null;
	if (!kind) return null;
	try {
		const next = JSON.parse(after),
			previous = before ? JSON.parse(before) : null;
		if (!next || (previous && typeof previous !== 'object')) return null;
		if (kind === 'projects') {
			if (before && !previous) return null;
			const changes = projectChanges(previous, next);
			return {
				kind,
				changes: changes.slice(0, 100),
				total: changes.length,
				truncated: changes.length > 100,
			};
		}
		if (
			kind === 'tasks' &&
			[next, previous].filter(Boolean).some((f) => f.format !== 'webmcp-tasks' || f.version !== 1)
		)
			return null;
		const b = kind === 'tasks' ? indexed(next.tasks, 250) : canvasItems(next);
		const a = !previous
			? new Map<string, Item>()
			: kind === 'tasks'
				? indexed(previous.tasks, 250)
				: canvasItems(previous);
		const changes: SemanticChange[] = [];
		if (previous && previous.title !== next.title)
			changes.push({
				id: '$title',
				fields: ['title'],
				summary: `Renamed ${kind === 'tasks' ? 'task list' : 'canvas'} from ${quoted(previous.title)} to ${quoted(next.title)}.`,
			});
		if (kind === 'canvas' && previous && !equal(previous.appState, next.appState))
			changes.push({
				id: '$canvas',
				fields: ['appState'],
				summary: 'Changed canvas background or grid settings.',
			});
		for (const id of new Set([...a.keys(), ...b.keys()])) {
			const old = a.get(id),
				item = b.get(id);
			const name = quoted(
				kind === 'tasks'
					? (item ?? old)!.title
					: (item ?? old)!.text || `${(item ?? old)!.type} ${id}`,
			);
			if (!old || !item) {
				changes.push({
					id,
					fields: [old ? 'removed' : 'added'],
					summary: `${old ? 'Removed' : 'Added'} ${kind === 'tasks' ? 'task' : (item ?? old)!.type} ${name}.`,
				});
				continue;
			}
			const fields: string[] = [],
				parts: string[] = [];
			const changed = (keys: string[]) => keys.some((key) => !equal(old[key], item[key]));
			if (kind === 'tasks') {
				for (const key of ['title', 'status', 'dueDate', 'notes', 'sourcePath', 'outputPath']) {
					if (equal(old[key], item[key])) continue;
					fields.push(key);
					if (key === 'title') parts.push(`renamed from ${quoted(old.title)}`);
					if (key === 'status')
						parts.push(
							`changed status from ${statusName(old.status)} to ${statusName(item.status)}`,
						);
					if (key === 'dueDate')
						parts.push(item.dueDate ? `set due date to ${item.dueDate}` : 'cleared the due date');
					if (key === 'notes') parts.push('edited notes');
					if (key === 'sourcePath' || key === 'outputPath')
						parts.push(
							item[key]
								? `linked ${key === 'sourcePath' ? 'source' : 'output'} ${quoted(item[key])}`
								: `cleared the ${key === 'sourcePath' ? 'source' : 'output'} link`,
						);
				}
			} else {
				const groups = [
					[['x', 'y'], 'position', 'moved'],
					[['width', 'height'], 'size', 'resized'],
					[['angle'], 'angle', 'rotated'],
					[['text'], 'text', 'edited text'],
					[['startBinding', 'endBinding', 'from', 'to'], 'bindings', 'changed arrow connections'],
					[['points', 'pressures'], 'points', 'changed stroke or arrow geometry'],
					[['link'], 'link', 'changed file link'],
					[['groupIds'], 'groups', 'changed groups'],
					[['locked'], 'locked', item.locked ? 'locked' : 'unlocked'],
					[['imageData', 'fileId', 'crop', 'scale'], 'image', 'changed image'],
					[
						[
							'strokeColor',
							'backgroundColor',
							'fill',
							'color',
							'strokeWidth',
							'strokeStyle',
							'fillStyle',
							'roughness',
							'opacity',
							'fontSize',
							'fontFamily',
							'labelStyle',
						],
						'style',
						'changed appearance',
					],
				] as [string[], string, string][];
				for (const [keys, field, phrase] of groups)
					if (changed(keys)) {
						fields.push(field);
						parts.push(phrase);
					}
			}
			if (fields.length) changes.push({ id, fields, summary: `${name}: ${parts.join('; ')}.` });
		}
		return {
			kind,
			changes: changes.slice(0, 100),
			total: changes.length,
			truncated: changes.length > 100,
		};
	} catch {
		return null;
	}
}
