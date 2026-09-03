import { expect, test, type Page } from '@playwright/test';

async function captureStartup(page: Page, disableLocks = false) {
	await page.addInitScript((disableLocks) => {
		const tools: Record<string, any> = {};
		const openedDatabases: string[] = [];
		Object.assign(window, { __ownershipTools: tools, __openedDatabases: openedDatabases });
		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			value: { registerTool: (tool: any) => (tools[tool.name] = tool) },
		});
		const open = IDBFactory.prototype.open;
		IDBFactory.prototype.open = function (...args: Parameters<typeof open>) {
			openedDatabases.push(args[0]);
			return Reflect.apply(open, this, args);
		};
		if (disableLocks) Object.defineProperty(navigator, 'locks', { value: undefined });
	}, disableLocks);
}

async function ready(page: Page) {
	await page.waitForFunction(() => Boolean((window as any).__ownershipTools.files_write));
}

async function ok(page: Page, name: string, input: Record<string, unknown> = {}) {
	const result = await page.evaluate(
		async ({ name, input }) =>
			(await (window as any).__ownershipTools[name].execute(input)).structuredContent,
		{ name, input },
	);
	expect(result.ok, JSON.stringify(result)).toBe(true);
	return result;
}

test('only one tab mounts the workspace, and closing it preserves distinct files and drafts', async ({
	page: owner,
	context,
}) => {
	await captureStartup(owner);
	await owner.clock.install({ time: new Date('2026-09-03T08:00:00Z') });
	await owner.goto('/');
	await ready(owner);
	const first = '/Documents/First artifact.txt';
	const second = '/Documents/Second artifact.txt';
	const third = '/Documents/Third artifact.txt';
	const draft = '/Notes/Recovered draft.txt';
	await ok(owner, 'files_write', { path: first, content: 'First artifact.', createOnly: true });

	const next = await context.newPage();
	await captureStartup(next);
	const errors: string[] = [];
	next.on('pageerror', (error) => errors.push(error.message));
	await next.goto('/');
	await expect(
		next.getByRole('heading', { name: 'This workspace is open in another tab.', exact: true }),
	).toBeVisible();
	await expect(next.getByText('Close that tab, then reload here.', { exact: true })).toBeVisible();
	expect(await next.evaluate(() => Object.keys((window as any).__ownershipTools))).toEqual([]);
	expect(await next.evaluate(() => (window as any).__openedDatabases)).toEqual([]);
	const blockedWrite = await next.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		try {
			await workspaceService.writeText('/Documents/Blocked.txt', 'Must not be saved.');
			return 'unexpected success';
		} catch (error) {
			return (error as { code: string }).code;
		}
	});
	expect(blockedWrite).toBe('WORKSPACE_IN_USE');
	expect(await next.evaluate(() => (window as any).__openedDatabases)).toEqual([]);

	// The owner keeps writing after the other tab has tried to mount. Without
	// ownership, both instances can allocate the same inode for unrelated paths.
	await ok(owner, 'files_write', { path: second, content: 'Second artifact.', createOnly: true });
	await ok(owner, 'files_write', { path: draft, content: 'Before the draft.', createOnly: true });
	await ok(owner, 'desktop_reveal', { path: draft });
	await owner.clock.pauseAt(new Date('2026-09-03T09:00:00Z'));
	await owner.getByTestId('document-source').fill('Recovered unsaved draft.');
	await expect
		.poll(() =>
			owner.evaluate(async () => {
				const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
				return JSON.parse(await workspaceService.readText('/System/notepad.json')).drafts;
			}),
		)
		.toContainEqual(expect.objectContaining({ path: draft, content: 'Recovered unsaved draft.' }));
	expect((await ok(owner, 'files_read', { path: draft })).content).toBe('Before the draft.');
	await owner.close();

	await next.getByRole('button', { name: 'Reload', exact: true }).click();
	await ready(next);
	expect((await ok(next, 'files_read', { path: first })).content).toBe('First artifact.');
	expect((await ok(next, 'files_read', { path: second })).content).toBe('Second artifact.');
	await expect
		.poll(async () => (await ok(next, 'files_read', { path: draft })).content)
		.toBe('Recovered unsaved draft.');
	expect((await ok(next, 'notes_get_context')).path).toBe(draft);
	await ok(next, 'files_write', { path: third, content: 'Third artifact.', createOnly: true });
	await next.reload();
	await ready(next);
	for (const [path, content] of [
		[first, 'First artifact.'],
		[second, 'Second artifact.'],
		[third, 'Third artifact.'],
		[draft, 'Recovered unsaved draft.'],
	])
		expect((await ok(next, 'files_read', { path })).content).toBe(content);
	expect(
		await next.evaluate(async () => {
			const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
			return workspaceService.exists('/Documents/Blocked.txt');
		}),
	).toBe(false);
	expect(errors).toEqual([]);
});

test('a browser without Web Locks stops before opening IndexedDB or registering tools', async ({
	page,
}) => {
	await captureStartup(page, true);
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('/');
	await expect(
		page.getByRole('heading', { name: 'This browser cannot protect the saved workspace.' }),
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
	expect(await page.evaluate(() => Object.keys((window as any).__ownershipTools))).toEqual([]);
	expect(await page.evaluate(() => (window as any).__openedDatabases)).toEqual([]);
	expect(errors).toEqual([]);
});
