import { expect, test, type Page } from '@playwright/test';
import { semanticDiff } from '../src/lib/activity/semantic-diff';

const path = '/Documents/Research.project.json';
const firstUpdate = '2026-09-03T08:00:00.000Z';
const laterUpdate = '2026-09-03T08:30:00.000Z';

function projectFixture(): any {
	return {
		format: 'webmcp-project',
		version: 1,
		id: 'research',
		title: 'Research brief',
		objective: 'Prepare a report from the saved sources.',
		context: 'Keep source notes beside the report.',
		taskListPath: null,
		references: [{ label: 'Source notes', target: '/Notes/Sources.md', detail: '' }],
		decisions: [],
		runs: [
			{
				id: 'run-a',
				agent: 'Research agent',
				objective: 'Prepare the first draft',
				status: 'working',
				summary: '',
				nextAction: 'Read the source notes.',
				steps: [
					{ id: 'sources', title: 'Read sources', status: 'in-progress' },
					{ id: 'draft', title: 'Write the brief', status: 'pending' },
				],
				evidence: [],
				basedOn: null,
				createdAt: firstUpdate,
				updatedAt: firstUpdate,
			},
		],
		createdAt: firstUpdate,
		updatedAt: firstUpdate,
	};
}

async function setup(page: Page) {
	await page.addInitScript(() => {
		const tools: Record<string, any> = {};
		Object.defineProperty(window, '__projectHistoryTools', { value: tools });
		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			value: {
				registerTool(tool: any) {
					tools[tool.name] = tool;
				},
			},
		});
	});
	await page.goto('/');
	await page.waitForFunction(() => Boolean((window as any).__projectHistoryTools.review_read));
}

async function ok(page: Page, name: string, input: Record<string, unknown> = {}) {
	const result = await page.evaluate(
		async ({ name, input }) =>
			(window as any).__projectHistoryTools[name].execute(input, {
				signal: new AbortController().signal,
			}),
		{ name, input },
	);
	expect(result.structuredContent.ok, JSON.stringify(result)).toBe(true);
	return result.structuredContent;
}

test('Review keeps readable project checkpoints and decisions from the saved version', async ({
	page,
}) => {
	await setup(page);
	const project = projectFixture();
	const created = await ok(page, 'files_write', {
		path,
		content: JSON.stringify(project, null, 2),
		createOnly: true,
	});
	const added = (await ok(page, 'review_read', { versionId: created.entry.versionId })).review;
	expect(added.semantic.kind).toBe('projects');
	expect(added.semantic.changes).toContainEqual(
		expect.objectContaining({ id: 'run:run-a', fields: ['added'] }),
	);
	project.context = 'The final report needs an answer about audience.';
	project.runs[0].status = 'waiting';
	project.runs[0].summary = 'I verified every source and prepared the draft.';
	project.runs[0].nextAction = 'Wait for the audience decision.';
	project.runs[0].steps[0].status = 'done';
	project.runs[0].steps[1].status = 'in-progress';
	project.runs[0].evidence = [
		{ label: 'Draft report', target: '/Documents/Brief.md', detail: 'Draft for review.' },
	];
	project.runs[0].updatedAt = laterUpdate;
	project.updatedAt = laterUpdate;
	project.decisions = [
		{
			id: 'audience',
			runId: 'run-a',
			question: 'Who should the report address?',
			options: ['Developers', 'Researchers'],
			answer: null,
			createdAt: laterUpdate,
			answeredAt: null,
		},
	];
	const checkpoint = await ok(page, 'files_write', {
		path,
		content: JSON.stringify(project, null, 2),
		expectedRevision: created.revision,
	});
	const waiting = (await ok(page, 'review_read', { versionId: checkpoint.entry.versionId })).review;
	expect(waiting.semantic.changes).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: '$context', fields: ['context'] }),
			expect.objectContaining({
				id: 'decision:audience',
				summary: 'Requested a decision on "Who should the report address?".',
			}),
			expect.objectContaining({
				id: 'run:run-a',
				fields: ['status', 'summary', 'nextAction', 'evidence'],
			}),
			expect.objectContaining({ id: 'run:run-a:step:sources', fields: ['status'] }),
		]),
	);
	const waitingSummary = waiting.semantic.changes.map((change: any) => change.summary).join('\n');
	expect(waitingSummary).toContain('reported status from Working to Waiting');
	expect(waitingSummary).toContain('saved evidence links');
	expect(waitingSummary).not.toContain('verified');

	project.decisions[0].answer = 'Researchers';
	project.decisions[0].answeredAt = laterUpdate;
	project.runs[0].status = 'completed';
	project.runs[0].nextAction = '';
	project.runs[0].steps[1].status = 'done';
	const completed = await ok(page, 'files_write', {
		path,
		content: JSON.stringify(project, null, 2),
		expectedRevision: checkpoint.revision,
	});
	const latest = (await ok(page, 'review_read', { versionId: completed.entry.versionId })).review;
	expect(latest.semantic.changes).toContainEqual(
		expect.objectContaining({
			id: 'decision:audience',
			fields: ['answer'],
			summary: 'Decision "Who should the report address?". Saved answer "Researchers".',
		}),
	);
	expect(
		latest.semantic.changes.find((change: any) => change.id === 'run:run-a').summary,
	).toContain('reported status from Waiting to Completed');
	await ok(page, 'desktop_reveal', { target: 'activity' });
	const activity = page.locator('[data-app-id="activity"]');
	await activity.getByRole('button', { name: 'Review', exact: true }).click();
	await activity
		.getByRole('button', { name: /Research\.project\.json/ })
		.first()
		.click();
	const summary = activity.getByRole('region', { name: 'Changes in this save' });
	await expect(summary).toContainText('Saved answer "Researchers"');
	await expect(summary).toContainText('reported status from Waiting to Completed');
	await expect(activity.locator('.raw-change')).not.toHaveAttribute('open');
	await page.reload();
	await page.waitForFunction(() => Boolean((window as any).__projectHistoryTools.review_read));
	const savedCheckpoint = (await ok(page, 'review_read', { versionId: checkpoint.entry.versionId }))
		.review;
	expect(savedCheckpoint.semantic).toEqual(waiting.semantic);
});

test('project timestamps and JSON property order do not become content changes', () => {
	const before = projectFixture();
	before.decisions = [
		{
			id: 'audience',
			runId: 'run-a',
			question: 'Who should the report address?',
			options: ['Researchers'],
			answer: 'Researchers',
			createdAt: firstUpdate,
			answeredAt: firstUpdate,
		},
	];
	const after = structuredClone(before);
	after.createdAt = laterUpdate;
	after.updatedAt = laterUpdate;
	after.runs[0].createdAt = laterUpdate;
	after.runs[0].updatedAt = laterUpdate;
	after.decisions[0].createdAt = laterUpdate;
	after.decisions[0].answeredAt = laterUpdate;
	after.references = [{ detail: '', target: '/Notes/Sources.md', label: 'Source notes' }];
	expect(semanticDiff(path, JSON.stringify(before), JSON.stringify(after))).toEqual({
		kind: 'projects',
		changes: [],
		total: 0,
		truncated: false,
	});
	after.runs[0].steps.reverse();
	expect(semanticDiff(path, JSON.stringify(before), JSON.stringify(after))?.changes).toEqual([
		expect.objectContaining({
			id: 'run:run-a',
			fields: ['steps'],
			summary: expect.stringContaining('Reordered the plan steps'),
		}),
	]);
});

test('run and step IDs cannot collide in Review rows', () => {
	const project = projectFixture();
	project.runs[0].status = 'paused';
	project.runs.push({
		...structuredClone(project.runs[0]),
		id: 'run-a:step:sources',
		status: 'working',
		basedOn: 'run-a',
	});
	const changes = semanticDiff(path, '', JSON.stringify(project))!.changes;
	expect(new Set(changes.map((change) => change.id)).size).toBe(changes.length);
});

test('malformed projects retain a raw Review diff', async ({ page }) => {
	await setup(page);
	const project = projectFixture();
	const created = await ok(page, 'files_write', {
		path,
		content: JSON.stringify(project, null, 2),
		createOnly: true,
	});
	project.runs[0].steps[0].status = 'verified';
	const malformed = await ok(page, 'files_write', {
		path,
		content: JSON.stringify(project, null, 2),
		expectedRevision: created.revision,
	});
	const review = (await ok(page, 'review_read', { versionId: malformed.entry.versionId })).review;
	expect(review.semantic).toBeNull();
	expect(
		review.diff.lines.some((line: any) => line.kind === 'added' && line.text.includes('verified')),
	).toBe(true);
	for (const invalid of [
		{ ...projectFixture(), format: 'different-format' },
		{ ...projectFixture(), references: [{ label: 'Missing target' }] },
		{ ...projectFixture(), runs: [projectFixture().runs[0], projectFixture().runs[0]] },
		{ ...projectFixture(), runs: [{ ...projectFixture().runs[0], isDeleted: true }] },
	])
		expect(
			semanticDiff(path, JSON.stringify(projectFixture()), JSON.stringify(invalid)),
		).toBeNull();
});

test('unknown project fields and invalid omitted timestamps expose the raw save', async ({
	page,
}) => {
	await setup(page);
	const project = projectFixture();
	project.runs[0].evidence = structuredClone(project.references);
	project.decisions = [
		{
			id: 'audience',
			runId: 'run-a',
			question: 'Who should the report address?',
			options: ['Researchers'],
			answer: 'Researchers',
			createdAt: firstUpdate,
			answeredAt: firstUpdate,
		},
	];
	const records: (string | number)[][] = [
		[],
		['runs', 0],
		['runs', 0, 'steps', 0],
		['decisions', 0],
		['references', 0],
		['runs', 0, 'evidence', 0],
	];
	const invalid = records.map((keys) => {
		const changed = structuredClone(project);
		keys.reduce((record, key) => record[key], changed).unknownField = 'Cannot open this project';
		return changed;
	});
	for (const keys of [[], ['runs', 0], ['decisions', 0]] as (string | number)[][]) {
		const changed = structuredClone(project);
		keys.reduce((record, key) => record[key], changed).createdAt = 'yesterday';
		invalid.push(changed);
	}
	const missingAnswerDate = structuredClone(project);
	missingAnswerDate.decisions[0].answeredAt = null;
	invalid.push(missingAnswerDate);
	const unsupportedAnswerDate = structuredClone(project);
	unsupportedAnswerDate.decisions[0].answeredAt = 'yesterday';
	invalid.push(unsupportedAnswerDate);
	const validContent = JSON.stringify(project, null, 2);
	for (const changed of invalid) {
		expect(semanticDiff(path, validContent, JSON.stringify(changed))).toBeNull();
		expect(semanticDiff(path, JSON.stringify(changed), validContent)).toBeNull();
	}
	const rejected = await page.evaluate(
		async ({ project, invalid }) => {
			const { parseProjectFile } = await import('/src/lib/projects/projects.ts');
			parseProjectFile(project);
			return invalid.map((file) => {
				try {
					parseProjectFile(file);
					return false;
				} catch {
					return true;
				}
			});
		},
		{ project, invalid },
	);
	expect(rejected).toEqual(invalid.map(() => true));
	const created = await ok(page, 'files_write', { path, content: validContent, createOnly: true });
	const saved = await ok(page, 'files_write', {
		path,
		content: JSON.stringify(invalid[1], null, 2),
		expectedRevision: created.revision,
	});
	expect(
		(await ok(page, 'review_read', { versionId: saved.entry.versionId })).review.semantic,
	).toBeNull();
	await ok(page, 'desktop_reveal', { target: 'activity' });
	const activity = page.locator('[data-app-id="activity"]');
	await activity.getByRole('button', { name: 'Review', exact: true }).click();
	await activity
		.getByRole('button', { name: /Research\.project\.json/ })
		.first()
		.click();
	await expect(activity.getByRole('region', { name: 'Changes in this save' })).toHaveCount(0);
	await expect(activity.locator('.raw-change')).toHaveAttribute('open');
	await expect(activity.getByRole('table')).toContainText('unknownField');
});
