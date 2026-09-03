import { Bash } from 'just-bash/browser';
import { documentsCommand } from '../office/command';
import { activityService, type ActivityActor } from '../activity/activity';
import { WorkspaceFileSystem } from '../workspace/just-bash-filesystem';
import { workspaceService } from '../workspace/workspace';

export const terminalJobStatuses = [
	'queued',
	'running',
	'completed',
	'failed',
	'cancelled',
	'timed_out',
] as const;

export type TerminalJobStatus = (typeof terminalJobStatuses)[number];

export type TerminalJob = {
	id: string;
	command: string;
	cwd: string;
	stdout: string;
	stderr: string;
	exitCode: number | null;
	actor: ActivityActor;
	status: TerminalJobStatus;
	revision: number;
	background: boolean;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
};

export type TerminalWaitResult = {
	job: TerminalJob;
	waitTimedOut: boolean;
};

type TerminalJobRecord = TerminalJob & {
	controller: AbortController;
	timeoutMs: number;
	abortKind?: 'cancelled' | 'timed_out';
	settled: boolean;
	completion: Promise<TerminalJob>;
	resolveCompletion: (job: TerminalJob) => void;
};

const foregroundTimeoutMs = 8_000;
const maximumJobTimeoutMs = 300_000;

function isFinished(status: TerminalJobStatus) {
	return ['completed', 'failed', 'cancelled', 'timed_out'].includes(status);
}

function abortReason(signal: AbortSignal) {
	return signal.reason instanceof Error
		? signal.reason
		: new DOMException('The operation was cancelled.', 'AbortError');
}

class TerminalService {
	#bash: Bash | null = null;
	#queue: Promise<unknown> = Promise.resolve();
	#jobs: TerminalJobRecord[] = [];
	#jobById = new Map<string, TerminalJobRecord>();
	#listeners = new Set<() => void>();
	#cwd = '/Projects/Launch';
	#env: Record<string, string> = {
		HOME: '/Projects',
		USER: 'guest',
		TERM: 'xterm-256color',
	};

	async ready() {
		await workspaceService.ready();
		this.#bash ??= new Bash({
			customCommands: [documentsCommand],
			fs: new WorkspaceFileSystem(),
			cwd: this.#cwd,
			env: this.#env,
			executionLimits: {
				maxExecutionTimeMs: maximumJobTimeoutMs,
				maxOutputSize: 200_000,
				maxCommandCount: 2_000,
				maxLoopIterations: 10_000,
			},
		});
	}

	get cwd() {
		return this.#cwd;
	}

	list() {
		return this.#jobs.map((job) => this.#snapshot(job));
	}

	get(jobId: string) {
		const job = this.#jobById.get(jobId);
		return job ? this.#snapshot(job) : undefined;
	}

	subscribe(listener: () => void) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#notify() {
		for (const listener of this.#listeners) listener();
	}

	#snapshot(job: TerminalJobRecord): TerminalJob {
		return {
			id: job.id,
			command: job.command,
			cwd: job.cwd,
			stdout: job.stdout,
			stderr: job.stderr,
			exitCode: job.exitCode,
			actor: job.actor,
			status: job.status,
			revision: job.revision,
			background: job.background,
			createdAt: job.createdAt,
			startedAt: job.startedAt,
			finishedAt: job.finishedAt,
		};
	}

	#recordActivity(job: TerminalJobRecord) {
		const action =
			job.status === 'completed'
				? 'Command completed'
				: job.status === 'cancelled'
					? 'Command cancelled'
					: job.status === 'timed_out'
						? 'Command timed out'
						: 'Command failed';
		const detail =
			job.status === 'cancelled'
				? `${job.command} was cancelled.`
				: job.status === 'timed_out'
					? `${job.command} exceeded ${Math.round(job.timeoutMs / 1_000)} seconds.`
					: `${job.command}${job.exitCode === 0 ? '' : ` exited with ${job.exitCode}`}.`;

		activityService.record({ actor: job.actor, action, detail, path: job.cwd });
	}

	#finish(job: TerminalJobRecord, status: TerminalJobStatus) {
		if (job.settled) return;
		job.status = status;
		job.finishedAt = new Date().toISOString();
		job.revision += 1;
		job.settled = true;
		this.#recordActivity(job);
		const snapshot = this.#snapshot(job);
		this.#notify();
		job.resolveCompletion(snapshot);
	}

	async #execute(job: TerminalJobRecord) {
		if (job.settled) return this.#snapshot(job);

		job.status = 'running';
		job.startedAt = new Date().toISOString();
		job.revision += 1;
		this.#notify();

		const timeoutId = window.setTimeout(() => {
			job.abortKind = 'timed_out';
			job.controller.abort(new DOMException('The command timed out.', 'TimeoutError'));
		}, job.timeoutMs);

		try {
			const result = await this.#bash!.exec(job.command, {
				cwd: job.cwd,
				env: this.#env,
				replaceEnv: true,
				signal: job.controller.signal,
			});
			this.#env = result.env;
			this.#cwd = result.env.PWD ?? job.cwd;

			job.stdout = result.stdout;
			job.stderr = result.stderr;
			job.exitCode = job.controller.signal.aborted ? 124 : result.exitCode;
			await workspaceService.refresh();

			if (job.abortKind === 'timed_out') {
				if (!job.stderr) job.stderr = 'Command timed out.\n';
				this.#finish(job, 'timed_out');
			} else if (job.controller.signal.aborted) {
				this.#finish(job, 'cancelled');
			} else {
				this.#finish(job, result.exitCode === 0 ? 'completed' : 'failed');
			}
		} catch (error) {
			job.exitCode = job.controller.signal.aborted ? 124 : 1;
			job.stderr = error instanceof Error ? `${error.message}\n` : `${String(error)}\n`;
			await workspaceService.refresh();
			this.#finish(
				job,
				job.abortKind === 'timed_out'
					? 'timed_out'
					: job.controller.signal.aborted
						? 'cancelled'
						: 'failed',
			);
		} finally {
			window.clearTimeout(timeoutId);
		}

		return this.#snapshot(job);
	}

	async start(
		command: string,
		actor: ActivityActor = 'agent',
		options: { cwd?: string; timeoutMs?: number; background?: boolean } = {},
	) {
		await this.ready();
		const cwd = options.cwd ?? this.cwd;
		const cwdEntry = await workspaceService.stat(cwd);
		if (cwdEntry.kind !== 'directory') throw new Error(`${cwd} is not a directory.`);

		let resolveCompletion!: (job: TerminalJob) => void;
		const completion = new Promise<TerminalJob>((resolve) => {
			resolveCompletion = resolve;
		});
		const job: TerminalJobRecord = {
			id: crypto.randomUUID(),
			command,
			cwd,
			stdout: '',
			stderr: '',
			exitCode: null,
			actor,
			status: 'queued',
			revision: 1,
			background: options.background ?? true,
			createdAt: new Date().toISOString(),
			startedAt: null,
			finishedAt: null,
			controller: new AbortController(),
			timeoutMs: Math.min(options.timeoutMs ?? maximumJobTimeoutMs, maximumJobTimeoutMs),
			settled: false,
			completion,
			resolveCompletion,
		};

		this.#jobs.push(job);
		this.#jobById.set(job.id, job);
		if (job.background) {
			activityService.record({
				actor,
				action: 'Command started',
				detail: `${command}.`,
				path: cwd,
			});
		}
		const snapshot = this.#snapshot(job);
		this.#notify();

		const pending = this.#queue.then(
			() => this.#execute(job),
			() => this.#execute(job),
		);
		this.#queue = pending.catch(() => undefined);
		return snapshot;
	}

	async run(
		command: string,
		actor: ActivityActor = 'human',
		options: { cwd?: string; signal?: AbortSignal } = {},
	) {
		options.signal?.throwIfAborted();
		const started = await this.start(command, actor, {
			cwd: options.cwd,
			timeoutMs: foregroundTimeoutMs,
			background: false,
		});
		const job = this.#jobById.get(started.id)!;
		const cancelFromCaller = () => {
			void this.cancel(job.id);
		};
		options.signal?.addEventListener('abort', cancelFromCaller, { once: true });
		if (options.signal?.aborted) cancelFromCaller();

		try {
			const result = await job.completion;
			if (options.signal?.aborted) throw abortReason(options.signal);
			return result;
		} finally {
			options.signal?.removeEventListener('abort', cancelFromCaller);
		}
	}

	async wait(
		jobId: string,
		options: { afterRevision?: number; timeoutMs?: number; signal?: AbortSignal } = {},
	): Promise<TerminalWaitResult> {
		const job = this.#jobById.get(jobId);
		if (!job) throw new Error(`Terminal job ${jobId} does not exist.`);
		options.signal?.throwIfAborted();
		const afterRevision = options.afterRevision ?? job.revision;

		if (isFinished(job.status) || job.revision > afterRevision) {
			return { job: this.#snapshot(job), waitTimedOut: false };
		}

		return new Promise<TerminalWaitResult>((resolve, reject) => {
			let settled = false;
			const finish = (waitTimedOut: boolean) => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timeoutId);
				this.#listeners.delete(handleUpdate);
				options.signal?.removeEventListener('abort', handleAbort);
				resolve({ job: this.#snapshot(job), waitTimedOut });
			};
			const handleUpdate = () => {
				if (isFinished(job.status) || job.revision > afterRevision) finish(false);
			};
			const handleAbort = () => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timeoutId);
				this.#listeners.delete(handleUpdate);
				reject(abortReason(options.signal!));
			};
			const timeoutId = window.setTimeout(
				() => finish(true),
				Math.min(options.timeoutMs ?? 20_000, 30_000),
			);

			this.#listeners.add(handleUpdate);
			options.signal?.addEventListener('abort', handleAbort, { once: true });
			handleUpdate();
		});
	}

	async cancel(jobId: string) {
		const job = this.#jobById.get(jobId);
		if (!job) throw new Error(`Terminal job ${jobId} does not exist.`);
		if (isFinished(job.status)) return { job: this.#snapshot(job), changed: false };

		job.abortKind = 'cancelled';
		job.controller.abort(new DOMException('The command was cancelled.', 'AbortError'));
		if (job.status === 'queued') {
			job.exitCode = 124;
			this.#finish(job, 'cancelled');
		}
		const finished = await job.completion;
		return { job: finished, changed: true };
	}
}

export const terminalService = new TerminalService();
