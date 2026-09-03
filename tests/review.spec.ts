import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
	await page.addInitScript(() => {
		const tools: Record<string, any> = {};
		Object.defineProperty(window, '__reviewTools', { value: tools });
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
	await page.waitForFunction(() => Boolean((window as any).__reviewTools.review_restore));
}
async function call(page: Page, name: string, input: Record<string, unknown> = {}) {
	return page.evaluate(
		async ({ name, input }) =>
			(window as any).__reviewTools[name].execute(input, { signal: new AbortController().signal }),
		{ name, input },
	);
}
async function ok(page: Page, name: string, input: Record<string, unknown> = {}) {
	const result = await call(page, name, input);
	expect(result.structuredContent.ok, JSON.stringify(result)).toBe(true);
	return result.structuredContent;
}
async function change(page: Page, path = '/Documents/Review.md') {
	const initial = await ok(page, 'files_write', {
		path,
		content: '# Project handoff\n\nBudget: 1200\nOwner: undecided\n',
		createOnly: true,
	});
	const saved = await ok(page, 'files_patch', {
		path,
		find: 'Budget: 1200',
		replace: 'Budget: 1800',
		expectedRevision: initial.revision,
	});
	expect(saved.entry.versionId).toBeTruthy();
	return { path, initial, saved, id: saved.entry.versionId as string };
}

test('real before/after diff, revision-checked restore, retained redo and persistence', async ({
	page,
}) => {
	await setup(page);
	const { path, id } = await change(page);
	const view = (await ok(page, 'review_read', { versionId: id })).review;
	expect(view.canRestore, JSON.stringify(view)).toBe(true);
	expect(
		view.diff.lines.filter((l: any) => l.kind === 'removed').map((l: any) => l.text),
	).toContain('Budget: 1200');
	expect(view.diff.lines.filter((l: any) => l.kind === 'added').map((l: any) => l.text)).toContain(
		'Budget: 1800',
	);
	const activity = (await ok(page, 'activity_list', { limit: 100 })).entries;
	expect(activity.find((e: any) => e.versionId === id)?.path).toBe(path);
	const restored = await ok(page, 'review_restore', {
		versionId: id,
		mode: 'replace',
		expectedCurrentToken: view.current.token,
	});
	expect(restored.versionId).toBeTruthy();
	expect((await ok(page, 'files_read', { path })).content).toContain('Budget: 1200');
	const redo = (await ok(page, 'review_read', { versionId: restored.versionId })).review;
	expect(redo.canRestore).toBe(true);
	await ok(page, 'review_restore', {
		versionId: restored.versionId,
		mode: 'replace',
		expectedCurrentToken: redo.current.token,
	});
	expect((await ok(page, 'files_read', { path })).content).toContain('Budget: 1800');
	await page.reload();
	await page.waitForFunction(() => Boolean((window as any).__reviewTools.review_read));
	expect((await ok(page, 'review_read', { versionId: id })).review.version.before.revision).toBe(
		view.version.before.revision,
	);
	expect((await ok(page, 'review_list', { path })).versions.length).toBe(4);
});

test('later terminal changes block overwrite, safe copy preserves both, and commands are not undo claims', async ({
	page,
}) => {
	await setup(page);
	const { path, id } = await change(page);
	const view = (await ok(page, 'review_read', { versionId: id })).review;
	await ok(page, 'terminal_run', { command: `printf 'Later human work\\n' > '${path}'` });
	const denied = await call(page, 'review_restore', {
		versionId: id,
		mode: 'replace',
		expectedCurrentToken: view.current.token,
	});
	expect(denied.structuredContent.error.code).toBe('RESTORE_CONFLICT');
	expect((await ok(page, 'files_read', { path })).content).toBe('Later human work\n');
	const latest = (await ok(page, 'review_read', { versionId: id })).review;
	expect(latest.canRestore).toBe(false);
	await ok(page, 'review_restore', {
		versionId: id,
		mode: 'copy',
		destination: latest.suggestedCopy,
	});
	expect((await ok(page, 'files_read', { path: latest.suggestedCopy })).content).toContain(
		'Budget: 1200',
	);
	expect(
		(
			await call(page, 'review_restore', {
				versionId: id,
				mode: 'copy',
				destination: latest.suggestedCopy,
			})
		).structuredContent.error.code,
	).toBe('PATH_EXISTS');
	expect((await ok(page, 'review_list', { path })).versions.length).toBe(2);
	const commands = (await ok(page, 'activity_list', { limit: 100 })).entries.filter((e: any) =>
		e.action.startsWith('Command'),
	);
	expect(commands.length).toBeGreaterThan(0);
	expect(commands.every((e: any) => !e.versionId)).toBe(true);
});

test('a saved snapshot can be copied while its current-file metadata refreshes', async ({
	page,
}) => {
	await setup(page);
	const { path } = await change(page);
	await ok(page, 'desktop_reveal', { target: 'activity' });
	const activity = page.locator('[data-app-id="activity"]');
	await activity
		.getByTestId('activity-list')
		.locator('article')
		.filter({ hasText: 'Replaced 1 passage' })
		.getByRole('button', { name: 'Review change', exact: true })
		.click();
	const restoreCopy = activity.getByRole('button', { name: 'Restore as Copy', exact: true });
	await expect(restoreCopy).toBeEnabled();
	const destination = '/Documents/Review during refresh.md';
	await activity
		.getByRole('textbox', { name: 'New workspace path', exact: true })
		.fill(destination);
	await activity.getByRole('combobox', { name: 'Snapshot', exact: true }).selectOption('after');
	await page.evaluate(async () => {
		const { reviewService } = await import('/src/lib/activity/review.ts');
		const read = reviewService.read;
		reviewService.read = async (...args) => {
			reviewService.read = read;
			await new Promise<void>((resolve) => {
				Object.assign(window, { releaseReviewRead: resolve });
			});
			return read(...args);
		};
	});
	try {
		await ok(page, 'files_write', {
			path: '/Documents/Unrelated.md',
			content: 'Another file changed.',
			createOnly: true,
		});
		await page.waitForFunction(() => 'releaseReviewRead' in window);
		await expect(activity.locator('.scroll')).toHaveAttribute('aria-busy', 'true');
		await expect(
			activity.getByRole('button', { name: 'Restore Previous Version…', exact: true }),
		).toBeDisabled();
		await expect(restoreCopy).toBeEnabled();
		await restoreCopy.click();
		await expect(
			activity.getByRole('button', { name: 'Open Review during refresh.md', exact: true }),
		).toBeVisible();
		expect((await ok(page, 'files_read', { path: destination })).content).toContain('Budget: 1800');
		expect((await ok(page, 'files_read', { path })).content).toContain('Budget: 1800');
	} finally {
		await page.evaluate(() =>
			(window as unknown as { releaseReviewRead?: () => void }).releaseReviewRead?.(),
		);
	}
});

test('explicit work sessions retain outcome links, questions and activity after reload, and reject stale edits', async ({
	page,
}) => {
	await setup(page);
	const { path, id } = await change(page);
	const activity = (await ok(page, 'activity_list', { limit: 100 })).entries.find(
		(e: any) => e.versionId === id,
	);
	const input = {
		title: 'Prepare project handoff',
		status: 'working',
		summary: '',
		questions: [],
		results: [],
		versionIds: [],
		activityIds: [],
	};
	const started = (await ok(page, 'review_session', input)).session;
	const complete = {
		...input,
		id: started.id,
		expectedRevision: started.revision,
		status: 'completed',
		summary: 'Updated the budget and prepared the report.',
		questions: ['Who will approve the budget?', 'Who owns delivery?'],
		results: [path],
		versionIds: [id],
		activityIds: [activity.id],
	};
	const saved = (await ok(page, 'review_session', complete)).session;
	expect(saved.revision).toBe(2);
	expect((await call(page, 'review_session', complete)).structuredContent.error.code).toBe(
		'SESSION_CHANGED',
	);
	await page.reload();
	await page.waitForFunction(() => Boolean((window as any).__reviewTools.review_list));
	const session = (await ok(page, 'review_list')).sessions[0];
	expect(session).toMatchObject({
		id: started.id,
		status: 'completed',
		versionIds: [id],
		results: [path],
		questions: complete.questions,
	});
	expect(session.activities[0].id).toBe(activity.id);
	await ok(page, 'desktop_reveal', { target: 'activity' });
	await page
		.locator('[data-app-id="activity"]')
		.getByRole('button', { name: 'Review', exact: true })
		.click();
	await expect(page.locator('[data-app-id="activity"]')).toContainText('Prepare project handoff');
});

test('new-file recovery, binary byte integrity, corrupt snapshots, and malformed inputs', async ({
	page,
}) => {
	await setup(page);
	const created = await ok(page, 'files_write', {
		path: '/Documents/New.md',
		content: 'First version',
		createOnly: true,
	});
	const view = (await ok(page, 'review_read', { versionId: created.entry.versionId })).review;
	expect(view.canRestore).toBe(false);
	await ok(page, 'review_restore', {
		versionId: created.entry.versionId,
		mode: 'copy',
		side: 'after',
		destination: '/Documents/New copy.md',
	});
	const binary = await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		await workspaceService.writeBytes('/Documents/Binary.pdf', new Uint8Array([0, 255, 12, 3]));
		return workspaceService.writeBytes('/Documents/Binary.pdf', new Uint8Array([0, 255, 12, 4]));
	});
	const binview = (await ok(page, 'review_read', { versionId: binary.versionId })).review;
	expect(binview.diff).toBeNull();
	await ok(page, 'review_restore', {
		versionId: binary.versionId,
		mode: 'replace',
		expectedCurrentToken: binview.current.token,
	});
	expect(
		await page.evaluate(async () => {
			const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
			return Array.from(await workspaceService.readBytes('/Documents/Binary.pdf'));
		}),
	).toEqual([0, 255, 12, 3]);
	await page.evaluate(async (id) => {
		const { zenfs } = await import('/src/lib/workspace/workspace.ts');
		await zenfs.promises.writeFile(
			`/System/review/versions/${id}/before.bin`,
			new Uint8Array([99]),
		);
	}, binary.versionId);
	expect(
		(
			await call(page, 'review_restore', {
				versionId: binary.versionId,
				mode: 'copy',
				destination: '/Documents/Binary copy.pdf',
			})
		).structuredContent.error.code,
	).toBe('REVIEW_CORRUPT');
	expect(
		(await call(page, 'review_read', { versionId: '../../Notes/Ideas.md' })).structuredContent.error
			.code,
	).toBe('INVALID_INPUT');
	expect(
		(
			await call(page, 'review_restore', {
				versionId: created.entry.versionId,
				mode: 'copy',
				side: 'after',
				destination: '/System/unsafe.md',
			})
		).structuredContent.error.code,
	).toBe('PROTECTED_PATH');
});

test('pending Notepad drafts block in-place restore and survive restoring a copy', async ({
	page,
}) => {
	await setup(page);
	const { path, id } = await change(page);
	await ok(page, 'desktop_reveal', { path });
	await page.evaluate(
		async ({ path }) => {
			const { notepadService } = await import('/src/lib/workspace/notepad.ts');
			const note = notepadService.getNote(path)!;
			// Set an unresolved draft without scheduling autosave, exercising the real guard.
			note.content = 'Unsaved draft';
			note.status = 'conflict';
		},
		{ path },
	);
	const view = (await ok(page, 'review_read', { versionId: id })).review;
	expect(view.canRestore).toBe(false);
	expect(view.blocked).toContain('Notepad');
	expect(
		(
			await call(page, 'review_restore', {
				versionId: id,
				mode: 'replace',
				expectedCurrentToken: view.current.token,
			})
		).structuredContent.error.code,
	).toBe('OPEN_DRAFT');
	await ok(page, 'review_restore', {
		versionId: id,
		mode: 'copy',
		destination: '/Documents/Safe copy.md',
	});
	expect(
		await page.evaluate(
			async ({ path }) => {
				const { notepadService } = await import('/src/lib/workspace/notepad.ts');
				return notepadService.getNote(path)?.content;
			},
			{ path },
		),
	).toBe('Unsaved draft');
});

test('missing original and concurrent restore cannot erase newer work', async ({ page }) => {
	await setup(page);
	const { path, id } = await change(page);
	const view = (await ok(page, 'review_read', { versionId: id })).review;
	const results = await Promise.all([
		call(page, 'review_restore', {
			versionId: id,
			mode: 'replace',
			expectedCurrentToken: view.current.token,
		}),
		call(page, 'review_restore', {
			versionId: id,
			mode: 'replace',
			expectedCurrentToken: view.current.token,
		}),
	]);
	expect(results.filter((r) => r.structuredContent.ok)).toHaveLength(1);
	expect(
		results.filter((r) => r.structuredContent.error?.code === 'RESTORE_CONFLICT'),
	).toHaveLength(1);
	await ok(page, 'files_trash', { path });
	expect((await ok(page, 'review_read', { versionId: id })).review.canRestore).toBe(false);
	await ok(page, 'review_restore', {
		versionId: id,
		mode: 'copy',
		destination: '/Documents/Recovered.md',
	});
	expect((await ok(page, 'files_read', { path: '/Documents/Recovered.md' })).content).toContain(
		'Budget: 1200',
	);
});

test('quiet System writes are excluded, oversized versions say no recovery, and snapshot preparation failure leaves source unchanged', async ({
	page,
}) => {
	await setup(page);
	const result = await page.evaluate(async () => {
		const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
		await workspaceService.writeText('/System/review-test.json', '{}', { quiet: true });
		const large = await workspaceService.writeBytes(
			'/Documents/Large.bin',
			new Uint8Array(5 * 1024 * 1024 + 1),
		);
		await workspaceService.writeText('/Documents/Protected.md', 'Keep this');
		// Make the journal directory temporarily unwritable using real FS state.
		await zenfs.promises.rename('/System/review/versions', '/System/review/held-versions');
		await zenfs.promises.writeFile('/System/review/versions', 'not a directory');
		let error = '';
		try {
			await workspaceService.writeText('/Documents/Protected.md', 'Must not replace');
		} catch (e) {
			error = String(e);
		} finally {
			await zenfs.promises.unlink('/System/review/versions');
			await zenfs.promises.rename('/System/review/held-versions', '/System/review/versions');
		}
		return { large, error, content: await workspaceService.readText('/Documents/Protected.md') };
	});
	expect(result.content).toBe('Keep this');
	expect(result.error).toMatch(/ENOTDIR|EEXIST/);
	expect(result.large.recoveryWarning).toContain('5 MiB');
	const data = await ok(page, 'review_list');
	expect(data.versions.some((v: any) => v.path.startsWith('/System/'))).toBe(false);
	expect(
		(await ok(page, 'review_read', { versionId: result.large.versionId })).review.canRestore,
	).toBe(false);
});

test('real Writer and Calc save recoverable bytes and require closing before replacement', async ({
	page,
}) => {
	test.setTimeout(180_000);
	await setup(page);
	const doc = '/Documents/Versioned.odt';
	await ok(page, 'documents_create', {
		path: doc,
		blocks: [{ type: 'paragraph', text: 'Original recommendation' }],
	});
	const before = (await ok(page, 'documents_read', { path: doc })).document;
	await ok(page, 'documents_edit', {
		path: doc,
		expectedRevision: before.revision,
		operation: {
			type: 'replace',
			find: 'Original recommendation',
			replace: 'Revised recommendation',
		},
	});
	const docVersion = (await ok(page, 'review_list', { path: doc })).versions.find(
		(v: any) => v.before,
	);
	const loaded = (await ok(page, 'review_read', { versionId: docVersion.id })).review;
	expect(loaded.blocked).toContain('Documents');
	await page.getByRole('button', { name: 'Close Documents', exact: true }).click();
	await expect(page.locator('[data-app-id="documents"]')).toHaveCount(0);
	const closed = (await ok(page, 'review_read', { versionId: docVersion.id })).review;
	expect(closed.canRestore, JSON.stringify(closed)).toBe(true);
	await ok(page, 'review_restore', {
		versionId: docVersion.id,
		mode: 'replace',
		expectedCurrentToken: closed.current.token,
	});
	expect((await ok(page, 'documents_read', { path: doc })).document.text).toContain(
		'Original recommendation',
	);
	await page.getByRole('button', { name: 'Close Documents', exact: true }).click();
	await expect(page.locator('[data-app-id="documents"]')).toHaveCount(0);
	const sheet = '/Documents/Versioned.ods';
	await ok(page, 'sheets_create', {
		path: sheet,
		sheets: [
			{
				name: 'Budget',
				values: [
					['Attendance', 'Cost'],
					[100, { formula: '=A2*12' }],
				],
			},
		],
	});
	const workbook = (await ok(page, 'sheets_read', { path: sheet, range: 'A1:B2' })).workbook;
	await ok(page, 'sheets_edit', {
		path: sheet,
		expectedRevision: workbook.revision,
		operation: { type: 'cells', range: 'A2', values: [[150]] },
	});
	const sheetVersion = (await ok(page, 'review_list', { path: sheet })).versions.find(
		(v: any) => v.before,
	);
	expect((await ok(page, 'review_read', { versionId: sheetVersion.id })).review.blocked).toContain(
		'Sheets',
	);
	await page.getByRole('button', { name: 'Close Sheets', exact: true }).click();
	await expect(page.locator('[data-app-id="sheets"]')).toHaveCount(0);
	const sheetClosed = (await ok(page, 'review_read', { versionId: sheetVersion.id })).review;
	await ok(page, 'review_restore', {
		versionId: sheetVersion.id,
		mode: 'replace',
		expectedCurrentToken: sheetClosed.current.token,
	});
	const restored = (await ok(page, 'sheets_read', { path: sheet, range: 'A1:B2' })).workbook;
	expect(restored.cells[1][0].value).toBe(100);
	expect(restored.cells[1][1]).toMatchObject({ formula: '=A2*12', value: 1200 });
});

test('rolling history is bounded, journal contents stay out of search, and large text uses excerpts', async ({
	page,
}) => {
	test.setTimeout(90_000);
	await setup(page);
	const versions = await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		for (let i = 0; i < 102; i++)
			await workspaceService.writeText('/Documents/Rolling.md', `Revision ${i}`);
		const { reviewService } = await import('/src/lib/activity/review.ts');
		return reviewService.list();
	});
	expect(versions.versions).toHaveLength(100);
	expect(versions.warnings).toEqual([]);
	const search = await ok(page, 'files_search', { query: 'Revision 0' });
	expect(JSON.stringify(search)).not.toContain('before.bin');
	const first = await ok(page, 'files_write', {
		path: '/Documents/Long.md',
		content: 'one\n'.repeat(1500),
		createOnly: true,
	});
	const next = await ok(page, 'files_write', {
		path: '/Documents/Long.md',
		content: 'two\n'.repeat(1500),
		expectedRevision: first.revision,
	});
	const view = (await ok(page, 'review_read', { versionId: next.entry.versionId })).review;
	expect(view.diff.mode).toBe('excerpts');
	expect(view.diff.truncated).toBe(true);
});

test('cancelling a queued restore leaves the file alone', async ({ page }) => {
	await setup(page);
	const { path, id } = await change(page);
	const view = (await ok(page, 'review_read', { versionId: id })).review;
	const cancelled = await page.evaluate(
		async ({ id, token }) => {
			const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
			let release!: () => void;
			const gate = new Promise<void>((resolve) => (release = resolve));
			const holding = workspaceService.mutate(() => gate);
			const controller = new AbortController();
			const operation = (window as any).__reviewTools.review_restore
				.execute(
					{ versionId: id, mode: 'replace', expectedCurrentToken: token },
					{ signal: controller.signal },
				)
				.then(
					() => false,
					() => true,
				);
			controller.abort();
			release();
			await holding;
			return operation;
		},
		{ id, token: view.current.token },
	);
	expect(cancelled).toBe(true);
	expect((await ok(page, 'files_read', { path })).content).toContain('Budget: 1800');
});

for (const viewport of [
	{ width: 1280, height: 800 },
	{ width: 390, height: 844 },
	{ width: 640, height: 360 },
]) {
	test(`human Activity links, summaries, diff, and restore controls at ${viewport.width}x${viewport.height}`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await setup(page);
		const { path, id } = await change(page);
		await ok(page, 'desktop_reveal', { target: 'activity' });
		const activity = page.locator('[data-app-id="activity"]');
		const entry = activity
			.getByTestId('activity-list')
			.locator('article')
			.filter({ hasText: 'Replaced 1 passage' });
		await entry.getByRole('button', { name: path, exact: true }).click();
		await expect(page.locator('[data-app-id="textedit"]')).toBeVisible();
		expect((await ok(page, 'notes_get_context')).path).toBe(path);
		await ok(page, 'desktop_reveal', { target: 'activity' });
		await entry.getByRole('button', { name: 'Review change', exact: true }).click();
		await expect(activity.getByRole('table')).toContainText('Budget: 1800');
		await expect(activity.getByRole('table')).toContainText('Budget: 1200');
		await activity.getByRole('button', { name: 'New Summary…', exact: true }).click();
		const form = activity.getByRole('dialog', { name: 'New work summary' });
		await form.getByRole('textbox', { name: 'Title', exact: true }).fill('Budget ready for review');
		await form
			.getByRole('textbox', { name: 'What changed', exact: true })
			.fill('Updated the attendance budget. Please review the changed amount.');
		await form
			.getByRole('textbox', { name: /Open questions/ })
			.fill('Who approves this budget?\nWho owns delivery?');
		await form.getByRole('button', { name: 'Save Summary', exact: true }).click();
		await expect(form).toHaveCount(0);
		await expect(
			activity.getByRole('heading', { name: 'Budget ready for review', exact: true }),
		).toBeVisible();
		await expect(activity).toContainText('Who approves this budget?');
		await activity.getByRole('button', { name: 'Edit Summary…', exact: true }).click();
		await activity
			.getByRole('dialog')
			.getByRole('textbox', { name: 'What changed', exact: true })
			.fill('Reviewed with the team; budget still needs approval.');
		await activity
			.getByRole('dialog')
			.getByRole('button', { name: 'Save Summary', exact: true })
			.click();
		await expect(activity.getByRole('dialog')).toHaveCount(0);
		const summary = (await ok(page, 'review_list')).sessions[0];
		expect(summary).toMatchObject({
			revision: 2,
			actor: 'human',
			results: [path],
			versionIds: [id],
		});
		await activity.getByRole('button', { name: /^Review\.md ·/ }).click();
		await expect(
			activity.getByRole('button', { name: 'Restore Previous Version…', exact: true }),
		).toBeEnabled();
		await activity.getByRole('button', { name: 'Restore Previous Version…', exact: true }).click();
		await activity.getByRole('button', { name: 'Restore in Place', exact: true }).click();
		await expect(activity.getByRole('status')).toContainText('Restored successfully');
		expect((await ok(page, 'files_read', { path })).content).toContain('Budget: 1200');
		await activity
			.getByRole('textbox', { name: 'New workspace path', exact: true })
			.fill('/Documents/Review copy.md');
		await activity.getByRole('combobox', { name: 'Snapshot', exact: true }).selectOption('after');
		await activity.getByRole('button', { name: 'Restore as Copy', exact: true }).click();
		await expect(
			activity.getByRole('button', { name: 'Open Review copy.md', exact: true }),
		).toBeVisible();
		expect((await ok(page, 'files_read', { path: '/Documents/Review copy.md' })).content).toContain(
			'Budget: 1800',
		);
		await activity.getByRole('button', { name: '‹ All reviews', exact: true }).click();
		await activity.getByRole('button', { name: /^Budget ready for review/ }).click();
		await activity.screenshot({ path: `/tmp/webmcp-review-${viewport.width}.png` });
		const bounds = await activity.boundingBox();
		expect(bounds!.x).toBeGreaterThanOrEqual(0);
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
		expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
		expect(errors).toEqual([]);
	});
}
