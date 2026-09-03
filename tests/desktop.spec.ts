import { expect, test, type Page } from '@playwright/test';

const dockApps = [
	'Home',
	'Inbox',
	'Shortcuts',
	'App Studio',
	'Projects',
	'Finder',
	'Notepad',
	'Documents',
	'Sheets',
	'Preview',
	'Tasks',
	'Canvas',
	'Terminal',
	'Activity',
	'Calculator',
	'Wallpapers',
];

type CapturedTool = {
	name: string;
	title?: string;
	annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
	execute(
		input: Record<string, unknown>,
		options?: { signal?: AbortSignal },
	): Promise<unknown> | unknown;
};

async function installWebMCPHarness(page: Page) {
	await page.addInitScript(() => {
		const captured: Record<string, CapturedTool> = {};
		const registrationOptions: Record<string, { signal?: AbortSignal }> = {};
		Object.defineProperty(window, '__webmcpTools', { value: captured, configurable: true });
		Object.defineProperty(window, '__webmcpRegistrationOptions', {
			value: registrationOptions,
			configurable: true,
		});
		Object.defineProperty(document, 'modelContext', {
			value: {
				async registerTool(tool: CapturedTool, options: { signal?: AbortSignal } = {}) {
					captured[tool.name] = tool;
					registrationOptions[tool.name] = options;
				},
			},
			configurable: true,
		});
	});
}

async function callTool(page: Page, name: string, input: Record<string, unknown>) {
	return page.evaluate(
		async ({ name, input }) => {
			const tools = (window as unknown as { __webmcpTools: Record<string, CapturedTool> })
				.__webmcpTools;
			return tools[name].execute(input, { signal: new AbortController().signal });
		},
		{ name, input },
	);
}

async function openDesktop(page: Page, withWebMCP = false) {
	const browserMessages: string[] = [];

	page.on('console', (message) => {
		if (message.type() === 'error') browserMessages.push(message.text());
	});
	page.on('pageerror', (error) => browserMessages.push(error.message));
	if (withWebMCP) await installWebMCPHarness(page);

	await page.goto('/', { waitUntil: 'domcontentloaded' });
	await expect(page).toHaveTitle('Deskstead');
	await expect(page.locator('.background-cover')).toBeVisible();
	await expect(page.locator('[data-app-id="finder"]')).toBeVisible();

	return browserMessages;
}

test('renders the reference desktop shell without browser errors', async ({ page }) => {
	const browserMessages = await openDesktop(page);

	for (const menu of ['Finder', 'File', 'Edit', 'View', 'Go', 'Window', 'Help']) {
		await expect(page.getByRole('button', { name: menu, exact: true })).toBeVisible();
	}

	for (const app of dockApps) {
		await expect(page.getByRole('button', { name: `Launch ${app} app` })).toBeVisible();
	}

	await expect(page.locator('[data-path="/Projects/Launch/brief.md"]')).toBeVisible();
	expect(browserMessages).toEqual([]);
});

test('WebMCP work moves through Files, Notepad, Terminal, and Activity', async ({ page }) => {
	const browserMessages = await openDesktop(page, true);
	await expect
		.poll(() => page.evaluate(() => Object.keys((window as any).__webmcpTools).sort()))
		.toEqual([
			'activity_list',
			'activity_navigate',
			'calculator_calculate',
			'calculator_read',
			'canvas_edit',
			'canvas_export',
			'canvas_read',
			'canvas_select',
			'desktop_describe_tool',
			'desktop_get_context',
			'desktop_reveal',
			'desktop_window',
			'documents_create',
			'documents_edit',
			'documents_export',
			'documents_read',
			'documents_select',
			'files_copy',
			'files_download',
			'files_list',
			'files_mkdir',
			'files_move',
			'files_patch',
			'files_read',
			'files_search',
			'files_stat',
			'files_trash',
			'files_write',
			'finder_navigate',
			'home_get_context',
			'home_list_skills',
			'home_navigate',
			'home_read_skill',
			'home_save_preferences',
			'home_save_skill',
			'inbox_create',
			'inbox_list',
			'inbox_navigate',
			'inbox_read',
			'inbox_update',
			'notepad_navigate',
			'notes_get_context',
			'packs_export',
			'packs_import',
			'packs_inspect',
			'preview_navigate',
			'preview_read',
			'preview_reveal',
			'preview_search',
			'projects_answer',
			'projects_checkpoint',
			'projects_create',
			'projects_list',
			'projects_navigate',
			'projects_read',
			'projects_start',
			'projects_update',
			'review_list',
			'review_read',
			'review_restore',
			'review_session',
			'sheets_chart',
			'sheets_create',
			'sheets_edit',
			'sheets_export',
			'sheets_read',
			'sheets_select',
			'shortcuts_create',
			'shortcuts_list',
			'shortcuts_prepare',
			'shortcuts_read',
			'shortcuts_update',
			'studio_create',
			'studio_list',
			'studio_open',
			'studio_query',
			'studio_read',
			'studio_update',
			'tasks_create',
			'tasks_list',
			'tasks_navigate',
			'tasks_update',
			'terminal_cancel',
			'terminal_jobs',
			'terminal_run',
			'terminal_start',
			'terminal_wait',
			'wallpapers_read',
			'wallpapers_set',
		]);
	const toolMetadata = await page.evaluate(() => {
		const tools = (window as any).__webmcpTools;
		const options = (window as any).__webmcpRegistrationOptions;
		return {
			readOnly: tools.files_read.annotations.readOnlyHint,
			untrusted: tools.files_read.annotations.untrustedContentHint,
			writeReadOnly: tools.files_write.annotations.readOnlyHint,
			hasNames: Object.values(tools).every((tool: any) => Boolean(tool.name)),
			hasLifecycleSignals: Object.values(options).every(
				(entry: any) => entry.signal instanceof AbortSignal,
			),
		};
	});
	expect(toolMetadata).toEqual({
		readOnly: true,
		untrusted: true,
		writeReadOnly: false,
		hasNames: true,
		hasLifecycleSignals: true,
	});
	const nativeStyleResult = (await page.evaluate(() => {
		const tool = (window as any).__webmcpTools.files_list as CapturedTool;
		return tool.execute({ path: '/' }, {});
	})) as { structuredContent: { ok: boolean } };
	expect(nativeStyleResult.structuredContent.ok).toBe(true);
	const cancellation = await page.evaluate(async () => {
		const tool = (window as any).__webmcpTools.terminal_run as CapturedTool;
		const controller = new AbortController();
		const pending = tool.execute({ command: 'sleep 5' }, { signal: controller.signal });
		setTimeout(() => controller.abort(), 20);
		try {
			await pending;
			return 'completed';
		} catch (error) {
			return error instanceof DOMException ? error.name : String(error);
		}
	});
	expect(cancellation).toBe('AbortError');

	const path = '/Projects/Launch/agent-report.md';
	const report = '# Agent report\n\nThe workspace is ready for the demo.\n';
	await callTool(page, 'files_write', { path, content: report });
	await expect(page.locator(`[data-path="${path}"]`)).toBeVisible();

	await callTool(page, 'terminal_run', { command: "grep -n 'workspace' agent-report.md" });
	await page.getByRole('button', { name: 'Launch Terminal app' }).click();
	const terminal = page.locator('[data-app-id="terminal"]');
	await expect(terminal).toBeVisible();
	await expect(terminal.locator('.xterm-rows')).toContainText(
		"grep -n 'workspace' agent-report.md",
	);
	await expect(terminal.locator('.xterm-rows')).toContainText(
		'3:The workspace is ready for the demo.',
	);
	await callTool(page, 'terminal_run', { command: 'cd /Documents' });
	const pwdRun = (await callTool(page, 'terminal_run', { command: 'pwd' })) as {
		structuredContent: { run: { cwd: string; stdout: string } };
	};
	expect(pwdRun.structuredContent.run.cwd).toBe('/Documents');
	expect(pwdRun.structuredContent.run.stdout).toBe('/Documents\n');

	await page.getByRole('button', { name: 'Launch Finder app' }).click();
	await page.locator(`[data-path="${path}"]`).dblclick();
	const textEdit = page.locator('[data-app-id="textedit"]');
	await expect(textEdit).toBeVisible();
	await textEdit.getByRole('button', { name: 'Show Markdown source' }).click();
	await expect(textEdit.getByTestId('document-source')).toHaveValue(report);

	await page.getByRole('button', { name: 'Launch Activity app' }).click();
	const activity = page.locator('[data-app-id="activity"]');
	await expect(activity.getByText('Document created')).toBeVisible();
	await expect(activity.getByText('Command completed').first()).toBeVisible();

	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.locator(`[data-path="${path}"]`)).toBeVisible();
	const readBack = (await callTool(page, 'files_read', { path })) as {
		structuredContent: { content: string };
	};
	expect(readBack.structuredContent.content).toBe(report);
	expect(browserMessages).toEqual([]);
});

test('long Terminal jobs can be followed, listed, and cancelled', async ({ page }) => {
	const browserMessages = await openDesktop(page, true);
	const started = (await callTool(page, 'terminal_start', {
		command: "sleep 0.4; printf 'background complete\\n'",
		cwd: '/Projects/Launch',
		timeoutSeconds: 5,
	})) as any;
	expect(started.structuredContent.job).toMatchObject({
		status: 'queued',
		revision: 1,
		background: true,
	});

	const jobId = started.structuredContent.job.id as string;
	const running = (await callTool(page, 'terminal_wait', {
		jobId,
		afterRevision: 1,
		timeoutMs: 1_000,
	})) as any;
	expect(running.structuredContent.job).toMatchObject({ status: 'running', revision: 2 });
	const cancelledWait = await page.evaluate(async (jobId) => {
		const tool = (window as any).__webmcpTools.terminal_wait as CapturedTool;
		const controller = new AbortController();
		const pending = tool.execute(
			{ jobId, afterRevision: 2, timeoutMs: 1_000 },
			{ signal: controller.signal },
		);
		setTimeout(() => controller.abort(), 20);
		try {
			await pending;
			return 'completed';
		} catch (error) {
			return error instanceof DOMException ? error.name : String(error);
		}
	}, jobId);
	expect(cancelledWait).toBe('AbortError');
	const stillRunning = (await callTool(page, 'terminal_jobs', { status: 'running' })) as any;
	expect(stillRunning.structuredContent.jobs).toEqual(
		expect.arrayContaining([expect.objectContaining({ id: jobId, status: 'running' })]),
	);

	const boundedWait = (await callTool(page, 'terminal_wait', {
		jobId,
		afterRevision: 2,
		timeoutMs: 100,
	})) as any;
	expect(boundedWait.structuredContent).toMatchObject({
		waitTimedOut: true,
		job: { status: 'running', revision: 2 },
	});

	const completed = (await callTool(page, 'terminal_wait', {
		jobId,
		afterRevision: 2,
		timeoutMs: 2_000,
	})) as any;
	expect(completed.structuredContent).toMatchObject({
		waitTimedOut: false,
		job: {
			status: 'completed',
			revision: 3,
			exitCode: 0,
			stdout: 'background complete\n',
		},
	});

	const completedJobs = (await callTool(page, 'terminal_jobs', {
		status: 'completed',
	})) as any;
	expect(completedJobs.structuredContent.jobs).toEqual(
		expect.arrayContaining([expect.objectContaining({ id: jobId, status: 'completed' })]),
	);

	const second = (await callTool(page, 'terminal_start', {
		command: 'sleep 5',
		timeoutSeconds: 10,
	})) as any;
	const secondId = second.structuredContent.job.id as string;
	await callTool(page, 'terminal_wait', {
		jobId: secondId,
		afterRevision: second.structuredContent.job.revision,
		timeoutMs: 1_000,
	});
	const cancelled = (await callTool(page, 'terminal_cancel', { jobId: secondId })) as any;
	expect(cancelled.structuredContent).toMatchObject({
		changed: true,
		job: { id: secondId, status: 'cancelled', exitCode: 124 },
	});

	const finalWait = (await callTool(page, 'terminal_wait', {
		jobId: secondId,
		afterRevision: 999,
		timeoutMs: 100,
	})) as any;
	expect(finalWait.structuredContent).toMatchObject({
		waitTimedOut: false,
		job: { status: 'cancelled' },
	});

	const timingOut = (await callTool(page, 'terminal_start', {
		command: 'sleep 2',
		timeoutSeconds: 1,
	})) as any;
	const timeoutJobId = timingOut.structuredContent.job.id as string;
	const timeoutRunning = (await callTool(page, 'terminal_wait', {
		jobId: timeoutJobId,
		afterRevision: timingOut.structuredContent.job.revision,
		timeoutMs: 1_000,
	})) as any;
	const timedOut = (await callTool(page, 'terminal_wait', {
		jobId: timeoutJobId,
		afterRevision: timeoutRunning.structuredContent.job.revision,
		timeoutMs: 2_000,
	})) as any;
	expect(timedOut.structuredContent).toMatchObject({
		waitTimedOut: false,
		job: { status: 'timed_out', exitCode: 124 },
	});

	await page.getByRole('button', { name: 'Launch Terminal app' }).click();
	const terminal = page.locator('[data-app-id="terminal"]');
	await expect(terminal.locator('.xterm-rows')).toContainText('background complete');
	await expect(terminal.locator('.xterm-rows')).toContainText('cancelled (exit 124)');
	await expect(terminal).toContainText('local');

	await page.getByRole('button', { name: 'Launch Activity app' }).click();
	const activity = page.locator('[data-app-id="activity"]');
	await expect(activity.getByText('Command started').first()).toBeVisible();
	await expect(activity.getByText('Command cancelled').first()).toBeVisible();
	expect(browserMessages).toEqual([]);
});

test('file management tools stay visible and return recoverable errors', async ({ page }) => {
	const browserMessages = await openDesktop(page, true);
	const archive = '/Projects/Launch/Archive';
	const copied = `${archive}/meeting-notes-copy.md`;
	const renamed = `${archive}/handoff-notes.md`;

	const mkdir = (await callTool(page, 'files_mkdir', { path: archive })) as any;
	expect(mkdir.structuredContent).toMatchObject({ ok: true, created: true });
	await callTool(page, 'files_copy', {
		source: '/Projects/Launch/meeting-notes.md',
		destination: copied,
	});
	const stat = (await callTool(page, 'files_stat', { path: copied })) as any;
	expect(stat.structuredContent.entry).toMatchObject({ path: copied, kind: 'file' });

	await callTool(page, 'files_move', { source: copied, destination: renamed });
	await callTool(page, 'desktop_reveal', { target: 'finder', path: renamed });
	const finder = page.locator('[data-app-id="finder"]');
	await expect(finder.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
	await expect(finder.locator(`[data-path="${renamed}"]`)).toHaveClass(/selected/);

	const todoPath = '/Projects/Launch/todo.md';
	const originalTask = '- [ ] Prepare a concise project status report';
	const completedTask = '- [x] Prepare a concise project status report';
	const patched = (await callTool(page, 'files_patch', {
		path: todoPath,
		find: originalTask,
		replace: completedTask,
	})) as any;
	expect(patched.structuredContent).toMatchObject({ ok: true, replacements: 1 });
	const rangedRead = (await callTool(page, 'files_read', {
		path: todoPath,
		startLine: 1,
		maxLines: 2,
	})) as any;
	expect(rangedRead.structuredContent).toMatchObject({
		ok: true,
		startLine: 1,
		endLine: 2,
		truncated: true,
	});

	const mismatch = (await callTool(page, 'files_patch', {
		path: todoPath,
		find: originalTask,
		replace: completedTask,
	})) as any;
	expect(mismatch.structuredContent).toMatchObject({
		ok: false,
		error: { code: 'MATCH_COUNT_MISMATCH' },
	});

	const trashed = (await callTool(page, 'files_trash', { path: renamed })) as any;
	expect(trashed.structuredContent).toMatchObject({ ok: true, originalPath: renamed });
	const trashPath = trashed.structuredContent.trashPath as string;
	await page.getByRole('button', { name: 'Trash', exact: true }).click();
	await expect(page.locator(`[data-path="${trashPath}"]`)).toBeVisible();

	await callTool(page, 'files_move', { source: trashPath, destination: renamed });
	await callTool(page, 'desktop_reveal', { target: 'textedit', path: renamed });
	await page
		.locator('[data-app-id="textedit"]')
		.getByRole('button', { name: 'Show Markdown source' })
		.click();
	await expect(page.getByTestId('document-source')).toHaveValue(
		/The desktop shell and persistent workspace are in place\./,
	);
	expect(browserMessages).toEqual([]);
});

test('a person can edit a document and read the saved result through WebMCP', async ({ page }) => {
	const browserMessages = await openDesktop(page, true);
	const path = '/Documents/Welcome.md';

	await page.getByRole('button', { name: 'Documents', exact: true }).click();
	await page.locator(`[data-path="${path}"]`).dblclick();
	await page
		.locator('[data-app-id="textedit"]')
		.getByRole('button', { name: 'Show Markdown source' })
		.click();
	const editor = page.getByTestId('document-source');
	const revised = '# Welcome\n\nHuman edits and agent tools share this file.\n';
	await editor.fill(revised);
	await editor.blur();
	await expect(page.locator('[data-app-id="textedit"]')).toContainText('Saved');

	const readBack = (await callTool(page, 'files_read', { path })) as {
		structuredContent: { content: string };
	};
	expect(readBack.structuredContent.content).toBe(revised);
	expect(browserMessages).toEqual([]);
});

test('Terminal input creates a file that Finder can open', async ({ page }) => {
	const browserMessages = await openDesktop(page);
	await page.getByRole('button', { name: 'Launch Terminal app' }).click();
	const terminal = page.locator('[data-app-id="terminal"]');
	await expect(terminal.locator('.xterm-helper-textarea')).toBeAttached();

	const input = terminal.locator('.xterm-helper-textarea');
	await input.click();
	await input.pressSequentially(
		"printf '# Terminal note\\n\\nCreated in Bash.\\n' > terminal-note.md",
	);
	await input.press('Enter');

	await expect(page.locator('[data-path="/Projects/Launch/terminal-note.md"]')).toBeAttached();
	await page.getByRole('button', { name: 'Launch Finder app' }).click();
	await page.locator('[data-path="/Projects/Launch/terminal-note.md"]').dblclick();
	await page
		.locator('[data-app-id="textedit"]')
		.getByRole('button', { name: 'Show Markdown source' })
		.click();
	await expect(page.getByTestId('document-source')).toHaveValue(
		'# Terminal note\n\nCreated in Bash.\n',
	);
	expect(browserMessages).toEqual([]);
});

test('calculator computes, minimizes, restores, and closes', async ({ page }) => {
	const browserMessages = await openDesktop(page);
	const launchCalculator = page.getByRole('button', { name: 'Launch Calculator app' });

	await launchCalculator.click();
	const calculator = page.locator('[data-app-id="calculator"]');
	await expect(calculator).toBeVisible();
	await calculator.getByRole('button', { name: '7', exact: true }).click();
	await calculator.getByRole('button', { name: 'Add' }).click();
	await calculator.getByRole('button', { name: '8', exact: true }).click();
	await calculator.getByRole('button', { name: 'Equals' }).click();
	await expect(calculator.getByTestId('calculator-display')).toHaveText('15');

	await page.getByRole('button', { name: 'Minimize Calculator' }).click();
	await expect(calculator).toBeHidden();
	await launchCalculator.click();
	await expect(calculator).toBeVisible();
	await expect(calculator.getByTestId('calculator-display')).toHaveText('15');
	await page.getByRole('button', { name: 'Close Calculator' }).click();
	await expect(calculator).toBeHidden();
	expect(browserMessages).toEqual([]);
});

test('desktop remains usable at a compact viewport', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const browserMessages = await openDesktop(page);
	await expect(page.getByRole('button', { name: 'Finder', exact: true })).toBeVisible();
	await expect(page.locator('[data-path="/Projects/Launch/brief.md"]')).toBeVisible();

	const horizontalOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
	);
	expect(horizontalOverflow).toBe(false);
	expect(browserMessages).toEqual([]);
});

test('Finder human file management uses contained dialogs, keyboard, and drag and drop', async ({
	page,
}) => {
	const browserMessages = await openDesktop(page);
	const finder = page.locator('[data-app-id="finder"]');

	await finder.getByRole('button', { name: 'New folder' }).click();
	await expect(finder.getByRole('heading', { name: 'New folder' })).toBeVisible();
	await finder.getByLabel('Name').fill('QA Folder');
	await finder.getByRole('button', { name: 'Create' }).click();
	const folder = finder.locator('[data-path="/Projects/Launch/QA Folder"]');
	await expect(folder).toBeVisible();
	await expect(folder).toHaveAttribute('aria-selected', 'true');

	const brief = finder.locator('[data-path="/Projects/Launch/brief.md"]');
	await brief.dblclick();
	const textEdit = page.locator('[data-app-id="textedit"]');
	await expect(textEdit.getByTestId('document-editor')).toContainText('Launch brief');
	await page.getByRole('button', { name: 'Launch Finder app' }).click();
	await expect(finder).toHaveClass(/active/);
	await page.waitForTimeout(100);
	const briefBox = await brief.boundingBox();
	const folderBox = await folder.boundingBox();
	expect(briefBox).not.toBeNull();
	expect(folderBox).not.toBeNull();
	await page.mouse.move(briefBox!.x + 60, briefBox!.y + briefBox!.height / 2);
	await page.mouse.down();
	await page.mouse.move(folderBox!.x + 60, folderBox!.y + folderBox!.height / 2, { steps: 12 });
	await page.mouse.up();
	await expect(brief).toHaveCount(0);
	await expect(
		textEdit.locator('header [title="/Projects/Launch/QA Folder/brief.md"]'),
	).toBeVisible();
	await folder.dblclick();
	await expect(finder.locator('[data-path="/Projects/Launch/QA Folder/brief.md"]')).toBeVisible();

	const movedBrief = finder.locator('[data-path="/Projects/Launch/QA Folder/brief.md"]');
	await movedBrief.click({ button: 'right' });
	await expect(finder.locator('.item-menu').getByRole('button', { name: 'Rename…' })).toBeVisible();
	await expect(
		finder.locator('.item-menu').getByRole('button', { name: 'Move to Trash' }),
	).toBeVisible();
	await finder.locator('.item-menu').getByRole('button', { name: 'Duplicate' }).click();
	await expect(finder.locator('.item-menu')).toHaveCount(0);
	await expect(
		finder.locator('[data-path="/Projects/Launch/QA Folder/brief copy.md"]'),
	).toBeVisible();
	await movedBrief.click({ button: 'right' });
	await finder.locator('.item-menu').getByRole('button', { name: 'Open' }).click();
	await expect(finder.locator('.item-menu')).toHaveCount(0);
	await expect(textEdit).toHaveClass(/active/);
	await expect(page.getByRole('button', { name: 'Notepad', exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Launch Finder app' }).click();
	await movedBrief.focus();
	await movedBrief.press('Enter');
	await page
		.locator('[data-app-id="textedit"]')
		.getByRole('button', { name: 'Show Markdown source' })
		.click();
	await expect(page.getByTestId('document-source')).toHaveValue(/# Launch brief/);

	await page.getByRole('button', { name: 'Launch Finder app' }).click();
	const search = finder.getByRole('textbox', { name: 'Search this folder' });
	await search.fill('brief');
	await search.press('Escape');
	await expect(search).toHaveValue('');
	expect(browserMessages).toEqual([]);
});

test('content interactions do not drag windows and active menus execute real commands', async ({
	page,
}) => {
	const browserMessages = await openDesktop(page);
	await page.locator('[data-path="/Projects/Launch/todo.md"]').dblclick();
	const textEdit = page.locator('[data-app-id="textedit"]');
	await expect(page.getByRole('button', { name: 'Notepad', exact: true })).toBeVisible();
	const before = await textEdit.boundingBox();
	const editor = textEdit.getByTestId('document-editor');
	const editorBox = await editor.boundingBox();
	expect(before).not.toBeNull();
	expect(editorBox).not.toBeNull();
	await page.mouse.move(editorBox!.x + 35, editorBox!.y + 40);
	await page.mouse.down();
	await page.mouse.move(editorBox!.x + 180, editorBox!.y + 80, { steps: 8 });
	await page.mouse.up();
	const after = await textEdit.boundingBox();
	expect(after?.x).toBeCloseTo(before!.x, 0);
	expect(after?.y).toBeCloseTo(before!.y, 0);

	await page.getByRole('button', { name: 'Launch Calculator app' }).click();
	const calculator = page.locator('[data-app-id="calculator"]');
	await expect(calculator).toBeVisible();
	await expect(calculator).toHaveClass(/active/);
	await calculator.locator('[data-keyboard-root]').focus();
	await page.keyboard.press('7');
	await expect(calculator.getByTestId('calculator-display')).toHaveText('7');
	await page.keyboard.press('+');
	await page.keyboard.press('8');
	await expect(calculator.getByTestId('calculator-display')).toHaveText('8');
	await page.keyboard.press('Enter');
	await expect(calculator.getByTestId('calculator-display')).toHaveText('15');
	await page.getByRole('button', { name: 'File', exact: true }).click();
	await page.locator('.menu-parent').getByRole('button', { name: 'Clear', exact: true }).click();
	await expect(calculator.getByTestId('calculator-display')).toHaveText('0');

	await page.getByRole('button', { name: 'File', exact: true }).click();
	await page.keyboard.press('Escape');
	await expect(page.locator('.menu-parent')).toHaveCount(0);
	expect(browserMessages).toEqual([]);
});

test('Terminal history, Activity filtering, dock magnification, and compact reclamping work', async ({
	page,
}) => {
	const browserMessages = await openDesktop(page);
	const terminalLaunch = page.getByRole('button', { name: 'Launch Terminal app' });
	await terminalLaunch.click();
	const terminal = page.locator('[data-app-id="terminal"]');
	const input = terminal.locator('.xterm-helper-textarea');
	await input.click();
	await input.pressSequentially("printf 'history-check\\n'");
	await input.press('Enter');
	await expect(terminal.locator('.xterm-rows')).toContainText('history-check');
	await input.press('ArrowUp');
	await expect(terminal.locator('.xterm-rows')).toContainText("printf 'history-check\\n'");

	await page.getByRole('button', { name: 'Launch Activity app' }).click();
	const activity = page.locator('[data-app-id="activity"]');
	await activity.getByRole('button', { name: 'Terminal', exact: true }).click();
	await expect(activity.getByText('Command completed').first()).toBeVisible();
	await expect(activity.getByRole('button', { name: 'Terminal', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true',
	);

	const activityLaunch = page.getByRole('button', { name: 'Launch Activity app' });
	await activityLaunch.hover();
	await page.waitForTimeout(350);
	const iconBox = await activityLaunch.locator('img').boundingBox();
	expect(iconBox).not.toBeNull();
	expect(iconBox!.width).toBeGreaterThan(57);
	expect(iconBox!.x).toBeGreaterThanOrEqual(0);
	expect(iconBox!.x + iconBox!.width).toBeLessThanOrEqual(1440);

	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(100);
	const activityBox = await activity.boundingBox();
	expect(activityBox).not.toBeNull();
	expect(activityBox!.x).toBeGreaterThanOrEqual(0);
	expect(activityBox!.x + activityBox!.width).toBeLessThanOrEqual(390);
	const horizontalOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
	);
	expect(horizontalOverflow).toBe(false);
	expect(browserMessages).toEqual([]);
});

async function readNote(page: Page, path: string) {
	const result = (await callTool(page, 'files_read', { path })) as {
		structuredContent: { content?: string };
	};
	return result.structuredContent.content;
}

async function openNoteSource(page: Page, path: string) {
	await callTool(page, 'desktop_reveal', { path });
	const app = page.locator('[data-app-id="textedit"]');
	await expect(app.getByRole('button', { name: `Rename ${path.split('/').pop()}` })).toBeVisible();
	if (await app.getByRole('button', { name: 'Show Markdown source' }).isVisible()) {
		await app.getByRole('button', { name: 'Show Markdown source' }).click();
	}
	return app.getByTestId('document-source');
}

test('Notepad formats Markdown, preserves source on open, and supports undo and download', async ({
	page,
}) => {
	const errors = await openDesktop(page, true);
	const path = '/Notes/Field notes.md';
	const original =
		'# Field notes\n\nA **small** notebook.\n\n- [ ] Walk the route\n\n| Place | Time |\n| --- | --- |\n| River | 9:00 |\n';
	await callTool(page, 'files_write', { path, content: original });
	await callTool(page, 'desktop_reveal', { path });
	const app = page.locator('[data-app-id="textedit"]');
	const editor = app.getByTestId('document-editor');
	await expect(editor.getByRole('heading', { name: 'Field notes' })).toBeVisible();
	await expect(editor.locator('strong')).toHaveText('small');
	await expect(editor.getByRole('table')).toBeVisible();
	expect(await readNote(page, path)).toBe(original);
	const checkbox = editor.getByRole('checkbox', { name: 'Complete item' });
	await checkbox.click();
	await expect(checkbox).toBeChecked();
	await expect.poll(() => readNote(page, path)).toContain('[x] Walk the route');
	await checkbox.press('Space');
	await expect(checkbox).not.toBeChecked();
	await editor.fill('A good notebook');
	await editor.press('ControlOrMeta+a');
	await app.getByRole('button', { name: 'Text formatting', exact: true }).click();
	await app.getByRole('button', { name: 'Bold', exact: true }).click();
	await expect(editor.locator('strong')).toHaveText('A good notebook');
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(editor.locator('strong')).toHaveCount(0);
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await page.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(editor.locator('strong')).toHaveText('A good notebook');
	await expect.poll(() => readNote(page, path)).toContain('**A good notebook**');
	await app.getByRole('button', { name: 'Show Markdown source' }).click();
	await expect(app.getByTestId('document-source')).toHaveValue(/\*\*A good notebook\*\*/);
	const downloadPromise = page.waitForEvent('download');
	await app.getByRole('button', { name: 'More note actions' }).click();
	await app.getByRole('button', { name: 'Download note' }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('Field notes.md');
	const { readFile } = await import('node:fs/promises');
	expect(await readFile((await download.path())!, 'utf8')).toContain('**A good notebook**');
	expect(errors).toEqual([]);
});

test('Notepad keeps pending edits when an agent switches documents and the window closes', async ({
	page,
}) => {
	const errors = await openDesktop(page, true);
	const a = '/Notes/First.md';
	const b = '/Notes/Second.md';
	await callTool(page, 'files_write', { path: a, content: 'Original first' });
	await callTool(page, 'files_write', { path: b, content: 'Original second' });
	const source = await openNoteSource(page, a);
	await source.fill('First draft, before the autosave delay');
	await callTool(page, 'desktop_reveal', { path: b });
	await expect(source).toHaveValue('Original second');
	await source.fill('Second draft, just before close');
	await page.getByRole('button', { name: 'Close Notepad', exact: true }).click();
	await expect.poll(() => readNote(page, a)).toBe('First draft, before the autosave delay');
	await expect.poll(() => readNote(page, b)).toBe('Second draft, just before close');
	await page.getByRole('button', { name: 'Launch Notepad app' }).click();
	await expect(page.getByTestId('document-editor')).toContainText(
		'Second draft, just before close',
	);
	expect(errors).toEqual([]);
});

test('Notepad restores a checkpointed draft and the selected note after reload', async ({
	page,
}) => {
	await openDesktop(page, true);
	const path = '/Notes/Reload.md';
	await callTool(page, 'files_write', { path, content: 'Old content' });
	const source = await openNoteSource(page, path);
	await source.fill('A draft captured before the document autosave.');
	await expect
		.poll(async () => JSON.parse((await readNote(page, '/System/notepad.json')) ?? '{}').drafts)
		.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path,
					content: 'A draft captured before the document autosave.',
				}),
			]),
		);
	// If a checkpoint is still committing, the browser must protect it.
	page.on('dialog', (dialog) => {
		void dialog.dismiss();
	});
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: 'Launch Notepad app' }).click();
	await expect(page.getByRole('button', { name: 'Rename Reload.md' })).toBeVisible();
	await expect(page.getByTestId('document-editor')).toContainText(
		'A draft captured before the document autosave.',
	);
	await expect
		.poll(() => readNote(page, path))
		.toBe('A draft captured before the document autosave.');
});

test('Notepad preserves both versions of conflicting edits and recovers the draft after reload', async ({
	page,
}) => {
	const errors = await openDesktop(page, true);
	const path = '/Notes/Shared.md';
	await callTool(page, 'files_write', { path, content: 'Original version' });
	const source = await openNoteSource(page, path);
	await source.fill('Human draft that must not be lost');
	// The guarded file tools now settle or reject pending drafts. A Terminal
	// write still exercises recovery from an external edit to the shared file.
	await callTool(page, 'terminal_run', {
		command: "printf 'Agent version that must not be overwritten' > /Notes/Shared.md",
	});
	await expect(page.getByRole('status')).toContainText('This note changed elsewhere');
	await expect(source).toHaveValue('Human draft that must not be lost');
	expect(await readNote(page, path)).toBe('Agent version that must not be overwritten');
	await expect
		.poll(async () => JSON.parse((await readNote(page, '/System/notepad.json')) ?? '{}').drafts)
		.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path, content: 'Human draft that must not be lost' }),
			]),
		);
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: 'Launch Notepad app' }).click();
	await expect(page.getByRole('status')).toContainText('This note changed elsewhere');
	await expect(page.getByTestId('document-editor')).toContainText(
		'Human draft that must not be lost',
	);
	await page.getByRole('button', { name: 'Save a copy', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Rename Shared recovered.md' })).toBeVisible();
	expect(await readNote(page, '/Notes/Shared recovered.md')).toBe(
		'Human draft that must not be lost',
	);
	expect(await readNote(page, path)).toBe('Agent version that must not be overwritten');
	expect(errors).toEqual([]);
});

test('Notepad follows agent and Terminal renames while keeping pending edits', async ({ page }) => {
	const errors = await openDesktop(page, true);
	const path = '/Notes/Rename/original.md';
	await callTool(page, 'files_write', { path, content: 'Original' });
	const source = await openNoteSource(page, path);
	await source.fill('A draft during a rename');
	await callTool(page, 'files_move', { source: path, destination: '/Notes/Rename/renamed.md' });
	await expect(page.getByRole('button', { name: 'Rename renamed.md' })).toBeVisible();
	await expect
		.poll(() => readNote(page, '/Notes/Rename/renamed.md'))
		.toBe('A draft during a rename');
	await callTool(page, 'terminal_run', { command: 'mv /Notes/Rename /Notes/Moved' });
	await callTool(page, 'desktop_reveal', { target: 'textedit' });
	await expect(
		page.locator('[data-app-id="textedit"] header [title="/Notes/Moved/renamed.md"]'),
	).toBeVisible();
	await source.fill('Still writable after a Terminal move');
	await expect
		.poll(() => readNote(page, '/Notes/Moved/renamed.md'))
		.toBe('Still writable after a Terminal move');
	await callTool(page, 'files_trash', { path: '/Notes/Moved/renamed.md' });
	await expect(
		page.locator('[data-app-id="textedit"] header [title="/Trash/renamed.md"]'),
	).toBeVisible();
	expect(errors).toEqual([]);
});

test('Notepad creates, renames, searches and edits plain text at a compact viewport', async ({
	page,
}) => {
	const errors = await openDesktop(page, true);
	await page.getByRole('button', { name: 'Launch Notepad app' }).click();
	const app = page.locator('[data-app-id="textedit"]');
	await app.getByRole('button', { name: 'New note', exact: true }).click();
	await app.getByRole('button', { name: 'Rename Untitled.md' }).click();
	await app.getByRole('textbox', { name: 'Note name' }).fill('Sandstone');
	await app.getByRole('button', { name: 'Save name' }).click();
	await expect(app.getByRole('button', { name: 'Rename Sandstone.md' })).toBeVisible();
	await app.getByTestId('document-editor').fill('A small notebook for the walking route.');
	await expect.poll(() => readNote(page, '/Notes/Sandstone.md')).toContain('walking route');
	await app.getByRole('textbox', { name: 'Search notes' }).fill('walking route');
	await expect(app.getByRole('navigation', { name: 'Note list' }).getByRole('button')).toHaveCount(
		1,
	);
	await expect(app.getByRole('navigation', { name: 'Note list' })).toContainText('Sandstone');
	await callTool(page, 'files_write', {
		path: '/Notes/plain.txt',
		content: '# These are literal symbols\n**not rich text**',
	});
	await callTool(page, 'desktop_reveal', { path: '/Notes/plain.txt' });
	await expect(app.getByTestId('document-source')).toHaveValue(
		'# These are literal symbols\n**not rich text**',
	);
	await expect(app.getByRole('group', { name: 'Formatting' })).toHaveCount(0);
	await page.setViewportSize({ width: 390, height: 844 });
	await app.getByRole('button', { name: 'Hide notes' }).click();
	await expect(app.getByTestId('document-source')).toBeVisible();
	await callTool(page, 'desktop_reveal', { path: '/Notes/Sandstone.md' });
	await expect(app.getByTestId('document-editor')).toBeVisible();
	await expect(app.getByRole('button', { name: 'Text formatting', exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
	expect(errors).toEqual([]);
});

test('Notepad shares formatting between popovers, menus and shortcuts without losing selection', async ({
	page,
}) => {
	const errors = await openDesktop(page, true);
	const path = '/Notes/Style study.md';
	await callTool(page, 'files_write', { path, content: 'A walk by the river.\n' });
	await callTool(page, 'desktop_reveal', { path });
	const app = page.locator('[data-app-id="textedit"]');
	const editor = app.getByTestId('document-editor');
	await editor.click();
	await editor.press('ControlOrMeta+a');
	await page.getByRole('button', { name: 'Format', exact: true }).press('ArrowDown');
	await expect(page.getByRole('button', { name: 'Title', exact: true })).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(page.getByRole('button', { name: 'Heading', exact: true })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(editor.locator('h2')).toHaveText('A walk by the river.');
	await app.getByRole('button', { name: 'Text formatting', exact: true }).click();
	await expect(app.getByRole('button', { name: 'Heading', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	await page.keyboard.press('Escape');
	await expect(app.getByRole('button', { name: 'Text formatting', exact: true })).toBeFocused();
	await expect(app.locator('#notepad-format')).toBeHidden();
	await editor.press('ControlOrMeta+Alt+0');
	await expect(editor.locator('h2')).toHaveCount(0);
	await editor.press('ControlOrMeta+a');
	await editor.press('ControlOrMeta+k');
	await expect(app.getByRole('textbox', { name: 'Link URL' })).toBeFocused();
	await app.getByRole('textbox', { name: 'Link URL' }).fill('invalid');
	await app.getByRole('button', { name: 'Add Link', exact: true }).click();
	await expect(app.getByRole('alert')).toContainText('Use an https://');
	await app.getByRole('textbox', { name: 'Link URL' }).fill('https://example.com/river');
	await app.getByRole('button', { name: 'Add Link', exact: true }).click();
	await expect(editor.getByRole('link')).toHaveAttribute('href', 'https://example.com/river');
	await expect.poll(() => readNote(page, path)).toContain('https://example.com/river');
	await page.getByRole('button', { name: 'View', exact: true }).click();
	await page.getByRole('button', { name: 'Show Markdown Source', exact: true }).click();
	await expect(app.getByTestId('document-source')).toBeVisible();
	await page.getByRole('button', { name: 'Format', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
	await page.keyboard.press('Escape');
	expect(errors).toEqual([]);
});

test('Notepad groups notes by date and supports keyboard browsing, search and a narrow window', async ({
	page,
}) => {
	await page.clock.setFixedTime(new Date('2026-09-01T12:00:00Z'));
	const errors = await openDesktop(page, true);
	await callTool(page, 'files_write', { path: '/Notes/Yesterday.md', content: 'An older walk.\n' });
	await page.clock.setFixedTime(new Date('2026-09-02T12:00:00Z'));
	await callTool(page, 'files_write', { path: '/Notes/Today.md', content: 'A new walk.\n' });
	await callTool(page, 'desktop_reveal', { path: '/Notes/Today.md' });
	const app = page.locator('[data-app-id="textedit"]');
	const list = app.getByRole('navigation', { name: 'Note list' });
	await expect(list.locator('.date-heading')).toHaveText(['Today', 'Yesterday']);
	await app.getByTestId('document-editor').press('ControlOrMeta+Enter');
	const first = list.getByRole('button').first();
	await expect(first).toBeFocused();
	await first.press('ArrowDown');
	await expect(list.getByRole('button').nth(1)).toBeFocused();
	await list.getByRole('button').nth(1).press('Enter');
	await expect(app.getByTestId('document-editor')).toBeFocused();
	await app.getByTestId('document-editor').press('ControlOrMeta+Alt+f');
	await expect(app.getByRole('textbox', { name: 'Search notes' })).toBeFocused();
	await app.getByRole('textbox', { name: 'Search notes' }).fill('A new walk');
	await expect(list.getByRole('button')).toHaveCount(1);
	await app.getByRole('button', { name: 'Hide notes' }).click();
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await page.getByRole('button', { name: 'Find Notes', exact: true }).click();
	await expect(app.getByRole('textbox', { name: 'Search notes' })).toBeFocused();
	// Resize only the application, keeping the desktop viewport wide.
	await app.evaluate((element) => {
		(element as HTMLElement).style.width = '390px';
	});
	await expect(app.getByTestId('document-editor')).toBeHidden();
	await list.getByRole('button').first().click();
	await expect(app.getByTestId('document-editor')).toBeVisible();
	await app.getByRole('button', { name: 'Text formatting', exact: true }).click();
	const popup = app.locator('#notepad-format');
	await expect(popup).toBeVisible();
	const bounds = await popup.boundingBox();
	expect(bounds!.x).toBeGreaterThanOrEqual(0);
	expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1440);
	await page.keyboard.press('Escape');
	expect(errors).toEqual([]);
});
