import { AppError } from '../errors';
import {
	defineTool,
	optionalString,
	requiredString,
	optionalInteger,
	optionalEnum,
	optionalAbsolutePath,
	optionalBoolean,
	successfulResult,
} from '../webmcp/tool-utils';
import { reviewService } from './review';
import { activityService } from './activity';

const id = {
	type: 'string',
	description: 'review_list ID or saved entry.versionId.',
};
const strings = {
	type: 'array',
	maxItems: 50,
	uniqueItems: true,
	items: { type: 'string', maxLength: 2048 },
};
function list(input: Record<string, unknown>, key: string) {
	const value = input[key] === undefined ? [] : input[key];
	if (
		!Array.isArray(value) ||
		value.length > 50 ||
		new Set(value).size !== value.length ||
		value.some((v) => typeof v !== 'string' || !v.trim() || v.length > 2048)
	)
		throw new AppError('INVALID_INPUT', `${key} must contain up to 50 unique, non-empty strings.`);
	return value as string[];
}
export const activityTools: WebMCP.ModelContextTool[] = [
	defineTool({
		name: 'review_list',
		title: 'List versions and summaries',
		description:
			'List version IDs, paths, authors, recovery state, summaries. Supported saves retain100 versions/64MiB before/after snapshots; links expire. Moves/deletions/arbitrary Bash have no snapshots.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Exact version path filter.' },
				limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
			},
			additionalProperties: false,
		},
		async execute(input) {
			const path = optionalAbsolutePath(input, 'path'),
				limit = optionalInteger(input, 'limit', 30, 1, 100);
			const data = await reviewService.list();
			return successfulResult(
				{
					...data,
					versions: data.versions.filter((v) => !path || v.path === path).slice(0, limit),
				},
				'Listed saved changes and work summaries.',
			);
		},
	}),
	defineTool({
		name: 'review_read',
		title: 'Read saved version',
		description:
			'Read current.token, canRestore, blockers/copy path. Projects/Tasks/Canvas give object changes; includeRawDiff adds JSON. Text gives diff/excerpts; binary size/revision. Restore copy for contents.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['versionId'],
			properties: {
				versionId: id,
				includeRawDiff: {
					type: 'boolean',
					default: false,
					description: 'Include raw project/task/canvas JSON diff.',
				},
			},
			additionalProperties: false,
		},
		async execute(input) {
			const review = await reviewService.read(
				requiredString(input, 'versionId', { maxLength: 36 }),
			);
			const omitRaw = review.semantic && !optionalBoolean(input, 'includeRawDiff');
			return successfulResult(
				{ review: { ...review, ...(omitRaw ? { diff: null, rawDiffOmitted: true } : {}) } },
				'Read saved version and restoration safety checks.',
			);
		},
	}),
	defineTool({
		name: 'review_restore',
		title: 'Restore version',
		description:
			'copy restores side before/after to destination. replace restores prior contents with review_read current.token; rejects changed/missing files or drafts and retains a recovery version. Cannot undo arbitrary Bash or remove newly created files.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['versionId', 'mode'],
			properties: {
				versionId: id,
				mode: { type: 'string', enum: ['replace', 'copy'] },
				side: { type: 'string', enum: ['before', 'after'], default: 'before' },
				destination: {
					type: 'string',
					description: 'Copy requires new absolute path with original extension.',
				},
				expectedCurrentToken: {
					type: 'string',
					description: 'Replace requires review_read current.token.',
				},
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const mode = optionalEnum(input, 'mode', ['replace', 'copy'] as const);
			if (!mode) throw new AppError('INVALID_INPUT', 'Provide mode replace or copy.');
			const result = await reviewService.restore(
				{
					versionId: requiredString(input, 'versionId', { maxLength: 36 }),
					mode,
					side: optionalEnum(input, 'side', ['before', 'after'] as const),
					destination: optionalAbsolutePath(input, 'destination'),
					expectedCurrentToken: optionalString(input, 'expectedCurrentToken', { maxLength: 71 }),
				},
				'agent',
				signal,
			);
			return successfulResult(
				result,
				`Restored ${result.entry.path}${mode === 'copy' ? ' as a new copy' : ' with a recovery version of the replaced file'}.`,
			);
		},
	}),
	defineTool({
		name: 'review_session',
		title: 'Save work summary',
		description:
			'Save reported work summary/related evidence IDs. Updates need id/expectedRevision; lists replace. Include related actions only. Activity details outlive feed; snapshots expire.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['title', 'status', 'summary'],
			properties: {
				id: {
					type: 'string',
					description: 'review_session/review_list ID.',
				},
				expectedRevision: { type: 'integer', minimum: 1 },
				title: { type: 'string', maxLength: 120 },
				status: { type: 'string', enum: ['working', 'completed'] },
				summary: { type: 'string', maxLength: 4000 },
				questions: strings,
				results: strings,
				versionIds: strings,
				activityIds: strings,
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const status = optionalEnum(input, 'status', ['working', 'completed'] as const);
			if (!status) throw new AppError('INVALID_INPUT', 'Provide status working or completed.');
			const session = await reviewService.session(
				{
					id: optionalString(input, 'id', { maxLength: 36 }),
					expectedRevision:
						input.expectedRevision === undefined
							? undefined
							: optionalInteger(input, 'expectedRevision', 1, 1, 1_000_000),
					title: requiredString(input, 'title', { maxLength: 120 }),
					summary: requiredString(input, 'summary', { allowEmpty: true, maxLength: 4000 }),
					status,
					questions: list(input, 'questions'),
					results: list(input, 'results'),
					versionIds: list(input, 'versionIds'),
					activityIds: list(input, 'activityIds'),
				},
				'agent',
				signal,
			);
			return successfulResult(
				{ session },
				`Saved work summary "${session.title}" with status ${session.status}.`,
			);
		},
	}),
	defineTool({
		name: 'activity_list',
		title: 'List activity',
		description: 'List recent human/agent/Terminal/system actions, newest first.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 } },
			additionalProperties: false,
		},
		execute(input) {
			const limit = optionalInteger(input, 'limit', 30, 1, 100);
			const entries = activityService.list(limit);
			return successfulResult({ entries }, `Returned ${entries.length} recent actions.`);
		},
	}),
];
