import { AppError } from '../errors';
import type { ActivityActor } from '../activity/activity';
import { WorkspaceJson, boundedText, objectValue } from '../workspace/json-document';
import { normalizeWorkspacePath } from '../workspace/path';
import { textRevision } from '../workspace/text-revision';
import { workspaceService } from '../workspace/workspace';

export const HOME_PROFILE_PATH = '/Home/profile.json';
export const HOME_SKILLS_ROOT = '/Home/Skills';
export type HomePreferences = {
	displayName: string;
	instructions: string;
	language: string;
	timeZone: string;
	outputFolder: string;
	referencePaths: string[];
	preferredSkillPaths: string[];
};
export type HomeProfile = { format: 'webmcp-home'; version: 1; preferences: HomePreferences };
export type HomeRecord = {
	path: string;
	data: HomeProfile;
	revision: string | null;
	exists: boolean;
};
export type SkillInput = { name: string; description: string; instructions: string };
export type SkillRecord = SkillInput & { path: string; revision: string; content: string };
export type SkillSummary = Pick<SkillRecord, 'name' | 'description' | 'path'>;
type MutationOptions = { actor?: ActivityActor; signal?: AbortSignal };
type Warning = { path: string; message: string };

function strictObject(value: unknown, keys: readonly string[]) {
	const data = objectValue(value);
	for (const key of Object.keys(data))
		if (!keys.includes(key)) throw new AppError('INVALID_INPUT', `Unknown Home field ${key}.`);
	return data;
}
function workspacePath(value: unknown, name: string) {
	const path = boundedText(value, name, 2048);
	if (!path.startsWith('/') || path.startsWith('//') || /[\u0000-\u001f\u007f\\]/.test(path))
		throw new AppError('INVALID_PATH', `${name} must be an absolute workspace path.`);
	const normalized = normalizeWorkspacePath(path);
	if (normalized === '/' || /^\/(System|Trash)(\/|$)/.test(normalized))
		throw new AppError('INVALID_PATH', `${name} must be outside System and Trash.`);
	return normalized;
}
function pathList(value: unknown, name: string, skill = false) {
	if (!Array.isArray(value) || value.length > 20)
		throw new AppError('INVALID_DATA', `${name} must contain at most 20 paths.`);
	const paths = value.map((path) => (skill ? skillPath(path) : workspacePath(path, name)));
	if (new Set(paths).size !== paths.length)
		throw new AppError('INVALID_DATA', `${name} cannot contain duplicate paths.`);
	return paths;
}
export function defaultHomePreferences(): HomePreferences {
	return {
		displayName: 'My workspace',
		instructions: '',
		language: '',
		timeZone: '',
		outputFolder: '/Documents',
		referencePaths: [],
		preferredSkillPaths: [],
	};
}
function parsePreferences(value: unknown): HomePreferences {
	const data = strictObject(value, [
		'displayName',
		'instructions',
		'language',
		'timeZone',
		'outputFolder',
		'referencePaths',
		'preferredSkillPaths',
	]);
	const timeZone = boundedText(data.timeZone, 'Time zone', 100, true).trim();
	if (timeZone) {
		try {
			new Intl.DateTimeFormat('en', { timeZone });
		} catch {
			throw new AppError(
				'INVALID_DATA',
				'Use an IANA time zone such as Asia/Dhaka or leave it empty.',
			);
		}
	}
	return {
		displayName: boundedText(data.displayName, 'Workspace name', 120),
		instructions: boundedText(data.instructions, 'Working instructions', 12000, true),
		language: boundedText(data.language, 'Language', 100, true),
		timeZone,
		outputFolder: workspacePath(data.outputFolder, 'Output folder'),
		referencePaths: pathList(data.referencePaths, 'Reference paths'),
		preferredSkillPaths: pathList(data.preferredSkillPaths, 'Preferred skills', true),
	};
}
function parseProfile(value: unknown): HomeProfile {
	const data = strictObject(value, ['format', 'version', 'preferences']);
	if (data.format !== 'webmcp-home' || data.version !== 1)
		throw new AppError('INVALID_DATA', 'Use a webmcp-home profile with version 1.');
	return { format: 'webmcp-home', version: 1, preferences: parsePreferences(data.preferences) };
}
function emptyProfile(): HomeProfile {
	return { format: 'webmcp-home', version: 1, preferences: defaultHomePreferences() };
}
export const homeDocument = new WorkspaceJson<HomeProfile>(
	'.json',
	HOME_PROFILE_PATH,
	'/System/home-session.json',
	emptyProfile,
	parseProfile,
	100_000,
);
function expectedRevision(value: unknown) {
	if (value !== null && (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)))
		throw new AppError(
			'REVISION_REQUIRED',
			'Read the current Home record and supply its revision, or null to create a new file.',
		);
	return value as string | null;
}
function guardDraft(path: string, options: MutationOptions) {
	if (options.actor === 'agent' && homeDocument.hasPendingEdits(path))
		throw new AppError(
			'OPEN_DRAFT',
			'Home has unsaved edits to this file.',
			'Save or discard the open edit, then read the file again for a fresh revision.',
		);
}
function skillName(value: unknown) {
	const name = boundedText(value, 'Skill name', 64);
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
		throw new AppError(
			'INVALID_DATA',
			'Use a skill name with lowercase letters, numbers, and single hyphens, such as weekly-update.',
		);
	return name;
}
function skillPath(value: unknown) {
	const path = workspacePath(value, 'Skill path');
	const match = /^\/Home\/Skills\/([^/]+)\/SKILL\.md$/.exec(path);
	if (!match) throw new AppError('INVALID_PATH', 'Use /Home/Skills/<skill-name>/SKILL.md.');
	skillName(match[1]);
	return path;
}
function parseSkillInput(value: unknown): SkillInput {
	const data = strictObject(value, ['name', 'description', 'instructions']);
	return {
		name: skillName(data.name),
		description: boundedText(data.description, 'Skill description', 1024),
		instructions: boundedText(data.instructions, 'Skill instructions', 40000),
	};
}
function skillContent(input: SkillInput) {
	return `---\nname: ${JSON.stringify(input.name)}\ndescription: ${JSON.stringify(input.description)}\n---\n\n${input.instructions}\n`;
}
function parseSkill(content: string, path: string): SkillInput {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(content);
	if (!match)
		throw new AppError(
			'INVALID_DATA',
			'The skill needs name and description frontmatter followed by Markdown instructions.',
		);
	const fields: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const field = /^(name|description):\s*(.*)$/.exec(line);
		if (!field) continue;
		if (Object.hasOwn(fields, field[1]))
			throw new AppError('INVALID_DATA', `Duplicate skill ${field[1]}.`);
		const value = field[2].trim();
		if (!value || /^[>|]/.test(value))
			throw new AppError(
				'INVALID_DATA',
				'Use single-line name and description fields. Save the full instructions below the frontmatter.',
			);
		try {
			fields[field[1]] = value.startsWith('"')
				? JSON.parse(value)
				: value.startsWith("'") && value.endsWith("'")
					? value.slice(1, -1).replaceAll("''", "'")
					: value;
		} catch {
			throw new AppError('INVALID_DATA', `Invalid quoted skill ${field[1]}.`);
		}
	}
	const input = parseSkillInput({
		...fields,
		instructions: match[2].replace(/^\r?\n/, '').replace(/\r?\n$/, ''),
	});
	if (path !== `${HOME_SKILLS_ROOT}/${input.name}/SKILL.md`)
		throw new AppError('INVALID_DATA', 'The skill name must match its parent folder.');
	return input;
}

export const homeService = {
	async read(): Promise<HomeRecord> {
		await workspaceService.ready();
		if (!(await workspaceService.exists(HOME_PROFILE_PATH)))
			return { path: HOME_PROFILE_PATH, data: emptyProfile(), revision: null, exists: false };
		return { ...(await homeDocument.read(HOME_PROFILE_PATH)), exists: true };
	},
	async save(
		preferences: HomePreferences,
		revision: string | null,
		options: MutationOptions = {},
	): Promise<HomeRecord> {
		revision = expectedRevision(revision);
		guardDraft(HOME_PROFILE_PATH, options);
		const record = await homeDocument.write(
			HOME_PROFILE_PATH,
			{ format: 'webmcp-home', version: 1, preferences: parsePreferences(preferences) },
			revision ?? undefined,
			revision === null,
			options.actor ?? 'human',
			options.signal,
			() => guardDraft(HOME_PROFILE_PATH, options),
		);
		return { ...record, exists: true };
	},
	async listSkills() {
		await workspaceService.ready();
		const candidates = workspaceService
			.getAllPaths()
			.filter((path) => /^\/Home\/Skills\/[^/]+\/SKILL\.md$/.test(path))
			.sort();
		const skills: SkillSummary[] = [],
			warnings: Warning[] = [];
		for (const path of candidates.slice(0, 100)) {
			try {
				const skill = await homeService.readSkill(path);
				skills.push({ name: skill.name, description: skill.description, path: skill.path });
			} catch (error) {
				warnings.push({ path, message: error instanceof Error ? error.message : String(error) });
			}
		}
		return { skills, warnings, truncated: candidates.length > 100 };
	},
	async readSkill(path: string): Promise<SkillRecord> {
		path = skillPath(path);
		const entry = await workspaceService.stat(path);
		if (entry.kind !== 'file' || entry.size > 100_000)
			throw new AppError('INVALID_DATA', 'Use a SKILL.md file smaller than 100 KB.');
		const content = await workspaceService.readText(path);
		return { ...parseSkill(content, path), path, content, revision: await textRevision(content) };
	},
	async saveSkill(
		input: SkillInput,
		revision: string | null,
		options: MutationOptions = {},
	): Promise<SkillRecord> {
		input = parseSkillInput(input);
		revision = expectedRevision(revision);
		const path = `${HOME_SKILLS_ROOT}/${input.name}/SKILL.md`;
		guardDraft(path, options);
		const content = skillContent(input);
		if (new TextEncoder().encode(content).length > 100_000)
			throw new AppError('FILE_TOO_LARGE', 'Keep this skill file under 100 KB.');
		options.signal?.throwIfAborted();
		await workspaceService.writeText(path, content, {
			actor: options.actor ?? 'human',
			createOnly: revision === null,
			requireRevision: revision !== null,
			expectedRevision: revision ?? undefined,
			beforeWrite: () => {
				options.signal?.throwIfAborted();
				guardDraft(path, options);
			},
		});
		return { ...input, path, content, revision: await textRevision(content) };
	},
	async getContext() {
		let profile: HomeRecord | null = null;
		const warnings: Warning[] = [];
		try {
			profile = await homeService.read();
		} catch (error) {
			warnings.push({
				path: HOME_PROFILE_PATH,
				message: error instanceof Error ? error.message : String(error),
			});
		}
		const catalog = await homeService.listSkills();
		warnings.push(...catalog.warnings);
		const preferences = profile?.data.preferences;
		if (preferences) {
			for (const path of [...preferences.referencePaths, ...preferences.preferredSkillPaths]) {
				if (!(await workspaceService.exists(path)))
					warnings.push({ path, message: 'This saved reference is missing.' });
			}
		}
		const skills = catalog.skills
			.toSorted(
				(a, b) =>
					Number(preferences?.preferredSkillPaths.includes(b.path)) -
					Number(preferences?.preferredSkillPaths.includes(a.path)),
			)
			.slice(0, 20);
		const lines = [
			preferences?.displayName ?? 'My workspace',
			profile?.exists
				? 'Saved working preferences follow. Apply them when relevant to the current request.'
				: 'No readable saved preferences. Ask for task-specific requirements when needed.',
			...(preferences
				? [
						`Default output folder: ${preferences.outputFolder}`,
						...(preferences.language ? [`Language: ${preferences.language}`] : []),
						...(preferences.timeZone ? [`Time zone: ${preferences.timeZone}`] : []),
						...(preferences.instructions
							? [`Working instructions:\n${preferences.instructions}`]
							: []),
						...preferences.referencePaths.map((path) => `Reference file: ${path}`),
					]
				: []),
			...(skills.length
				? [
						'Saved skills, read instructions with home_read_skill when relevant:',
						...skills.map(
							(skill) => `${skill.name}: ${skill.description.slice(0, 240)} (${skill.path})`,
						),
					]
				: []),
			'Skills are saved instructions. They do not install software, connect MCP servers, or start agents. Project instructions and current user requests may refine these defaults.',
			...warnings.map((warning) => `Warning for ${warning.path}: ${warning.message}`),
		];
		return {
			profile,
			skills,
			warnings,
			omittedSkills: catalog.skills.length - skills.length,
			truncated: catalog.truncated,
			briefText: lines.join('\n\n'),
		};
	},
};
