import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
	await page.goto('/');
});

test('Terminal preserves the working directory, exports, unsets, and exact command results', async ({
	page,
}) => {
	const result = await page.evaluate(async () => {
		const { terminalService } = await import('/src/lib/terminal/terminal.ts');
		await terminalService.run('export REPORT_MODE=ready; cd /Documents');
		const failed = await terminalService.run(
			'printf "%s|%s" "$REPORT_MODE" "$PWD"; printf "warning\\n" >&2; false',
		);
		await terminalService.run('unset REPORT_MODE USER');
		const unset = await terminalService.run(
			'printf "%s|%s" "${REPORT_MODE-unset}" "${USER-unset}"',
		);
		const exited = await terminalService.run('printf "before exit"; exit 7');
		return { failed, unset, exited, cwd: terminalService.cwd };
	});
	expect(result.failed).toMatchObject({
		stdout: 'ready|/Documents',
		stderr: 'warning\n',
		exitCode: 1,
		status: 'failed',
	});
	expect(result.unset.stdout).toBe('unset|unset');
	expect(result.exited).toMatchObject({
		stdout: 'before exit',
		stderr: '',
		exitCode: 7,
		status: 'failed',
	});
	expect(result.cwd).toBe('/Documents');
});

test('file transfers reject missing, overlapping, and protected endpoints before changing files', async ({
	page,
}) => {
	const result = await page.evaluate(async () => {
		const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
		await workspaceService.writeText('/Documents/Folder/keep.md', 'Keep this file');
		await zenfs.promises.link('/Documents/Folder/keep.md', '/Documents/alias.md');
		await workspaceService.createDirectory('/Trash');
		const failures: string[] = [];
		for (const operation of ['move', 'copy'] as const) {
			for (const [source, destination] of [
				['/Documents/Missing.md', '/Documents/Folder/keep.md'],
				['/Documents/Folder/keep.md', '/Documents/Folder/./keep.md'],
				['/Documents/Folder/keep.md', '/Documents/alias.md'],
				['/Documents/Folder/keep.md', '/Documents/Folder'],
				['/Documents/Folder', '/Documents/Folder/Nested'],
				...['/', '/System', '/Trash'].flatMap((path) => [
					['/Documents/Folder/keep.md', path],
					[path, '/Documents/Replacement'],
				]),
			]) {
				try {
					await workspaceService[operation](source, destination, { overwrite: true });
					failures.push('unexpected success');
				} catch (error) {
					failures.push(String(error));
				}
			}
		}
		return {
			failures,
			content: await workspaceService.readText('/Documents/Folder/keep.md'),
			nested: await workspaceService.exists('/Documents/Folder/Nested'),
		};
	});
	expect(result.failures).toHaveLength(22);
	expect(result.failures).not.toContain('unexpected success');
	expect(result.content).toBe('Keep this file');
	expect(result.nested).toBe(false);
});

test('file and folder replacements finish completely and retain displaced folders in Trash', async ({
	page,
}) => {
	const result = await page.evaluate(async () => {
		const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
		await workspaceService.writeText('/Documents/source.md', 'New contents');
		await workspaceService.writeText('/Documents/target.md', 'Old contents');
		await zenfs.promises.link('/Documents/target.md', '/Documents/other-name.md');
		await workspaceService.copy('/Documents/source.md', '/Documents/target.md', {
			overwrite: true,
		});
		const copied = await workspaceService.readText('/Documents/target.md');
		await workspaceService.move('/Documents/source.md', '/Documents/target.md', {
			overwrite: true,
		});
		await workspaceService.writeText('/Documents/Source/nested/new.md', 'New folder');
		await workspaceService.writeText('/Documents/Target/old.md', 'Old folder');
		await zenfs.promises.symlink('/Documents/missing', '/Trash/Target');
		await workspaceService.copy('/Documents/Source', '/Documents/Target', { overwrite: true });
		return {
			copied,
			alias: await workspaceService.readText('/Documents/other-name.md'),
			sourceExists: await workspaceService.exists('/Documents/source.md'),
			folder: await workspaceService.readText('/Documents/Target/nested/new.md'),
			oldExists: await workspaceService.exists('/Documents/Target/old.md'),
			retained: await workspaceService.readText('/Trash/Target 2/old.md'),
			trashLink: await zenfs.promises.readlink('/Trash/Target'),
		};
	});
	expect(result).toEqual({
		copied: 'New contents',
		alias: 'Old contents',
		sourceExists: false,
		folder: 'New folder',
		oldExists: false,
		retained: 'Old folder',
		trashLink: '/Documents/missing',
	});
});

test('failed recursive copies settle all branches and preserve the existing destination', async ({
	page,
}) => {
	const result = await page.evaluate(async () => {
		const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
		await workspaceService.writeText('/Documents/Source/fail.md', 'New first file');
		await workspaceService.writeText('/Documents/Source/slow.md', 'New second file');
		await workspaceService.writeText('/Documents/Target/keep.md', 'Original destination');
		const handle = await zenfs.promises.open('/Documents/Source/fail.md', 'r');
		const filesystem = handle.vfs.fs;
		await handle.close();
		const write = filesystem.write.bind(filesystem);
		let slowFinished = false,
			error = '';
		filesystem.write = async (path, data, offset) => {
			if (path.startsWith('/System/.copy-') && path.endsWith('/slow.md')) {
				await new Promise((resolve) => setTimeout(resolve, 40));
				await write(path, data, offset);
				slowFinished = true;
				return;
			}
			await write(path, data, offset);
			if (path.startsWith('/System/.copy-') && path.endsWith('/fail.md'))
				throw new Error('Simulated copy failure after writing one file');
		};
		try {
			await workspaceService.copy('/Documents/Source', '/Documents/Target', { overwrite: true });
		} catch (cause) {
			error = String(cause);
		} finally {
			filesystem.write = write;
		}
		return {
			error,
			slowFinished,
			content: await workspaceService.readText('/Documents/Target/keep.md'),
			entries: (await workspaceService.list('/Documents/Target')).map((entry) => entry.name),
			stages: (await zenfs.promises.readdir('/System')).filter((name) => name.startsWith('.copy-')),
		};
	});
	expect(result.error).toContain('Simulated copy failure');
	expect(result.slowFinished).toBe(true);
	expect(result.content).toBe('Original destination');
	expect(result.entries).toEqual(['keep.md']);
	expect(result.stages).toEqual([]);
});

test('failed folder promotion restores the original destination and leaves the source intact', async ({
	page,
}) => {
	const result = await page.evaluate(async () => {
		const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
		await workspaceService.writeText('/Documents/Source/new.md', 'Source contents');
		await workspaceService.writeText('/Documents/Target/keep.md', 'Original destination');
		const handle = await zenfs.promises.open('/Documents/Source/new.md', 'r');
		const filesystem = handle.vfs.fs;
		await handle.close();
		const rename = filesystem.rename.bind(filesystem);
		filesystem.rename = async (source, destination) => {
			if (source === '/Documents/Source' && destination === '/Documents/Target')
				throw new Error('Simulated rename failure');
			return rename(source, destination);
		};
		let error = '';
		try {
			await workspaceService.move('/Documents/Source', '/Documents/Target', { overwrite: true });
		} catch (cause) {
			error = String(cause);
		} finally {
			filesystem.rename = rename;
		}
		return {
			error,
			source: await workspaceService.readText('/Documents/Source/new.md'),
			destination: await workspaceService.readText('/Documents/Target/keep.md'),
		};
	});
	expect(result).toEqual({
		error: 'Error: Simulated rename failure',
		source: 'Source contents',
		destination: 'Original destination',
	});
});

test('the Terminal adapter preserves regular and dangling symbolic link directory entries', async ({
	page,
}) => {
	const result = await page.evaluate(async () => {
		const { terminalService } = await import('/src/lib/terminal/terminal.ts');
		await terminalService.run(
			'mkdir -p /Documents/Links; printf target > /Documents/Links/target; ln -s target /Documents/Links/alias; ln -s missing /Documents/Links/dangling',
		);
		const { WorkspaceFileSystem } = await import('/src/lib/workspace/just-bash-filesystem.ts');
		return new WorkspaceFileSystem().readdirWithFileTypes('/Documents/Links');
	});
	expect(result.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
		{ name: 'alias', isFile: false, isDirectory: false, isSymbolicLink: true },
		{ name: 'dangling', isFile: false, isDirectory: false, isSymbolicLink: true },
		{ name: 'target', isFile: true, isDirectory: false, isSymbolicLink: false },
	]);
});

test('shell moves preserve other hardlink names and copies keep ordinary inode and directory semantics', async ({
	page,
}) => {
	const result = await page.evaluate(async () => {
		const { terminalService } = await import('/src/lib/terminal/terminal.ts');
		const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
		const { WorkspaceFileSystem } = await import('/src/lib/workspace/just-bash-filesystem.ts');
		const setup = await terminalService.run(
			'mkdir -p /Documents/ShellLinks; cd /Documents/ShellLinks; printf keep > original; ln original original-link; printf new > source; printf old > target; ln target target-link',
		);
		const same = await terminalService.run('mv original original-link');
		const sameCopy = await terminalService.run('cp original original-link');
		const moved = await terminalService.run('mv source target');
		const copied = await terminalService.run(
			'printf prior > copied; ln copied copied-link; cp target copied',
		);
		const merged = await terminalService.run(
			'mkdir -p tree/nested destination/tree; printf added > tree/nested/new.md; printf retained > destination/tree/keep.md; cp -r tree destination',
		);
		let nonrecursive = '';
		try {
			await new WorkspaceFileSystem().cp('/Documents/ShellLinks/tree', '/Documents/NoRecursive');
		} catch (error) {
			nonrecursive = String(error);
		}
		const files: Record<string, string> = {};
		for (const path of [
			'original',
			'original-link',
			'target',
			'target-link',
			'copied',
			'copied-link',
			'destination/tree/keep.md',
			'destination/tree/nested/new.md',
		])
			files[path] = await workspaceService.readText(`/Documents/ShellLinks/${path}`);
		return {
			statuses: [setup, same, moved, copied, merged].map((job) => job.exitCode),
			sameCopy: sameCopy.exitCode,
			sourceExists: await workspaceService.exists('/Documents/ShellLinks/source'),
			files,
			nonrecursive,
			leftovers: (await zenfs.promises.readdir('/Documents/ShellLinks')).filter((name) =>
				name.startsWith('.move-'),
			),
		};
	});
	expect(result.statuses).toEqual([0, 0, 0, 0, 0]);
	expect(result.sameCopy).toBe(1);
	expect(result.sourceExists).toBe(false);
	expect(result.files).toEqual({
		original: 'keep',
		'original-link': 'keep',
		target: 'new',
		'target-link': 'old',
		copied: 'new',
		'copied-link': 'new',
		'destination/tree/keep.md': 'retained',
		'destination/tree/nested/new.md': 'added',
	});
	expect(result.nonrecursive).toContain('EISDIR');
	expect(result.leftovers).toEqual([]);
});

test('a failed shell move restores its linked destination and cleans the backup', async ({
	page,
}) => {
	const result = await page.evaluate(async () => {
		const { terminalService } = await import('/src/lib/terminal/terminal.ts');
		const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
		await terminalService.run(
			'mkdir -p /Documents/ShellRollback; cd /Documents/ShellRollback; printf new > source; printf old > target; ln target alias',
		);
		const handle = await zenfs.promises.open('/Documents/ShellRollback/source', 'r');
		const filesystem = handle.vfs.fs;
		await handle.close();
		const rename = filesystem.rename.bind(filesystem);
		filesystem.rename = async (source, destination) => {
			if (
				source === '/Documents/ShellRollback/source' &&
				destination === '/Documents/ShellRollback/target'
			)
				throw new Error('Simulated shell promotion failure');
			return rename(source, destination);
		};
		let job;
		try {
			job = await terminalService.run('mv source target');
		} finally {
			filesystem.rename = rename;
		}
		return {
			exitCode: job.exitCode,
			stderr: job.stderr,
			source: await workspaceService.readText('/Documents/ShellRollback/source'),
			target: await workspaceService.readText('/Documents/ShellRollback/target'),
			alias: await workspaceService.readText('/Documents/ShellRollback/alias'),
			leftovers: (await zenfs.promises.readdir('/Documents/ShellRollback')).filter((name) =>
				name.startsWith('.move-'),
			),
		};
	});
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain('Simulated shell promotion failure');
	expect(result).toMatchObject({ source: 'new', target: 'old', alias: 'old', leftovers: [] });
});

test('a failed shell rollback retains the destination at its reported recovery path', async ({
	page,
}) => {
	const result = await page.evaluate(async () => {
		const { terminalService } = await import('/src/lib/terminal/terminal.ts');
		const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
		await terminalService.run(
			'mkdir -p /Documents/ShellRecovery; cd /Documents/ShellRecovery; printf new > source; printf old > target; ln target alias',
		);
		const handle = await zenfs.promises.open('/Documents/ShellRecovery/source', 'r');
		const filesystem = handle.vfs.fs;
		await handle.close();
		const rename = filesystem.rename.bind(filesystem);
		filesystem.rename = async (source, destination) => {
			if (destination === '/Documents/ShellRecovery/target')
				throw new Error('Simulated rename failure');
			return rename(source, destination);
		};
		let job;
		try {
			job = await terminalService.run('mv source target');
		} finally {
			filesystem.rename = rename;
		}
		const backup = (await zenfs.promises.readdir('/Documents/ShellRecovery')).find((name) =>
			name.startsWith('.move-'),
		)!;
		const recoveryPath = `/Documents/ShellRecovery/${backup}`;
		return {
			exitCode: job.exitCode,
			stderr: job.stderr,
			recoveryPath,
			recovered: await workspaceService.readText(recoveryPath),
			source: await workspaceService.readText('/Documents/ShellRecovery/source'),
			alias: await workspaceService.readText('/Documents/ShellRecovery/alias'),
		};
	});
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain(result.recoveryPath);
	expect(result).toMatchObject({ source: 'new', alias: 'old', recovered: 'old' });
});

test('failed shell copies drain sibling writes before releasing the workspace queue', async ({
	page,
}) => {
	const result = await page.evaluate(async () => {
		const { terminalService } = await import('/src/lib/terminal/terminal.ts');
		const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
		await terminalService.run(
			'mkdir -p /Documents/ShellCopy/source /Documents/ShellCopy/destination; cd /Documents/ShellCopy; printf first > source/fail.md; printf second > source/slow.md',
		);
		const handle = await zenfs.promises.open('/Documents/ShellCopy/source/fail.md', 'r');
		const filesystem = handle.vfs.fs;
		await handle.close();
		const write = filesystem.write.bind(filesystem);
		let release!: () => void,
			started!: () => void,
			slowFinished = false,
			nextWritten = false;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const slowStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		filesystem.write = async (path, data, offset) => {
			if (path === '/Documents/ShellCopy/destination/source/slow.md') {
				started();
				await gate;
				await write(path, data, offset);
				slowFinished = true;
				return;
			}
			await write(path, data, offset);
			if (path === '/Documents/ShellCopy/destination/source/fail.md')
				throw new Error('Simulated shell copy failure');
		};
		try {
			const copying = terminalService.run('cp -r source destination');
			await slowStarted;
			const next = workspaceService
				.writeText('/Documents/After shell copy.md', 'Next write')
				.then(() => {
					nextWritten = true;
				});
			await new Promise((resolve) => setTimeout(resolve, 20));
			const queueReleasedEarly = nextWritten;
			release();
			const job = await copying;
			const finishedAtReturn = slowFinished;
			await next;
			return {
				exitCode: job.exitCode,
				stderr: job.stderr,
				queueReleasedEarly,
				finishedAtReturn,
				partial: await workspaceService.readText('/Documents/ShellCopy/destination/source/slow.md'),
			};
		} finally {
			release();
			filesystem.write = write;
		}
	});
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain('Simulated shell copy failure');
	expect(result).toMatchObject({
		queueReleasedEarly: false,
		finishedAtReturn: true,
		partial: 'second',
	});
});

test('invalid review timestamps and snapshot sizes leave valid history and summaries available', async ({
	page,
}) => {
	const result = await page.evaluate(async () => {
		const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
		const { reviewService } = await import('/src/lib/activity/review.ts');
		const entries = [];
		for (const content of ['first', 'second', 'third'])
			entries.push(await workspaceService.writeText('/Documents/History.md', content));
		for (const [entry, change] of [
			[entries[0], { createdAt: 42 }],
			[entries[1], { after: { size: -1 } }],
		] as const) {
			const path = `/System/review/versions/${entry.versionId}/version.json`;
			const data = JSON.parse(await zenfs.promises.readFile(path, 'utf8'));
			if ('after' in change) data.after.size = change.after.size;
			else data.createdAt = change.createdAt;
			await zenfs.promises.writeFile(path, JSON.stringify(data));
		}
		const input = {
			title: 'Valid summary',
			status: 'working' as const,
			summary: '',
			questions: [],
			results: [],
			versionIds: [],
			activityIds: [],
		};
		await reviewService.session(input);
		const broken = await reviewService.session({ ...input, title: 'Broken summary' });
		const path = `/System/review/sessions/${broken.id}.json`;
		await zenfs.promises.writeFile(
			path,
			JSON.stringify({ ...broken, updatedAt: 'not a timestamp' }),
		);
		const data = await reviewService.list();
		return {
			versions: data.versions.map((version) => version.id),
			expected: entries[2].versionId,
			sessions: data.sessions.map((session) => session.title),
			warnings: data.warnings,
			brokenPreserved: JSON.parse(await zenfs.promises.readFile(path, 'utf8')).updatedAt,
		};
	});
	expect(result.versions).toEqual([result.expected]);
	expect(result.sessions).toEqual(['Valid summary']);
	expect(result.warnings).toHaveLength(3);
	expect(result.brokenPreserved).toBe('not a timestamp');
});
