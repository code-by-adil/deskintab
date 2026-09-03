import { expect, test, type Page } from '@playwright/test';

type Job = {
	id: string;
	command: string;
	status: string;
	revision: number;
	stdout?: string;
	stderr?: string;
};
type ToolResult = {
	structuredContent: {
		ok: boolean;
		error?: { code: string; message: string };
		run?: Job;
		job?: Job;
		jobs?: Job[];
	};
};
type CapturedTool = {
	name: string;
	inputSchema: { required?: string[]; additionalProperties: boolean };
	annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
	execute(input: unknown, options?: { signal?: AbortSignal }): Promise<ToolResult>;
};

declare global {
	interface Window {
		__contractTools: Record<string, CapturedTool>;
		__contractRegistrations: AbortSignal[];
		__contractRejectedTool?: string;
	}
}

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		window.__contractTools = {};
		window.__contractRegistrations = [];
		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			value: {
				async registerTool(tool: CapturedTool, options: { signal: AbortSignal }) {
					if (options.signal.aborted) return;
					if (window.__contractRejectedTool === tool.name) throw new Error('Registration failed.');
					if (window.__contractTools[tool.name]) throw new Error('Tool already registered.');
					window.__contractTools[tool.name] = tool;
					window.__contractRegistrations.push(options.signal);
					options.signal.addEventListener(
						'abort',
						() => {
							if (window.__contractTools[tool.name] === tool)
								delete window.__contractTools[tool.name];
						},
						{ once: true },
					);
				},
			},
		});
	});
	await page.goto('/');
	await page.waitForFunction(() => Object.keys(window.__contractTools).length === 70);
});

async function call(page: Page, name: string, input: unknown = {}) {
	return page.evaluate(({ name, input }) => window.__contractTools[name].execute(input), {
		name,
		input,
	});
}

test('rejects malformed arguments before touching the workspace', async ({ page }) => {
	for (const input of [null, [], 'text', false]) {
		expect(await call(page, 'desktop_get_context', input)).toMatchObject({
			structuredContent: { ok: false, error: { code: 'INVALID_INPUT' } },
		});
	}
	for (const [name, input] of [
		['files_write', { path: '/Documents/Rejected.md', content: 'No write', extra: true }],
		['files_search', { query: 'brief', includeTrash: null }],
		['activity_list', { limit: null }],
		['files_read', { path: '/Projects/Launch/brief.md', startLine: null }],
		['files_list', null],
	] as const) {
		expect(await call(page, name, input), name).toMatchObject({
			structuredContent: { ok: false, error: { code: 'INVALID_INPUT' } },
		});
	}
	const missing = await call(page, 'files_stat', { path: '/Documents/Rejected.md' });
	expect(missing.structuredContent).toMatchObject({
		ok: false,
		error: { code: 'PATH_NOT_FOUND' },
	});
	expect((await call(page, 'files_list')).structuredContent.ok).toBe(true);
});

test('checks declared required fields before invoking each tool', async ({ page }) => {
	const results = await page.evaluate(async () => {
		const tools = Object.values(window.__contractTools).filter(
			(tool) => tool.inputSchema.required?.length,
		);
		return Promise.all(
			tools.map(async (tool) => ({
				name: tool.name,
				result: (await tool.execute({})).structuredContent,
			})),
		);
	});
	expect(results.length).toBeGreaterThan(20);
	for (const { name, result } of results) {
		expect(result, name).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
		expect(result.error.message).toContain('required argument');
	}
});

test('unregisters old tools and rolls back a partial registration', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { registerWebMCPTools } = await import('/src/lib/webmcp/register.ts');
		const originalSignals = [...window.__contractRegistrations];
		const unregister = await registerWebMCPTools();
		const oldAborted = originalSignals.every((signal) => signal.aborted);
		const registered = Object.keys(window.__contractTools).length;
		unregister();
		const afterCleanup = Object.keys(window.__contractTools).length;
		window.__contractRejectedTool = 'terminal_jobs';
		let rejected = false;
		try {
			await registerWebMCPTools();
		} catch {
			rejected = true;
		}
		return {
			oldAborted,
			registered,
			afterCleanup,
			rejected,
			afterFailure: Object.keys(window.__contractTools).length,
			allAborted: window.__contractRegistrations.every((signal) => signal.aborted),
		};
	});
	expect(result).toEqual({
		oldAborted: true,
		registered: 70,
		afterCleanup: 0,
		rejected: true,
		afterFailure: 0,
		allAborted: true,
	});
});

test('lists job metadata and marks returned command output as untrusted', async ({ page }) => {
	const run = await call(page, 'terminal_run', {
		command: "printf 'untrusted stdout'; printf 'untrusted stderr' >&2",
	});
	expect(run.structuredContent.ok).toBe(true);
	const jobId = run.structuredContent.run.id;
	const listing = await call(page, 'terminal_jobs');
	expect(listing.structuredContent.jobs).toContainEqual(
		expect.objectContaining({ id: jobId, status: 'completed', revision: 3 }),
	);
	for (const job of listing.structuredContent.jobs) {
		expect(job).not.toHaveProperty('stdout');
		expect(job).not.toHaveProperty('stderr');
	}
	const waited = await call(page, 'terminal_wait', { jobId });
	expect(waited.structuredContent.job).toMatchObject({
		stdout: 'untrusted stdout',
		stderr: 'untrusted stderr',
	});
	const cancelled = await call(page, 'terminal_cancel', { jobId });
	expect(cancelled.structuredContent.job.stdout).toBe('untrusted stdout');
	expect(await page.evaluate(() => window.__contractTools.terminal_cancel.annotations)).toEqual({
		readOnlyHint: false,
		untrustedContentHint: true,
	});
});
