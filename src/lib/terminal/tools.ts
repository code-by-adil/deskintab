import { AppError } from '../errors';
import { terminalJobStatuses, terminalService } from './terminal';
import {
	defineTool,
	optionalAbsolutePath,
	optionalEnum,
	optionalInteger,
	requiredString,
	successfulResult,
} from '../webmcp/tool-utils';

const pathProperty = {
	type: 'string',
	description: 'Absolute workspace folder.',
};

export const terminalTools: WebMCP.ModelContextTool[] = [
	defineTool({
		name: 'terminal_run',
		title: 'Run command',
		description:
			'Run a short workspace Bash command and return final output. Use terminal_start for work beyond a few seconds.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['command'],
			properties: {
				command: {
					type: 'string',
					minLength: 1,
					maxLength: 20000,
					description: 'Bash command to run once.',
				},
				cwd: {
					...pathProperty,
					description: 'Start folder; defaults to current Terminal folder.',
				},
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const command = requiredString(input, 'command', { maxLength: 20_000 });
			const cwd = optionalAbsolutePath(input, 'cwd');
			const run = await terminalService.run(command, 'agent', { cwd, signal });
			return successfulResult(
				{ run },
				run.stdout || run.stderr || `Command exited with ${run.exitCode}.`,
			);
		},
	}),
	defineTool({
		name: 'terminal_start',
		title: 'Start Bash job',
		description:
			'Start a workspace Bash job and return its ID immediately. Use for work beyond a few seconds; follow with terminal_wait.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['command'],
			properties: {
				command: {
					type: 'string',
					minLength: 1,
					maxLength: 20000,
					description: 'Bash script to run once.',
				},
				cwd: {
					...pathProperty,
					description: 'Start folder; defaults to current Terminal folder.',
				},
				timeoutSeconds: {
					type: 'integer',
					minimum: 1,
					maximum: 300,
					default: 300,
					description: 'Job runtime limit, seconds.',
				},
			},
			additionalProperties: false,
		},
		async execute(input) {
			const command = requiredString(input, 'command', { maxLength: 20_000 });
			const cwd = optionalAbsolutePath(input, 'cwd');
			const timeoutSeconds = optionalInteger(input, 'timeoutSeconds', 300, 1, 300);
			const job = await terminalService.start(command, 'agent', {
				cwd,
				timeoutMs: timeoutSeconds * 1_000,
			});
			return successfulResult(
				{ job },
				`Started Terminal job ${job.id}. It is ${job.status} at revision ${job.revision}.`,
			);
		},
	}),
	defineTool({
		name: 'terminal_wait',
		title: 'Wait for job',
		description:
			'Wait for newer job state or completion using the latest afterRevision. Cancelling this wait leaves the job running.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['jobId'],
			properties: {
				jobId: { type: 'string', minLength: 1, maxLength: 100 },
				afterRevision: {
					type: 'integer',
					minimum: 0,
					description: 'Latest observed job revision.',
				},
				timeoutMs: {
					type: 'integer',
					minimum: 100,
					maximum: 30000,
					default: 20000,
					description: 'Wait-call limit in ms; does not limit job runtime.',
				},
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const jobId = requiredString(input, 'jobId', { maxLength: 100 });
			if (!terminalService.get(jobId)) {
				throw new AppError(
					'JOB_NOT_FOUND',
					`Terminal job ${jobId} does not exist.`,
					'Use terminal_jobs to inspect the available jobs.',
				);
			}
			const afterRevision =
				input.afterRevision === undefined
					? undefined
					: optionalInteger(input, 'afterRevision', 0, 0, 1_000_000);
			const timeoutMs = optionalInteger(input, 'timeoutMs', 20_000, 100, 30_000);
			const result = await terminalService.wait(jobId, { afterRevision, timeoutMs, signal });
			const summary = result.waitTimedOut
				? `Terminal job ${jobId} is still ${result.job.status} at revision ${result.job.revision}.`
				: result.job.stdout ||
					result.job.stderr ||
					`Terminal job ${jobId} is ${result.job.status} at revision ${result.job.revision}.`;
			return successfulResult(result, summary);
		},
	}),
	defineTool({
		name: 'terminal_cancel',
		title: 'Cancel job',
		description: 'Cancel a queued/running job. Finished jobs stay unchanged.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['jobId'],
			properties: { jobId: { type: 'string', minLength: 1, maxLength: 100 } },
			additionalProperties: false,
		},
		async execute(input) {
			const jobId = requiredString(input, 'jobId', { maxLength: 100 });
			if (!terminalService.get(jobId)) {
				throw new AppError(
					'JOB_NOT_FOUND',
					`Terminal job ${jobId} does not exist.`,
					'Use terminal_jobs to inspect the available jobs.',
				);
			}
			const result = await terminalService.cancel(jobId);
			return successfulResult(
				result,
				result.changed
					? `Cancelled Terminal job ${jobId}.`
					: `Terminal job ${jobId} was already ${result.job.status}.`,
			);
		},
	}),
	defineTool({
		name: 'terminal_jobs',
		title: 'List jobs',
		description:
			'List recent job IDs, commands, status, revisions, and timing; optionally filter status. Omits stdout/stderr. Read output with terminal_wait.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			properties: {
				status: { type: 'string', enum: terminalJobStatuses },
				limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
			},
			additionalProperties: false,
		},
		execute(input) {
			const status = optionalEnum(input, 'status', terminalJobStatuses);
			const limit = optionalInteger(input, 'limit', 30, 1, 100);
			const jobs = terminalService
				.list()
				.filter((job) => !status || job.status === status)
				.reverse()
				.slice(0, limit)
				.map(({ stdout: _stdout, stderr: _stderr, ...job }) => job);
			return successfulResult({ jobs }, `Returned ${jobs.length} Terminal jobs.`);
		},
	}),
];
