import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
	await page.waitForFunction(() => Boolean((window as any).__homeTools?.home_save_skill));
}
async function setup(page: Page) {
	await page.addInitScript(() => {
		const tools: Record<string, any> = {};
		Object.defineProperty(window, '__homeTools', { value: tools });
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
	await ready(page);
}
async function call(page: Page, name: string, input: Record<string, unknown> = {}) {
	return page.evaluate(
		async ({ name, input }) => (window as any).__homeTools[name].execute(input),
		{ name, input },
	);
}
async function ok(page: Page, name: string, input: Record<string, unknown> = {}) {
	const result = await call(page, name, input);
	expect(result.structuredContent.ok, JSON.stringify(result).slice(0, 2000)).toBe(true);
	return result.structuredContent;
}
const preferences = {
	displayName: "Maya's research workspace",
	instructions: 'Put decisions first. Save editable sources beside reports.',
	language: 'English',
	timeZone: 'Asia/Dhaka',
	outputFolder: '/Documents/Reports',
	referencePaths: ['/Documents/Example report.md'],
	preferredSkillPaths: ['/Home/Skills/weekly-update/SKILL.md'],
};
const skill = {
	name: 'weekly-update',
	description: 'Prepare a client update using the saved template.',
	instructions:
		'# Weekly update\n\nRead [the report example](/Documents/Example report.md). Start with decisions needed.\n\nKeep editable source files.',
};

test('Home discovery and launch leave defaults unsaved', async ({ page }) => {
	await setup(page);
	const before = await ok(page, 'activity_list');
	const result = await ok(page, 'home_get_context');
	expect(result.profile).toMatchObject({ exists: false, revision: null });
	expect(result.skills).toEqual([]);
	expect(result.warnings).toEqual([]);
	expect(result.briefText).toContain('No readable saved preferences');
	await page.getByRole('button', { name: 'Launch Home app', exact: true }).click();
	await expect(page.locator('[data-app-id="home"]')).toBeVisible();
	expect((await ok(page, 'home_get_context')).profile.exists).toBe(false);
	const exists = await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		return workspaceService.exists('/Home/profile.json');
	});
	expect(exists).toBe(false);
	expect(await ok(page, 'activity_list')).toEqual(before);
});

test('saved preferences and skill instructions orient a fresh session', async ({ page }) => {
	await setup(page);
	await ok(page, 'files_write', {
		path: '/Documents/Example report.md',
		content: '# Client update\nDecisions first.',
		createOnly: true,
	});
	const savedSkill = await ok(page, 'home_save_skill', { ...skill, expectedRevision: null });
	expect(savedSkill.path).toBe('/Home/Skills/weekly-update/SKILL.md');
	expect(savedSkill.content).toContain('name: "weekly-update"');
	const saved = await ok(page, 'home_save_preferences', { preferences, expectedRevision: null });
	expect(saved.exists).toBe(true);
	const app = page.locator('[data-app-id="home"]');
	await expect(app).toBeVisible();
	await expect(app.getByLabel('Workspace name', { exact: true })).toHaveValue(
		preferences.displayName,
	);
	await page.reload();
	await ready(page);
	const context = await ok(page, 'home_get_context');
	expect(context.profile.revision).toBe(saved.revision);
	expect(context.profile.data.preferences).toEqual(preferences);
	expect(context.briefText).toContain('Put decisions first');
	expect(context.briefText).toContain('weekly-update');
	expect(context.warnings).toEqual([]);
	expect((await ok(page, 'home_read_skill', { path: savedSkill.path })).instructions).toBe(
		skill.instructions,
	);
	const profileFile = await ok(page, 'files_read', { path: '/Home/profile.json' });
	expect(JSON.parse(profileFile.content).preferences).toEqual(preferences);
});

test('concurrent preference edits preserve one winner and reject stale revisions', async ({
	page,
}) => {
	await setup(page);
	const base = await ok(page, 'home_save_preferences', { preferences, expectedRevision: null });
	const results = await Promise.all([
		call(page, 'home_save_preferences', {
			preferences: { ...preferences, displayName: 'Research A' },
			expectedRevision: base.revision,
		}),
		call(page, 'home_save_preferences', {
			preferences: { ...preferences, displayName: 'Research B' },
			expectedRevision: base.revision,
		}),
	]);
	const winner = results.find((result) => result.structuredContent.ok)!.structuredContent;
	const rejected = results.find((result) => !result.structuredContent.ok)!.structuredContent;
	expect(rejected.error.code).toBe('FILE_CHANGED');
	expect((await ok(page, 'home_get_context')).profile.data.preferences.displayName).toBe(
		winner.data.preferences.displayName,
	);
	const createAgain = await call(page, 'home_save_preferences', {
		preferences,
		expectedRevision: null,
	});
	expect(createAgain.structuredContent.error.code).toBe('PATH_EXISTS');
});

test('malformed profile and skills remain available for repair without clobbering good files', async ({
	page,
}) => {
	await setup(page);
	await ok(page, 'home_save_skill', { ...skill, expectedRevision: null });
	await ok(page, 'files_write', {
		path: '/Home/profile.json',
		content: '{ broken json',
		createOnly: true,
	});
	await ok(page, 'files_write', {
		path: '/Home/Skills/broken/SKILL.md',
		content: 'No frontmatter here.',
		createOnly: true,
	});
	const context = await ok(page, 'home_get_context');
	expect(context.profile).toBeNull();
	expect(context.warnings.map((warning: any) => warning.path)).toEqual(
		expect.arrayContaining(['/Home/profile.json', '/Home/Skills/broken/SKILL.md']),
	);
	expect(context.skills.map((item: any) => item.name)).toEqual(['weekly-update']);
	expect((await ok(page, 'files_read', { path: '/Home/profile.json' })).content).toBe(
		'{ broken json',
	);
	const brokenSkill = await call(page, 'home_read_skill', { path: '/Home/Skills/broken/SKILL.md' });
	expect(brokenSkill.structuredContent.error.code).toBe('INVALID_DATA');
	await page.reload();
	await ready(page);
	expect((await ok(page, 'files_read', { path: '/Home/profile.json' })).content).toBe(
		'{ broken json',
	);
	await page.getByRole('button', { name: 'Launch Home app', exact: true }).click();
	const app = page.locator('[data-app-id="home"]');
	await expect(app.getByRole('alert')).toContainText('Cannot read');
	await app.getByRole('button', { name: 'Toolbox', exact: true }).click();
	await app.getByRole('button', { name: /weekly-update/ }).click();
	await expect(app.getByLabel('Instructions', { exact: true })).toHaveValue(skill.instructions);
});

test('skill saves round-trip quoted descriptions and protect the previous revision', async ({
	page,
}) => {
	await setup(page);
	const original = await ok(page, 'home_save_skill', {
		...skill,
		description: 'Use "decisions first": keep notes\nwith the source.',
		instructions: '    Keep Markdown code indentation.\n\n',
		expectedRevision: null,
	});
	const read = await ok(page, 'home_read_skill', { path: original.path });
	expect(read.description).toBe('Use "decisions first": keep notes\nwith the source.');
	expect(read.instructions).toBe('    Keep Markdown code indentation.\n\n');
	const next = await ok(page, 'home_save_skill', {
		...skill,
		instructions: 'A revised procedure.',
		expectedRevision: read.revision,
	});
	const stale = await call(page, 'home_save_skill', {
		...skill,
		instructions: 'Stale edit.',
		expectedRevision: read.revision,
	});
	expect(stale.structuredContent.error.code).toBe('FILE_CHANGED');
	expect((await ok(page, 'home_read_skill', { path: original.path })).instructions).toBe(
		next.instructions,
	);
	const invalid = await call(page, 'home_save_skill', {
		...skill,
		name: '../escape',
		expectedRevision: null,
	});
	expect(invalid.structuredContent.error.code).toBe('INVALID_DATA');
	const wrongTimeZone = await call(page, 'home_save_preferences', {
		preferences: { ...preferences, timeZone: 'not/a-timezone' },
		expectedRevision: null,
	});
	expect(wrongTimeZone.structuredContent.error.code).toBe('INVALID_DATA');
});

test('human preferences and skill drafts block competing agent writes', async ({ page }) => {
	await setup(page);
	const base = await ok(page, 'home_save_preferences', { preferences, expectedRevision: null });
	const app = page.locator('[data-app-id="home"]');
	await app
		.getByLabel('Working instructions', { exact: true })
		.fill('My unsaved working instructions.');
	const blocked = await call(page, 'home_save_preferences', {
		preferences,
		expectedRevision: base.revision,
	});
	expect(blocked.structuredContent.error.code).toBe('OPEN_DRAFT');
	await app.getByRole('button', { name: 'Toolbox', exact: true }).click();
	await expect(app.getByRole('alert')).toContainText('Save or discard');
	await expect(app.getByLabel('Working instructions', { exact: true })).toHaveValue(
		'My unsaved working instructions.',
	);
	await app.getByRole('button', { name: 'Save preferences', exact: true }).click();
	await expect(app.getByRole('status')).toContainText('Preferences saved');
	expect((await ok(page, 'home_get_context')).profile.data.preferences.instructions).toBe(
		'My unsaved working instructions.',
	);
	await app.getByRole('button', { name: 'Toolbox', exact: true }).click();
	await app.getByRole('button', { name: 'Add skill', exact: true }).click();
	await app.getByLabel('Skill name', { exact: true }).fill('release-review');
	await app.getByLabel('Description', { exact: true }).fill('Review the release notes.');
	await app
		.getByLabel('Instructions', { exact: true })
		.fill('Read the release notes and verify each listed change.');
	await app.getByRole('button', { name: 'Save skill', exact: true }).click();
	await expect(app.getByRole('status')).toContainText('Skill saved');
	const savedSkill = await ok(page, 'home_read_skill', {
		path: '/Home/Skills/release-review/SKILL.md',
	});
	await app
		.getByLabel('Instructions', { exact: true })
		.fill('A human draft that is not saved yet.');
	const blockedSkill = await call(page, 'home_save_skill', {
		name: savedSkill.name,
		description: savedSkill.description,
		instructions: 'An agent replacement.',
		expectedRevision: savedSkill.revision,
	});
	expect(blockedSkill.structuredContent.error.code).toBe('OPEN_DRAFT');
	await expect(app.getByLabel('Instructions', { exact: true })).toHaveValue(
		'A human draft that is not saved yet.',
	);
	await app.getByRole('button', { name: 'Discard changes', exact: true }).click();
	expect((await ok(page, 'home_read_skill', { path: savedSkill.path })).instructions).toBe(
		savedSkill.instructions,
	);
});

test('an external file change preserves the human draft until discard and reload', async ({
	page,
}) => {
	await setup(page);
	await ok(page, 'home_save_preferences', { preferences, expectedRevision: null });
	const app = page.locator('[data-app-id="home"]');
	await app.getByLabel('Working instructions', { exact: true }).fill('Keep this draft visible.');
	await page.evaluate(async (preferences) => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		// Model a file edit outside Home, such as a Terminal command.
		await workspaceService.writeText(
			'/Home/profile.json',
			JSON.stringify({
				format: 'webmcp-home',
				version: 1,
				preferences: { ...preferences, instructions: 'An external saved revision.' },
			}),
			{ actor: 'human' },
		);
	}, preferences);
	await expect(app.getByRole('status')).toContainText('This file changed while you were editing');
	await expect(app.getByLabel('Working instructions', { exact: true })).toHaveValue(
		'Keep this draft visible.',
	);
	await expect(app.getByRole('button', { name: 'Save preferences', exact: true })).toBeDisabled();
	await app.getByRole('button', { name: 'Discard and reload', exact: true }).click();
	await expect(app.getByLabel('Working instructions', { exact: true })).toHaveValue(
		'An external saved revision.',
	);
});

test('oversized Unicode skills are rejected before an unreadable file is created', async ({
	page,
}) => {
	await setup(page);
	const result = await call(page, 'home_save_skill', {
		name: 'large',
		description: 'Too much text.',
		instructions: '界'.repeat(40000),
		expectedRevision: null,
	});
	expect(result.structuredContent.error.code).toBe('FILE_TOO_LARGE');
	expect((await ok(page, 'home_list_skills')).skills).toEqual([]);
});

test('desktop context reads bounded saved preferences without changing files or focus', async ({
	page,
}) => {
	await setup(page);
	await ok(page, 'home_save_preferences', {
		preferences: {
			...preferences,
			instructions: 'Keep the decisions first.\n' + 'Detailed preference. '.repeat(450),
		},
		expectedRevision: null,
	});
	await page.getByRole('button', { name: 'Close Home', exact: true }).click();
	await expect(page.locator('[data-app-id="home"]')).toHaveCount(0);
	await page.getByRole('button', { name: 'Launch Calculator app', exact: true }).click();
	await expect(page.locator('[data-app-id="calculator"]')).toBeVisible();
	const full = await ok(page, 'home_get_context');
	const snapshotFiles = () =>
		page.evaluate(async () => {
			const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
			return Promise.all(
				workspaceService
					.getAllPaths()
					.sort()
					.map(async (path) => {
						const entry = await workspaceService.stat(path);
						return { path, kind: entry.kind, size: entry.size, modifiedAt: entry.modifiedAt };
					}),
			);
		});
	const beforeFiles = await snapshotFiles();
	const beforeActivity = await ok(page, 'activity_list');
	const result = await ok(page, 'desktop_get_context');
	expect(result.workingPreferences).toEqual({
		path: '/Home/profile.json',
		configured: true,
		briefText: full.briefText.slice(0, 8000),
		truncated: true,
		readTool: 'home_get_context',
	});
	expect(result.workingPreferences.briefText).toHaveLength(8000);
	expect(result.workingPreferences.briefText).toContain('Keep the decisions first');
	expect(result.activeApp).toBe('calculator');
	expect(result.context.home).toBeNull();
	expect(result.openApps.some((app: any) => app.id === 'home')).toBe(false);
	await expect(page.locator('[data-app-id="home"]')).toHaveCount(0);
	expect(await snapshotFiles()).toEqual(beforeFiles);
	expect(await ok(page, 'activity_list')).toEqual(beforeActivity);
	expect((await ok(page, 'home_get_context')).profile.revision).toBe(full.profile.revision);
});

test('Review protects Home profile and skill drafts while restoring independent copies', async ({
	page,
}) => {
	await setup(page);
	const originalProfile = await ok(page, 'home_save_preferences', {
		preferences,
		expectedRevision: null,
	});
	const updatedProfile = await ok(page, 'home_save_preferences', {
		preferences: { ...preferences, instructions: 'The currently saved preference.' },
		expectedRevision: originalProfile.revision,
	});
	const originalSkill = await ok(page, 'home_save_skill', { ...skill, expectedRevision: null });
	const updatedSkill = await ok(page, 'home_save_skill', {
		...skill,
		instructions: 'The currently saved skill.',
		expectedRevision: originalSkill.revision,
	});
	const skillVersion = (await ok(page, 'review_list', { path: updatedSkill.path })).versions.find(
		(version: any) => version.after.revision === updatedSkill.revision,
	);
	expect(skillVersion).toBeTruthy();
	const app = page.locator('[data-app-id="home"]');
	for (const target of [
		{
			path: '/Home/profile.json',
			versionId: updatedProfile.entry.versionId,
			label: 'Working instructions',
			draft: 'Preserve my profile draft.',
			destination: '/Documents/Profile recovery.json',
			original: JSON.stringify(originalProfile.data),
		},
		{
			path: updatedSkill.path,
			versionId: skillVersion.id,
			label: 'Instructions',
			draft: 'Preserve my skill draft.',
			destination: '/Documents/Skill recovery.md',
			original: originalSkill.content,
		},
	]) {
		if (target.label === 'Instructions') {
			await app.getByRole('button', { name: 'Toolbox', exact: true }).click();
			await app.getByRole('button', { name: /weekly-update/ }).click();
		}
		await app.getByLabel(target.label, { exact: true }).fill(target.draft);
		const review = (await ok(page, 'review_read', { versionId: target.versionId })).review;
		expect(review.canRestore).toBe(false);
		expect(review.blocked).toContain('unsaved app edits');
		const denied = await call(page, 'review_restore', {
			versionId: target.versionId,
			mode: 'replace',
			expectedCurrentToken: review.current.token,
		});
		expect(denied.structuredContent.error.code).toBe('OPEN_DRAFT');
		await ok(page, 'review_restore', {
			versionId: target.versionId,
			mode: 'copy',
			destination: target.destination,
		});
		const copy = (await ok(page, 'files_read', { path: target.destination })).content;
		expect(target.label === 'Working instructions' ? JSON.stringify(JSON.parse(copy)) : copy).toBe(
			target.original,
		);
		await expect(app.getByLabel(target.label, { exact: true })).toHaveValue(target.draft);
		expect((await ok(page, 'files_read', { path: target.path })).revision).toBe(
			review.version.after.revision,
		);
		await app.getByRole('button', { name: 'Discard changes', exact: true }).click();
	}
});
