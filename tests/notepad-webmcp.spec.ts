import { expect, test, type Page } from '@playwright/test';

async function call(page: Page, name: string, input: Record<string, unknown> = {}) {
	return page.evaluate(
		async ({ name, input }) => {
			const result = await (window as any).__noteTools[name].execute(input, {
				signal: new AbortController().signal,
			});
			return result.structuredContent;
		},
		{ name, input },
	);
}

test.beforeEach(async ({ page }) => {
	await page.clock.install({ time: new Date('2026-09-03T08:00:00Z') });
	await page.addInitScript(() => {
		const tools: Record<string, unknown> = {};
		(window as any).__noteTools = tools;
		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			value: {
				registerTool: (tool: any) => {
					tools[tool.name] = tool;
				},
			},
		});
	});
	await page.goto('/');
	await expect
		.poll(() => page.evaluate(() => Boolean((window as any).__noteTools.desktop_reveal)))
		.toBe(true);
});

async function open(page: Page, path: string, content: string) {
	const created = await call(page, 'files_write', { path, content, createOnly: true });
	expect(created.ok).toBe(true);
	const revealed = await call(page, 'desktop_reveal', { path });
	expect(revealed).toMatchObject({ ok: true, editorReady: true });
	return created;
}

test('creates and opens a ready editor, reports current context, and prevents accidental overwrites', async ({
	page,
}) => {
	const path = '/Notes/Ready.md';
	const content = '# Ready\n\nThe agent and person share this note.\n';
	expect(await call(page, 'notes_get_context')).toMatchObject({ isOpen: false, selection: null });
	const created = await open(page, path, content);
	// Read the DOM immediately, without an auto-waiting assertion. Tool success
	// must mean Milkdown has mounted and rendered the requested document.
	expect(await page.getByTestId('document-editor').innerText()).toContain('The agent and person');
	const context = await call(page, 'notes_get_context');
	expect(context).toMatchObject({
		path,
		content,
		revision: created.revision,
		saveStatus: 'saved',
		editorReady: true,
		isFocused: true,
	});
	const partial = await call(page, 'files_read', { path, maxLines: 1 });
	expect(partial).toMatchObject({
		content: '# Ready',
		truncated: true,
		revision: created.revision,
	});
	expect(await call(page, 'notes_get_context', { maxChars: 5 })).toMatchObject({
		content: '# Rea',
		truncated: true,
		revision: created.revision,
	});
	expect(
		await call(page, 'files_write', { path, content: 'Oops', createOnly: true }),
	).toMatchObject({ ok: false, error: { code: 'PATH_EXISTS' } });
	expect(await call(page, 'files_write', { path, content: 'Oops' })).toMatchObject({
		ok: false,
		error: { code: 'REVISION_REQUIRED' },
	});
	expect(
		await call(page, 'files_write', { path, content: 'Oops', expectedRevision: 'invalid' }),
	).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
	expect((await call(page, 'files_read', { path })).content).toBe(content);
	const app = page.locator('[data-app-id="textedit"]');
	await app.evaluate((element) => {
		(element as HTMLElement).style.width = '390px';
	});
	await expect(page.getByTestId('document-editor')).toBeHidden();
	expect(await call(page, 'notes_get_context')).toMatchObject({
		editorReady: true,
		editorVisible: false,
	});
	expect(await call(page, 'desktop_reveal', { path })).toMatchObject({
		ok: true,
		editorReady: true,
	});
	expect(await page.getByTestId('document-editor').isVisible()).toBe(true);

	const plain = '/Notes/Plain.txt';
	await open(page, plain, 'An ordinary text note.');
	expect(await page.getByTestId('document-source').inputValue()).toBe('An ordinary text note.');
	expect(await call(page, 'notes_get_context')).toMatchObject({
		path: plain,
		mode: 'plain',
		selection: null,
	});
	await page.getByRole('button', { name: 'Close Notepad', exact: true }).click();
	expect(await call(page, 'notes_get_context')).toMatchObject({
		path: plain,
		isOpen: false,
		editorReady: false,
		selection: null,
	});
});

test('identifies a formatted selection among repeated passages and edits only its paragraph', async ({
	page,
}) => {
	const path = '/Notes/Selection.md';
	const content = '# North\n\nTake the **long** route.\n\n# South\n\nTake the **long** route.\n';
	await open(page, path, content);
	const editor = page.getByTestId('document-editor');
	await editor
		.locator('p')
		.nth(1)
		.evaluate((paragraph) => {
			const range = document.createRange();
			range.selectNodeContents(paragraph);
			const selection = window.getSelection()!;
			selection.removeAllRanges();
			selection.addRange(range);
			(paragraph.closest('[contenteditable]') as HTMLElement).focus();
			document.dispatchEvent(new Event('selectionchange'));
		});
	await expect
		.poll(async () => (await call(page, 'notes_get_context')).selection?.text)
		.toBe('Take the long route.');
	const context = await call(page, 'notes_get_context');
	expect(context.selection.before).toContain('South');
	expect(context.content).toBe(content);
	const ambiguous = await call(page, 'files_patch', {
		path,
		find: 'Take the **long** route.',
		replace: 'Walk.',
		expectedRevision: context.revision,
	});
	expect(ambiguous).toMatchObject({ ok: false, error: { code: 'MATCH_COUNT_MISMATCH' } });
	const patched = await call(page, 'files_patch', {
		path,
		find: '# South\n\nTake the **long** route.',
		replace: '# South\n\nWalk.',
		expectedRevision: context.revision,
	});
	expect(patched).toMatchObject({
		ok: true,
		replacements: 1,
		saved: true,
		displayed: true,
		note: { saveStatus: 'saved', hasUnsavedChanges: false },
	});
	expect(await editor.locator('p').allTextContents()).toEqual(['Take the long route.', 'Walk.']);
	expect(await editor.locator('strong').textContent()).toBe('long');
	expect((await call(page, 'files_read', { path })).content).toBe(
		content.replace('# South\n\nTake the **long** route.', '# South\n\nWalk.'),
	);
	expect((await call(page, 'notes_get_context')).selection).toBeNull();
	const activity = await call(page, 'activity_list', { limit: 10 });
	expect(activity.entries).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ actor: 'agent', path, action: 'Document edited' }),
		]),
	);
});

test('returns the unsaved source selection and saves that draft before a guarded patch', async ({
	page,
}) => {
	const path = '/Notes/Draft.md';
	await open(page, path, 'Original\n');
	await page.getByRole('button', { name: 'Show Markdown source' }).click();
	await page.clock.pauseAt(new Date('2026-09-03T09:00:00Z'));
	const source = page.getByTestId('document-source');
	const draft = '# Walk\n\nHuman introduction.\n\n- [ ] Follow the river\n';
	await source.fill(draft);
	await source.evaluate((node: HTMLTextAreaElement) => {
		const start = node.value.indexOf('Human introduction.');
		node.setSelectionRange(start, start + 'Human introduction.'.length);
	});
	const context = await call(page, 'notes_get_context');
	expect(context).toMatchObject({
		content: draft,
		saveStatus: 'edited',
		hasUnsavedChanges: true,
		mode: 'markdown',
		selection: { text: 'Human introduction.', sourceStart: 8, sourceEnd: 27 },
	});
	expect((await call(page, 'files_read', { path })).content).toBe('Original\n');
	const patched = await call(page, 'files_patch', {
		path,
		find: '- [ ] Follow the river',
		replace: '- [x] Follow the river',
		expectedRevision: context.revision,
	});
	expect(patched).toMatchObject({
		ok: true,
		displayed: true,
		note: { saveStatus: 'saved', hasUnsavedChanges: false },
	});
	expect(await source.inputValue()).toBe(draft.replace('[ ]', '[x]'));
	expect((await call(page, 'files_read', { path })).revision).toBe(patched.revision);
	await page.clock.resume();
	await page.reload();
	await expect
		.poll(() => page.evaluate(() => Boolean((window as any).__noteTools.notes_get_context)))
		.toBe(true);
	expect(await call(page, 'notes_get_context')).toMatchObject({
		path,
		content: draft.replace('[ ]', '[x]'),
		revision: patched.revision,
		saveStatus: 'saved',
	});
});

test('rejects stale replacements and patches after human typing, then accepts a fresh edit', async ({
	page,
}) => {
	const path = '/Notes/Concurrent.md';
	const original = await open(page, path, 'Original introduction.\n\n- [ ] Review\n');
	await page.getByRole('button', { name: 'Show Markdown source' }).click();
	await page.clock.pauseAt(new Date('2026-09-03T09:00:00Z'));
	const source = page.getByTestId('document-source');
	const human = 'Human introduction.\n\n- [ ] Review\n';
	await source.fill(human);
	expect(
		await call(page, 'files_write', {
			path,
			content: 'Outdated replacement',
			expectedRevision: original.revision,
		}),
	).toMatchObject({ ok: false, error: { code: 'FILE_CHANGED' } });
	expect(
		await call(page, 'files_patch', {
			path,
			find: '[ ] Review',
			replace: '[x] Review',
			expectedRevision: original.revision,
		}),
	).toMatchObject({ ok: false, error: { code: 'FILE_CHANGED' } });
	expect(await source.inputValue()).toBe(human);
	const fresh = await call(page, 'notes_get_context');
	const updated = `${fresh.content}\nAgent follow-up.\n`;
	expect(
		await call(page, 'files_write', { path, content: updated, expectedRevision: fresh.revision }),
	).toMatchObject({ ok: true, created: false, displayed: true });
	expect(await source.inputValue()).toBe(updated);
});

test('serializes competing guarded writes and refuses unresolved drafts from external edits', async ({
	page,
}) => {
	const path = '/Notes/Race.md';
	const original = await open(page, path, 'First version.\n');
	const writes = await Promise.all([
		call(page, 'files_write', {
			path,
			content: 'Writer one.\n',
			expectedRevision: original.revision,
		}),
		call(page, 'files_write', {
			path,
			content: 'Writer two.\n',
			expectedRevision: original.revision,
		}),
	]);
	expect(writes.filter((result) => result.ok)).toHaveLength(1);
	expect(writes.find((result) => !result.ok).error.code).toBe('FILE_CHANGED');
	await page.getByRole('button', { name: 'Show Markdown source' }).click();
	await page.clock.pauseAt(new Date('2026-09-03T09:00:00Z'));
	await page.getByTestId('document-source').fill('Human draft.\n');
	await call(page, 'terminal_run', { command: "printf 'Terminal version.\\n' > /Notes/Race.md" });
	const draft = await call(page, 'notes_get_context');
	expect(draft).toMatchObject({
		content: 'Human draft.\n',
		saveStatus: 'conflict',
		hasUnsavedChanges: true,
	});
	const disk = await call(page, 'files_read', { path });
	expect(
		await call(page, 'files_write', {
			path,
			content: 'Agent replacement.\n',
			expectedRevision: disk.revision,
		}),
	).toMatchObject({ ok: false, error: { code: 'NOTE_DRAFT_CONFLICT' } });
	expect((await call(page, 'files_read', { path })).content).toBe('Terminal version.\n');
	expect(await page.getByTestId('document-source').inputValue()).toBe('Human draft.\n');
});

test('reports a newer visible draft honestly when typing arrives during the storage commit', async ({
	page,
}) => {
	const path = '/Notes/Commit.md';
	const original = await open(page, path, 'Original.\n');
	await page.getByRole('button', { name: 'Show Markdown source' }).click();
	await page.clock.pauseAt(new Date('2026-09-03T09:00:00Z'));
	// Hold the notification after the real file write. Human input can arrive
	// after persistence succeeds but before the editor has accepted the change.
	await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const refresh = workspaceService.refresh.bind(workspaceService);
		workspaceService.refresh = async () => {
			workspaceService.refresh = refresh;
			await new Promise<void>((resolve) => {
				(window as any).__releaseNoteCommit = resolve;
			});
			return refresh();
		};
	});
	const writing = call(page, 'files_write', {
		path,
		content: 'Saved by the agent.\n',
		expectedRevision: original.revision,
	});
	await expect
		.poll(() => page.evaluate(() => Boolean((window as any).__releaseNoteCommit)))
		.toBe(true);
	await page.getByTestId('document-source').fill('A newer human draft.\n');
	await page.evaluate(() => (window as any).__releaseNoteCommit());
	expect(await writing).toMatchObject({
		ok: true,
		saved: true,
		displayed: false,
		note: { saveStatus: 'conflict', hasUnsavedChanges: true },
	});
	expect((await call(page, 'files_read', { path })).content).toBe('Saved by the agent.\n');
	expect(await page.getByTestId('document-source').inputValue()).toBe('A newer human draft.\n');
});

test('keeps human and external edits separately undoable and redoable', async ({ page }) => {
	const path = '/Notes/Undo history.md';
	await open(page, path, 'Original sentence.\n');
	const editor = page.getByTestId('document-editor');
	await editor.fill('Human revision.');
	const context = await call(page, 'notes_get_context');
	expect(
		await call(page, 'files_patch', {
			path,
			find: 'Human revision.',
			replace: 'Human revision. Agent addition.',
			expectedRevision: context.revision,
		}),
	).toMatchObject({ ok: true, saved: true, displayed: true });
	await expect(editor).toHaveText('Human revision. Agent addition.');

	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(editor).toHaveText('Human revision.');
	await editor.press('ControlOrMeta+z');
	await expect(editor).toHaveText('Original sentence.');
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
	await page.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(editor).toHaveText('Human revision.');
	await editor.press('ControlOrMeta+Shift+z');
	await expect(editor).toHaveText('Human revision. Agent addition.');

	await editor.fill('Human revision. Agent addition. Human follow-up.');
	await editor.press('ControlOrMeta+z');
	await expect(editor).toHaveText('Human revision. Agent addition.');
	await editor.press('ControlOrMeta+z');
	await expect(editor).toHaveText('Human revision.');
	await expect
		.poll(async () => (await call(page, 'files_read', { path })).content)
		.toBe('Human revision.\n');
	// A different note must never inherit this note's undo history.
	await open(page, '/Notes/Separate history.md', 'Another note.\n');
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('visibly renders bold and italic from agent Markdown', async ({ page }) => {
	await open(page, '/Notes/Visible formatting.md', 'Plain **bold** *italic* and ***both***.\n');
	const editor = page.getByTestId('document-editor');
	await expect(editor.locator('strong').first()).toHaveCSS('font-weight', '700');
	await expect(editor.locator('em').first()).toHaveCSS('font-style', 'italic');
	const both = editor.getByText('both', { exact: true });
	await expect(both).toHaveCSS('font-weight', '700');
	await expect(both).toHaveCSS('font-style', 'italic');
	await editor.press('ControlOrMeta+a');
	await editor.press('ControlOrMeta+b');
	await expect(editor.locator('strong')).toHaveCount(0);
	await editor.press('ControlOrMeta+b');
	await expect(editor.locator('strong').first()).toHaveCSS('font-weight', '700');
});

test('excludes Trash from broad searches and respects explicit folder boundaries', async ({
	page,
}) => {
	const query = 'route-search-marker';
	await open(page, '/Notes/Route.md', query);
	await call(page, 'files_write', { path: '/Notes Archive/Old.md', content: query });
	await call(page, 'files_write', { path: '/Notes/Discarded.md', content: query });
	const trashed = await call(page, 'files_trash', { path: '/Notes/Discarded.md' });
	const broad = await call(page, 'files_search', { query });
	expect(broad.includeTrash).toBe(false);
	expect(broad.results.map((entry: any) => entry.path).sort()).toEqual([
		'/Notes Archive/Old.md',
		'/Notes/Route.md',
	]);
	const scoped = await call(page, 'files_search', { query, path: '/Notes' });
	expect(scoped.results.map((entry: any) => entry.path)).toEqual(['/Notes/Route.md']);
	const all = await call(page, 'files_search', { query, includeTrash: true });
	expect(all.results.map((entry: any) => entry.path)).toContain(trashed.trashPath);
	expect((await call(page, 'files_search', { query, path: '/Trash' })).results).toEqual([]);
	const trash = await call(page, 'files_search', { query, path: '/Trash', includeTrash: true });
	expect(trash.results.map((entry: any) => entry.path)).toEqual([trashed.trashPath]);
	expect(await call(page, 'files_search', { query, includeTrash: 'yes' })).toMatchObject({
		ok: false,
		error: { code: 'INVALID_INPUT' },
	});
	await call(page, 'desktop_reveal', { path: '/Trash', target: 'finder' });
	const finder = page.locator('[data-app-id="finder"]');
	await finder.getByRole('textbox', { name: 'Search this folder' }).fill(query);
	await expect(finder.getByRole('option')).toHaveCount(1);
	await expect(finder.getByRole('option')).toContainText('Discarded.md');
});

test('keeps compact Notepad menus clear of the system controls and clock', async ({ page }) => {
	await open(page, '/Notes/Compact menus.md', 'A small notebook.\n');
	const clock = page.getByLabel('Current date and time');
	const bar = page.locator('header').filter({ has: clock });
	for (const width of [320, 390, 560, 561, 700, 701, 768, 1280]) {
		await page.setViewportSize({ width, height: 844 });
		if (width <= 700) await expect(clock).toBeHidden();
		else await expect(clock).toBeVisible();
		const bounds = await bar.evaluate((element) =>
			[...element.querySelectorAll('button, .time')]
				.map((node) => node.getBoundingClientRect())
				.filter((rect) => rect.width && rect.height)
				.map(({ x, y, width, height }) => ({ x, y, width, height })),
		);
		for (let index = 0; index < bounds.length; index++) {
			expect(bounds[index].x).toBeGreaterThanOrEqual(
				index ? bounds[index - 1].x + bounds[index - 1].width : 0,
			);
			expect(bounds[index].x + bounds[index].width).toBeLessThanOrEqual(width);
			expect(bounds[index].y + bounds[index].height).toBeLessThanOrEqual(30);
		}
	}
});
