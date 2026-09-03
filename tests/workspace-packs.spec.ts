import { expect, test } from '@playwright/test';

type PackEntry = { kind: 'directory'; path: string } | { kind: 'file'; path: string; data: string };

function manifest(entries: PackEntry[], overrides: Record<string, unknown> = {}) {
	return JSON.stringify({
		format: 'webmcp-desktop-pack',
		version: 1,
		createdAt: '2026-09-03T10:00:00.000Z',
		entries,
		omitted: ['/System', '/Trash', '*.desktop-pack.json'],
		...overrides,
	});
}

function file(path: string, content = 'Imported content'): PackEntry {
	return { kind: 'file', path, data: Buffer.from(content).toString('base64') };
}

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		await workspaceService.ready();
	});
});

test('exports binary files and empty folders, imports in a fresh workspace, and survives reload', async ({
	page,
	browser,
	baseURL,
}) => {
	const exported = await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const { packService } = await import('/src/lib/packs/packs.ts');
		await workspaceService.writeBytes(
			'/Projects/Pack fixture/bytes.bin',
			new Uint8Array([0, 1, 127, 128, 254, 255]),
		);
		await workspaceService.writeText('/Projects/Pack fixture/日本語.md', 'Research notes — বাংলা');
		await workspaceService.writeText('/Projects/Pack fixture/empty.txt', '');
		await workspaceService.createDirectory('/Projects/Pack fixture/Empty/Nested');
		await workspaceService.writeText('/Trash/retired.md', 'Do not include trash');
		await workspaceService.writeText('/System/private.txt', 'Do not include internal state');
		await workspaceService.writeText('/Documents/older.desktop-pack.json', 'Old export');
		const result = await packService.exportPack({});
		return { result, text: await workspaceService.readText(result.path) };
	});
	const pack = JSON.parse(exported.text);
	expect(exported.result.path).toMatch(/^\/Exports\/workspace-.+\.desktop-pack\.json$/);
	expect(pack).toMatchObject({ format: 'webmcp-desktop-pack', version: 1 });
	expect(pack.entries).toEqual(
		expect.arrayContaining([
			{ kind: 'file', path: '/Projects/Pack fixture/bytes.bin', data: 'AAF/gP7/' },
			{ kind: 'file', path: '/Projects/Pack fixture/empty.txt', data: '' },
			{ kind: 'directory', path: '/Projects/Pack fixture/Empty/Nested' },
		]),
	);
	expect(
		pack.entries.some(
			(entry: PackEntry) =>
				/^\/(System|Trash)(\/|$)/.test(entry.path) || entry.path.endsWith('.desktop-pack.json'),
		),
	).toBe(false);
	expect(exported.result.skippedPacks).toBeGreaterThanOrEqual(1);
	expect(exported.result.omitted).toEqual(
		expect.arrayContaining(['/System', '/Trash', '*.desktop-pack.json']),
	);
	expect(exported.result.files).toBe(
		pack.entries.filter((entry: PackEntry) => entry.kind === 'file').length,
	);
	expect(exported.result.totalBytes).toBe(
		pack.entries.reduce(
			(total: number, entry: PackEntry) =>
				total + (entry.kind === 'file' ? Buffer.from(entry.data, 'base64').length : 0),
			0,
		),
	);

	const destination = await browser.newContext({ baseURL });
	try {
		const importedPage = await destination.newPage();
		await importedPage.goto('/');
		const imported = await importedPage.evaluate(async (text) => {
			const { packService } = await import('/src/lib/packs/packs.ts');
			const preview = await packService.inspectPackText(text);
			const result = await packService.importPackText(text, { actor: 'human' });
			return { preview, result };
		}, exported.text);
		expect(imported.preview.canImport).toBe(true);
		expect(imported.preview.collisions).toEqual([]);
		expect(imported.preview.filesToCreate).toBeGreaterThanOrEqual(3);
		expect(imported.result.status).toBe('imported');
		expect(imported.result.createdFiles).toContain('/Projects/Pack fixture/bytes.bin');
		expect(imported.result.createdDirectories).toContain('/Projects/Pack fixture/Empty/Nested');
		await importedPage.reload();
		const persisted = await importedPage.evaluate(async (text) => {
			const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
			const { packService } = await import('/src/lib/packs/packs.ts');
			return {
				bytes: Array.from(await workspaceService.readBytes('/Projects/Pack fixture/bytes.bin')),
				text: await workspaceService.readText('/Projects/Pack fixture/日本語.md'),
				empty: await workspaceService.readText('/Projects/Pack fixture/empty.txt'),
				children: await workspaceService.list('/Projects/Pack fixture/Empty/Nested'),
				repeated: await packService.importPackText(text, { actor: 'agent' }),
			};
		}, exported.text);
		expect(persisted.bytes).toEqual([0, 1, 127, 128, 254, 255]);
		expect(persisted.text).toBe('Research notes — বাংলা');
		expect(persisted.empty).toBe('');
		expect(persisted.children).toEqual([]);
		expect(persisted.repeated).toMatchObject({
			status: 'imported',
			createdFiles: [],
			createdDirectories: [],
			skippedFiles: exported.result.files,
		});
	} finally {
		await destination.close();
	}
});

test('one changed file blocks the entire import without overwriting or adding unrelated files', async ({
	page,
}) => {
	const text = manifest([
		file('/Documents/Pack keep.md', 'Replacement'),
		{ kind: 'directory', path: '/Fresh import/Empty' },
		file('/Fresh import/new.md'),
	]);
	const result = await page.evaluate(async (text) => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const { packService } = await import('/src/lib/packs/packs.ts');
		await workspaceService.writeText('/Documents/Pack keep.md', 'Original content');
		const before = await packService.inspectPackText(text);
		const imported = await packService.importPackText(text, {});
		return {
			before,
			imported,
			original: await workspaceService.readText('/Documents/Pack keep.md'),
			created: await workspaceService.exists('/Fresh import'),
		};
	}, text);
	expect(result.before.canImport).toBe(false);
	expect(result.before.collisions).toEqual([
		expect.objectContaining({ path: '/Documents/Pack keep.md', reason: expect.any(String) }),
	]);
	expect(result.imported).toMatchObject({
		status: 'blocked',
		createdFiles: [],
		createdDirectories: [],
	});
	expect(result.original).toBe('Original content');
	expect(result.created).toBe(false);
});

test('merges directories and skips identical bytes while importing new children', async ({
	page,
}) => {
	const text = manifest([
		{ kind: 'directory', path: '/Documents/Pack merge' },
		file('/Documents/Pack merge/same.md', 'Unchanged'),
		file('/Documents/Pack merge/new.md', 'New file'),
	]);
	const result = await page.evaluate(async (text) => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const { packService } = await import('/src/lib/packs/packs.ts');
		await workspaceService.writeText('/Documents/Pack merge/same.md', 'Unchanged');
		await workspaceService.writeText('/Documents/Pack merge/unlisted.md', 'Keep unlisted');
		await workspaceService.writeText('/Documents/merge.desktop-pack.json', text);
		const preview = await packService.inspect('/Documents/merge.desktop-pack.json');
		const imported = await packService.importPack('/Documents/merge.desktop-pack.json', {});
		return {
			preview,
			imported,
			newFile: await workspaceService.readText('/Documents/Pack merge/new.md'),
			unlisted: await workspaceService.readText('/Documents/Pack merge/unlisted.md'),
		};
	}, text);
	expect(result.preview).toMatchObject({
		canImport: true,
		existingFiles: 1,
		filesToCreate: 1,
		directoriesToCreate: 0,
	});
	expect(result.imported).toMatchObject({
		status: 'imported',
		skippedFiles: 1,
		createdFiles: ['/Documents/Pack merge/new.md'],
	});
	expect(result.newFile).toBe('New file');
	expect(result.unlisted).toBe('Keep unlisted');
});

test('validates every entry before creating any directories or files', async ({ page }) => {
	const text = manifest([
		{ kind: 'directory', path: '/Must not be created' },
		file('/Must not be created/first.md'),
		{ kind: 'file', path: '/Must not be created/last.bin', data: '%%%invalid%%%' },
	]);
	const result = await page.evaluate(async (text) => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const { packService } = await import('/src/lib/packs/packs.ts');
		let error = '';
		try {
			await packService.importPackText(text, {});
		} catch (cause) {
			error = String(cause);
		}
		return { error, exists: await workspaceService.exists('/Must not be created') };
	}, text);
	expect(result.error).not.toBe('');
	expect(result.exists).toBe(false);
});

test('rejects malformed manifests, unsafe paths, duplicate targets, and noncanonical base64', async ({
	page,
}) => {
	const invalid = [
		['invalid JSON', '{'],
		['array document', '[]'],
		['wrong format', manifest([], { format: 'unrelated' })],
		['unknown version', manifest([], { version: 2 })],
		['invalid timestamp', manifest([], { createdAt: 'yesterday' })],
		['missing entries', manifest([], { entries: null })],
		['relative path', manifest([file('Documents/test.md')])],
		['parent traversal', manifest([file('/Documents/../outside.md')])],
		['current segment', manifest([file('/Documents/./test.md')])],
		['duplicate separator', manifest([file('/Documents//test.md')])],
		['trailing separator', manifest([{ kind: 'directory', path: '/Documents/Test/' }])],
		['backslash', manifest([file('/Documents\\outside.md')])],
		['null byte', manifest([file('/Documents/bad\u0000.md')])],
		['root file', manifest([file('/')])],
		['system root', manifest([{ kind: 'directory', path: '/System' }])],
		['system descendant', manifest([file('/System/private.md')])],
		['trash descendant', manifest([file('/Trash/deleted.md')])],
		['duplicate target', manifest([file('/Documents/same.md'), file('/Documents/same.md')])],
		['file parent', manifest([file('/Documents/parent'), file('/Documents/parent/child.md')])],
		[
			'file and directory conflict',
			manifest([file('/Documents/conflict'), { kind: 'directory', path: '/Documents/conflict' }]),
		],
		['invalid alphabet', manifest([{ kind: 'file', path: '/Documents/bad.bin', data: '!!!!' }])],
		['missing padding', manifest([{ kind: 'file', path: '/Documents/bad.bin', data: 'Zg' }])],
		[
			'noncanonical pad bits',
			manifest([{ kind: 'file', path: '/Documents/bad.bin', data: 'Zh==' }]),
		],
		[
			'whitespace in base64',
			manifest([{ kind: 'file', path: '/Documents/bad.bin', data: 'Z g==' }]),
		],
	] as const;
	const results = await page.evaluate(async (cases) => {
		const { packService } = await import('/src/lib/packs/packs.ts');
		const results: { name: string; rejected: boolean }[] = [];
		for (const [name, text] of cases) {
			try {
				await packService.inspectPackText(text);
				results.push({ name, rejected: false });
			} catch {
				results.push({ name, rejected: true });
			}
		}
		return results;
	}, invalid);
	expect(results.filter((result) => !result.rejected)).toEqual([]);
});

test('reserved folder prefixes do not block unrelated user folders', async ({ page }) => {
	const text = manifest([
		file('/Systematic research/notes.md'),
		file('/Trashcan designs/notes.md'),
	]);
	const result = await page.evaluate(async (text) => {
		const { packService } = await import('/src/lib/packs/packs.ts');
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const imported = await packService.importPackText(text, {});
		return {
			imported,
			first: await workspaceService.readText('/Systematic research/notes.md'),
			second: await workspaceService.readText('/Trashcan designs/notes.md'),
		};
	}, text);
	expect(result.imported.status).toBe('imported');
	expect(result.first).toBe('Imported content');
	expect(result.second).toBe('Imported content');
});

test('rejects entry-count, decoded-byte, and serialized-size limits before writes', async ({
	page,
}) => {
	const result = await page.evaluate(async () => {
		const { packService } = await import('/src/lib/packs/packs.ts');
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const make = (entries: unknown[], extra = {}) =>
			JSON.stringify({
				format: 'webmcp-desktop-pack',
				version: 1,
				createdAt: '2026-09-03T10:00:00.000Z',
				entries,
				omitted: ['/System', '/Trash', '*.desktop-pack.json'],
				...extra,
			});
		const rejected: string[] = [];
		for (const name of ['entries', 'decoded bytes', 'serialized size']) {
			let text: string;
			if (name === 'entries') {
				text = make(
					Array.from({ length: 5001 }, (_, index) => ({
						kind: 'file',
						path: `/Oversized pack/${index}.txt`,
						data: '',
					})),
				);
			} else if (name === 'decoded bytes') {
				// Valid base64 for 32 MiB + 1 byte, below the serialized-size limit.
				const bytes = 32 * 1024 * 1024 + 1;
				text = make([
					{
						kind: 'file',
						path: '/Oversized pack/data.bin',
						data: 'AAAA'.repeat(bytes / 3),
					},
				]);
			} else {
				text = ' '.repeat(48 * 1024 * 1024 + 1) + make([]);
			}
			try {
				await packService.importPackText(text, {});
			} catch {
				rejected.push(name);
			}
		}
		return { rejected, exists: await workspaceService.exists('/Oversized pack') };
	});
	expect(result.rejected).toEqual(['entries', 'decoded bytes', 'serialized size']);
	expect(result.exists).toBe(false);
});

test('existing file parents and symlink destinations block import without following the link', async ({
	page,
}) => {
	const text = manifest([
		file('/Documents/Pack parent/child.md'),
		file('/Documents/Pack alias/child.md'),
		file('/Documents/Otherwise safe.md'),
	]);
	const result = await page.evaluate(async (text) => {
		const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
		const { packService } = await import('/src/lib/packs/packs.ts');
		await workspaceService.writeText('/Documents/Pack parent', 'This is a file');
		await workspaceService.createDirectory('/Documents/Pack target');
		await zenfs.promises.symlink('/Documents/Pack target', '/Documents/Pack alias');
		const preview = await packService.inspectPackText(text);
		const imported = await packService.importPackText(text, {});
		return {
			preview,
			imported,
			parent: await workspaceService.readText('/Documents/Pack parent'),
			targetChildren: await workspaceService.list('/Documents/Pack target'),
			created: await workspaceService.exists('/Documents/Otherwise safe.md'),
		};
	}, text);
	expect(result.preview.canImport).toBe(false);
	expect(result.preview.collisions).toHaveLength(2);
	expect(result.imported.status).toBe('blocked');
	expect(result.parent).toBe('This is a file');
	expect(result.targetChildren).toEqual([]);
	expect(result.created).toBe(false);
});

test('a failed write rolls back only newly created paths and leaves existing content intact', async ({
	page,
}) => {
	const text = manifest([
		file('/Documents/Pack existing/keep.md', 'Keep this'),
		file('/Documents/Pack existing/new.md', 'New sibling'),
		file('/Rollback fixture/nested/first.md', 'First file'),
		file('/Rollback fixture/nested/last.md', 'Fails after writing'),
	]);
	const result = await page.evaluate(async (text) => {
		const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
		const { packService } = await import('/src/lib/packs/packs.ts');
		await workspaceService.writeText('/Documents/Pack existing/keep.md', 'Keep this');
		const handle = await zenfs.promises.open('/Documents/Pack existing/keep.md', 'r');
		const filesystem = handle.vfs.fs;
		await handle.close();
		const originalWrite = filesystem.write.bind(filesystem);
		filesystem.write = async (path, data, offset) => {
			await originalWrite(path, data, offset);
			if (path === '/Rollback fixture/nested/last.md')
				throw new Error('Injected pack write failure after bytes reached storage');
		};
		let imported;
		try {
			imported = await packService.importPackText(text, {});
		} finally {
			filesystem.write = originalWrite;
		}
		return {
			imported,
			original: await workspaceService.readText('/Documents/Pack existing/keep.md'),
			siblings: (await workspaceService.list('/Documents/Pack existing')).map(
				(entry) => entry.name,
			),
			newRoot: await workspaceService.exists('/Rollback fixture'),
		};
	}, text);
	expect(result.imported).toMatchObject({ status: 'failed', remainingPaths: [] });
	expect(result.imported.error).toContain('Injected pack write failure');
	expect(result.imported.rolledBack).toContain('/Documents/Pack existing/new.md');
	expect(result.original).toBe('Keep this');
	expect(result.siblings).toEqual(['keep.md']);
	expect(result.newRoot).toBe(false);
});

test('export rejects symbolic links before writing an artifact', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
		const { packService } = await import('/src/lib/packs/packs.ts');
		await workspaceService.writeText('/Documents/Pack source.md', 'Original file');
		await zenfs.promises.symlink('/Documents/Pack source.md', '/Documents/Pack link.md');
		let error = '';
		try {
			await packService.exportPack({ path: '/Exports/links.desktop-pack.json' });
		} catch (cause) {
			error = String(cause);
		}
		return {
			error,
			exported: await workspaceService.exists('/Exports/links.desktop-pack.json'),
			source: await workspaceService.readText('/Documents/Pack source.md'),
			link: await zenfs.promises.readlink('/Documents/Pack link.md'),
		};
	});
	expect(result.error).not.toBe('');
	expect(result.exported).toBe(false);
	expect(result.source).toBe('Original file');
	expect(result.link).toBe('/Documents/Pack source.md');
});

test('a failed export removes its partial artifact and new parent folders while preserving source files', async ({
	page,
}) => {
	const result = await page.evaluate(async () => {
		const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
		const { packService } = await import('/src/lib/packs/packs.ts');
		await workspaceService.writeText('/Documents/Export source.md', 'Keep the original source');
		const handle = await zenfs.promises.open('/Documents/Export source.md', 'r');
		const filesystem = handle.vfs.fs;
		await handle.close();
		const originalWrite = filesystem.write.bind(filesystem);
		const path = '/New export folder/Nested/failed.desktop-pack.json';
		let wroteArtifact = false;
		filesystem.write = async (writtenPath, data, offset) => {
			await originalWrite(writtenPath, data, offset);
			if (writtenPath === path) {
				wroteArtifact = true;
				throw new Error('Injected export failure after saving bytes');
			}
		};
		let error = { code: '', message: '' };
		try {
			await packService.exportPack({ path });
		} catch (cause) {
			error = { code: cause.code, message: String(cause) };
		} finally {
			filesystem.write = originalWrite;
		}
		return {
			error,
			wroteArtifact,
			artifact: await workspaceService.exists(path),
			newRoot: await workspaceService.exists('/New export folder'),
			source: await workspaceService.readText('/Documents/Export source.md'),
		};
	});
	expect(result.wroteArtifact).toBe(true);
	expect(result.error.code).toBe('PACK_EXPORT_FAILED');
	expect(result.error.message).toContain('Injected export failure');
	expect(result.artifact).toBe(false);
	expect(result.newRoot).toBe(false);
	expect(result.source).toBe('Keep the original source');
});

test('the import tool reports blocked and failed results as unsuccessful without losing their status', async ({
	page,
}) => {
	const blockedPack = manifest([file('/Documents/Tool keep.md', 'Replacement')]);
	const failingPack = manifest([file('/Tool failed import/new.md', 'New data')]);
	const result = await page.evaluate(
		async ({ blockedPack, failingPack }) => {
			const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
			const { packTools } = await import('/src/lib/packs/tools.ts');
			const tool = packTools.find((item) => item.name === 'packs_import');
			if (!tool) throw new Error('packs_import is missing');
			await workspaceService.writeText('/Documents/Tool keep.md', 'Original');
			await workspaceService.writeText('/Documents/blocked.desktop-pack.json', blockedPack);
			await workspaceService.writeText('/Documents/failing.desktop-pack.json', failingPack);
			const blocked = await tool.execute({ path: '/Documents/blocked.desktop-pack.json' });
			const handle = await zenfs.promises.open('/Documents/Tool keep.md', 'r');
			const filesystem = handle.vfs.fs;
			await handle.close();
			const originalWrite = filesystem.write.bind(filesystem);
			filesystem.write = async (path, data, offset) => {
				await originalWrite(path, data, offset);
				if (path === '/Tool failed import/new.md') throw new Error('Injected import tool failure');
			};
			let failed;
			try {
				failed = await tool.execute({ path: '/Documents/failing.desktop-pack.json' });
			} finally {
				filesystem.write = originalWrite;
			}
			return {
				blocked,
				failed,
				original: await workspaceService.readText('/Documents/Tool keep.md'),
				newRoot: await workspaceService.exists('/Tool failed import'),
			};
		},
		{ blockedPack, failingPack },
	);
	expect(result.blocked.structuredContent).toMatchObject({
		ok: false,
		status: 'blocked',
		createdFiles: [],
	});
	expect(result.failed.structuredContent).toMatchObject({
		ok: false,
		status: 'failed',
		remainingPaths: [],
	});
	expect(result.failed.structuredContent.error).toContain('Injected import tool failure');
	expect(result.original).toBe('Original');
	expect(result.newRoot).toBe(false);
});

test('preserve mode imports an edited starter brief into a fresh workspace and retains both versions after reload', async ({
	page,
	browser,
	baseURL,
}) => {
	const exported = await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const { packService } = await import('/src/lib/packs/packs.ts');
		await workspaceService.writeText(
			'/Projects/Launch/brief.md',
			'# Updated launch brief\n\nUser work worth keeping.',
		);
		await workspaceService.writeText(
			'/Projects/Launch/Imported marker.md',
			'Arrived with the pack',
		);
		const result = await packService.exportPack({});
		return workspaceService.readText(result.path);
	});
	const destination = await browser.newContext({ baseURL });
	try {
		const importedPage = await destination.newPage();
		await importedPage.goto('/');
		const result = await importedPage.evaluate(async (text) => {
			const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
			const { packService } = await import('/src/lib/packs/packs.ts');
			const original = await workspaceService.readText('/Projects/Launch/brief.md');
			const preview = await packService.inspectPackText(text);
			const blocked = await packService.importPackText(text, {});
			const beforePreserve = {
				brief: await workspaceService.readText('/Projects/Launch/brief.md'),
				markerExists: await workspaceService.exists('/Projects/Launch/Imported marker.md'),
			};
			const imported = await packService.importPackText(text, { conflictMode: 'preserve' });
			return { original, preview, blocked, beforePreserve, imported };
		}, exported);
		expect(result.preview).toMatchObject({
			canImport: false,
			canPreserve: true,
			collisions: [expect.objectContaining({ path: '/Projects/Launch/brief.md', kind: 'file' })],
		});
		expect(result.blocked.status).toBe('blocked');
		expect(result.beforePreserve).toEqual({ brief: result.original, markerExists: false });
		expect(result.imported.status).toBe('imported');
		expect(result.imported.preservedFiles).toHaveLength(1);
		const preserved = result.imported.preservedFiles[0];
		expect(preserved.from).toBe('/Projects/Launch/brief.md');
		expect(preserved.to).toMatch(/^\/Imports\/Conflicts-[^/]+\/Projects\/Launch\/brief\.md$/);
		await importedPage.reload();
		const persisted = await importedPage.evaluate(
			async ({ text, backupPath }) => {
				const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
				const { packService } = await import('/src/lib/packs/packs.ts');
				return {
					brief: await workspaceService.readText('/Projects/Launch/brief.md'),
					backup: await workspaceService.readText(backupPath),
					marker: await workspaceService.readText('/Projects/Launch/Imported marker.md'),
					repeated: await packService.importPackText(text, { conflictMode: 'preserve' }),
				};
			},
			{ text: exported, backupPath: preserved.to },
		);
		expect(persisted.brief).toBe('# Updated launch brief\n\nUser work worth keeping.');
		expect(persisted.backup).toBe(result.original);
		expect(persisted.marker).toBe('Arrived with the pack');
		expect(persisted.repeated).toMatchObject({
			status: 'imported',
			createdFiles: [],
			preservedFiles: [],
		});
	} finally {
		await destination.close();
	}
});

test('failed preserve import restores exact original bytes and removes only its new files and backup folders', async ({
	page,
}) => {
	const text = manifest([
		{ kind: 'file', path: '/Documents/Preserve fixture/original.bin', data: 'AAECAwQ=' },
		file('/Documents/Preserve fixture/new.md', 'New sibling'),
		file('/Preserve failure/nested/fail.md', 'Written before failure'),
	]);
	const result = await page.evaluate(async (text) => {
		const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
		const { packService } = await import('/src/lib/packs/packs.ts');
		const originalPath = '/Documents/Preserve fixture/original.bin';
		await workspaceService.writeBytes(originalPath, new Uint8Array([255, 0, 127, 128, 254]));
		await workspaceService.writeText('/Imports/keep.md', 'Unrelated import history');
		const handle = await zenfs.promises.open(originalPath, 'r');
		const filesystem = handle.vfs.fs;
		await handle.close();
		const originalWrite = filesystem.write.bind(filesystem);
		let wroteFailure = false;
		filesystem.write = async (path, data, offset) => {
			await originalWrite(path, data, offset);
			if (path === '/Preserve failure/nested/fail.md') {
				wroteFailure = true;
				throw new Error('Injected preserve import failure after writing bytes');
			}
		};
		let imported;
		try {
			imported = await packService.importPackText(text, { conflictMode: 'preserve' });
		} finally {
			filesystem.write = originalWrite;
		}
		return {
			imported,
			wroteFailure,
			original: Array.from(await workspaceService.readBytes(originalPath)),
			originalFolder: (await workspaceService.list('/Documents/Preserve fixture')).map(
				(entry) => entry.name,
			),
			imports: (await workspaceService.list('/Imports')).map((entry) => entry.name),
			unrelated: await workspaceService.readText('/Imports/keep.md'),
			newRoot: await workspaceService.exists('/Preserve failure'),
		};
	}, text);
	expect(result.wroteFailure).toBe(true);
	expect(result.imported).toMatchObject({
		status: 'failed',
		preservedFiles: [],
		restoredOriginals: ['/Documents/Preserve fixture/original.bin'],
		remainingPaths: [],
	});
	expect(result.imported.error).toContain('Injected preserve import failure');
	expect(result.original).toEqual([255, 0, 127, 128, 254]);
	expect(result.originalFolder).toEqual(['original.bin']);
	expect(result.imports).toEqual(['keep.md']);
	expect(result.unrelated).toBe('Unrelated import history');
	expect(result.newRoot).toBe(false);
});

test('preserve mode blocks incompatible folders, symlinks, and file parents before moving any original', async ({
	page,
}) => {
	const text = manifest([
		file('/Documents/Preservable.md', 'New content'),
		file('/Documents/Existing folder', 'Cannot replace folder'),
		file('/Documents/Existing link', 'Cannot replace link'),
		file('/Documents/File parent/child.md', 'Cannot write through file'),
		file('/Preserve blocked/new.md', 'Must not appear'),
	]);
	const result = await page.evaluate(async (text) => {
		const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
		const { packService } = await import('/src/lib/packs/packs.ts');
		await workspaceService.writeText('/Documents/Preservable.md', 'Old content');
		await workspaceService.createDirectory('/Documents/Existing folder');
		await workspaceService.writeText('/Documents/File parent', 'Parent remains a file');
		await zenfs.promises.symlink('/Documents/Preservable.md', '/Documents/Existing link');
		const preview = await packService.inspectPackText(text);
		const imported = await packService.importPackText(text, { conflictMode: 'preserve' });
		return {
			preview,
			imported,
			original: await workspaceService.readText('/Documents/Preservable.md'),
			link: await zenfs.promises.readlink('/Documents/Existing link'),
			backupRoot: await workspaceService.exists('/Imports'),
			newRoot: await workspaceService.exists('/Preserve blocked'),
		};
	}, text);
	expect(result.preview).toMatchObject({ canImport: false, canPreserve: false });
	expect(
		result.preview.collisions.filter((collision) => collision.kind === 'incompatible'),
	).toHaveLength(3);
	expect(result.preview.collisions).toContainEqual(
		expect.objectContaining({
			path: '/Documents/Preservable.md',
			kind: 'file',
		}),
	);
	expect(result.imported).toMatchObject({
		status: 'blocked',
		preservedFiles: [],
		createdFiles: [],
	});
	expect(result.original).toBe('Old content');
	expect(result.link).toBe('/Documents/Preservable.md');
	expect(result.backupRoot).toBe(false);
	expect(result.newRoot).toBe(false);
});

test('the import tool validates conflict mode and preserves existing files when explicitly requested', async ({
	page,
}) => {
	const text = manifest([file('/Documents/Tool preserve.md', 'Imported version')]);
	const result = await page.evaluate(async (text) => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const { packTools } = await import('/src/lib/packs/tools.ts');
		const tool = packTools.find((item) => item.name === 'packs_import');
		if (!tool) throw new Error('packs_import is missing');
		await workspaceService.writeText('/Documents/Tool preserve.md', 'Existing version');
		await workspaceService.writeText('/Documents/preserve.desktop-pack.json', text);
		const invalid = await tool.execute({
			path: '/Documents/preserve.desktop-pack.json',
			conflictMode: 'overwrite',
		});
		const afterInvalid = await workspaceService.readText('/Documents/Tool preserve.md');
		const imported = await tool.execute({
			path: '/Documents/preserve.desktop-pack.json',
			conflictMode: 'preserve',
		});
		const preserved = imported.structuredContent.preservedFiles;
		return {
			invalid,
			afterInvalid,
			imported,
			current: await workspaceService.readText('/Documents/Tool preserve.md'),
			backup: preserved?.[0] ? await workspaceService.readText(preserved[0].to) : null,
		};
	}, text);
	expect(result.invalid.structuredContent).toMatchObject({
		ok: false,
		error: { code: 'INVALID_INPUT' },
	});
	expect(result.afterInvalid).toBe('Existing version');
	expect(result.imported.structuredContent).toMatchObject({ ok: true, status: 'imported' });
	expect(result.current).toBe('Imported version');
	expect(result.backup).toBe('Existing version');
});

test('preserve mode rejects an incompatible Imports backup location without touching originals', async ({
	page,
}) => {
	const text = manifest([file('/Documents/Backup blocked.md', 'Imported version')]);
	const result = await page.evaluate(async (text) => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const { packService } = await import('/src/lib/packs/packs.ts');
		await workspaceService.writeText('/Documents/Backup blocked.md', 'Existing version');
		await workspaceService.writeText('/Imports', 'A user file occupies the backup folder path');
		let code = '';
		try {
			await packService.importPackText(text, { conflictMode: 'preserve' });
		} catch (error) {
			code = error.code;
		}
		return {
			code,
			original: await workspaceService.readText('/Documents/Backup blocked.md'),
			imports: await workspaceService.readText('/Imports'),
		};
	}, text);
	expect(result.code).toBe('PACK_BACKUP_BLOCKED');
	expect(result.original).toBe('Existing version');
	expect(result.imports).toBe('A user file occupies the backup folder path');
});

test('an unsaved Notepad draft blocks changed imports while identical saved files can still be skipped', async ({
	page,
}) => {
	await page.clock.install({ time: new Date('2026-09-03T08:00:00Z') });
	await page.clock.pauseAt(new Date('2026-09-03T08:01:00Z'));
	const changed = manifest([file('/Documents/Draft target.md', 'Imported replacement')]);
	const identical = manifest([
		file('/Documents/Draft target.md', 'Saved original'),
		file('/Documents/Unrelated incoming.md', 'New unrelated file'),
	]);
	const result = await page.evaluate(
		async ({ changed, identical }) => {
			const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
			const { notepadService } = await import('/src/lib/workspace/notepad.ts');
			const { packService } = await import('/src/lib/packs/packs.ts');
			const path = '/Documents/Draft target.md';
			await workspaceService.writeText(path, 'Saved original');
			await notepadService.ready();
			await notepadService.open(path);
			notepadService.edit('Human draft still being written');
			const preview = await packService.inspectPackText(changed);
			const stopped = await packService.importPackText(changed, {});
			const preserved = await packService.importPackText(changed, { conflictMode: 'preserve' });
			const skipped = await packService.importPackText(identical, { conflictMode: 'preserve' });
			return {
				preview,
				stopped,
				preserved,
				skipped,
				saved: await workspaceService.readText(path),
				draft: { ...notepadService.getNote(path) },
				unrelated: await workspaceService.readText('/Documents/Unrelated incoming.md'),
				backupRoot: await workspaceService.exists('/Imports'),
			};
		},
		{ changed, identical },
	);
	expect(result.preview).toMatchObject({
		canImport: false,
		canPreserve: false,
		collisions: [
			expect.objectContaining({
				path: '/Documents/Draft target.md',
				kind: 'incompatible',
				reason: expect.stringContaining('Notepad'),
			}),
		],
	});
	expect(result.stopped).toMatchObject({ status: 'blocked', createdFiles: [], preservedFiles: [] });
	expect(result.preserved).toMatchObject({
		status: 'blocked',
		createdFiles: [],
		preservedFiles: [],
	});
	expect(result.skipped).toMatchObject({ status: 'imported', skippedFiles: 1, preservedFiles: [] });
	expect(result.saved).toBe('Saved original');
	expect(result.draft).toMatchObject({
		content: 'Human draft still being written',
		base: 'Saved original',
		status: 'edited',
	});
	expect(result.unrelated).toBe('New unrelated file');
	expect(result.backupRoot).toBe(false);
});

test('a Notepad edit during preservation restores the moved original and keeps the new draft', async ({
	page,
}) => {
	await page.clock.install({ time: new Date('2026-09-03T08:00:00Z') });
	await page.clock.pauseAt(new Date('2026-09-03T08:01:00Z'));
	const text = manifest([file('/Documents/Draft race.md', 'Imported replacement')]);
	const result = await page.evaluate(async (text) => {
		const { workspaceService, zenfs } = await import('/src/lib/workspace/workspace.ts');
		const { notepadService } = await import('/src/lib/workspace/notepad.ts');
		const { packService } = await import('/src/lib/packs/packs.ts');
		const path = '/Documents/Draft race.md';
		await workspaceService.writeText(path, 'Original before the race');
		await notepadService.ready();
		await notepadService.open(path);
		const handle = await zenfs.promises.open(path, 'r');
		const filesystem = handle.vfs.fs;
		await handle.close();
		const originalRename = filesystem.rename.bind(filesystem);
		let editedAfterMove = false;
		filesystem.rename = async (source, destination) => {
			await originalRename(source, destination);
			if (source === path && destination.startsWith('/Imports/Conflicts-')) {
				editedAfterMove = true;
				notepadService.edit('Human typed while import was running');
			}
		};
		let imported;
		try {
			imported = await packService.importPackText(text, { conflictMode: 'preserve' });
		} finally {
			filesystem.rename = originalRename;
		}
		return {
			imported,
			editedAfterMove,
			saved: await workspaceService.readText(path),
			draft: { ...notepadService.getNote(path) },
			backupRoot: await workspaceService.exists('/Imports'),
		};
	}, text);
	expect(result.editedAfterMove).toBe(true);
	expect(result.imported).toMatchObject({
		status: 'failed',
		preservedFiles: [],
		restoredOriginals: ['/Documents/Draft race.md'],
		remainingPaths: [],
	});
	expect(result.saved).toBe('Original before the race');
	expect(result.draft).toMatchObject({
		content: 'Human typed while import was running',
		base: 'Original before the race',
		status: 'edited',
	});
	expect(result.backupRoot).toBe(false);
});

test('Home previews a conflicting pack, imports both versions, and reveals the original in Finder', async ({
	page,
}) => {
	const original = await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const { openApp } = await import('/src/state/apps.svelte.ts');
		const original = await workspaceService.readText('/Projects/Launch/brief.md');
		openApp('home');
		return original;
	});
	const home = page.locator('section[aria-label="Home"]');
	await home.getByRole('button', { name: 'Workspace', exact: true }).click();
	await home.getByLabel('Choose workspace pack', { exact: true }).setInputFiles({
		name: 'updated-workspace.desktop-pack.json',
		mimeType: 'application/json',
		buffer: Buffer.from(manifest([file('/Projects/Launch/brief.md', '# Imported through Home\n')])),
	});
	await expect(
		home.getByText('1 existing paths differ from this pack.', { exact: true }),
	).toBeVisible();
	await home.getByRole('button', { name: 'Keep both and import', exact: true }).click();
	const preserved = home.getByRole('list', { name: 'Preserved original files' });
	await expect(preserved).toBeVisible();
	await expect(preserved).toContainText('/Projects/Launch/brief.md');
	await expect(home.getByRole('status')).toContainText('Imported 1 files');
	await preserved.getByRole('button', { name: 'Show original in Finder', exact: true }).click();
	await expect(page.locator('[data-app-id="finder"]')).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const { apps } = await import('/src/state/apps.svelte.ts');
				return apps.active;
			}),
		)
		.toBe('finder');
	const result = await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const { finderState } = await import('/src/lib/workspace/finder-state.svelte.ts');
		const { apps } = await import('/src/state/apps.svelte.ts');
		return {
			active: apps.active,
			selectedPath: finderState.selectedPath,
			current: await workspaceService.readText('/Projects/Launch/brief.md'),
			backup: await workspaceService.readText(finderState.selectedPath),
		};
	});
	expect(result.active).toBe('finder');
	expect(result.selectedPath).toMatch(/^\/Imports\/Conflicts-[^/]+\/Projects\/Launch\/brief\.md$/);
	expect(result.current).toBe('# Imported through Home\n');
	expect(result.backup).toBe(original);
});
