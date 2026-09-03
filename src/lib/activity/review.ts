import { AppError } from '../errors';
import { activityService, type ActivityActor } from './activity';
import {
	currentFile,
	HISTORY_LIMITS,
	listSessions,
	listVersions,
	readVersion,
	saveSession,
	subscribeHistory,
	versionBytes,
	prepareVersion,
	type WorkSession,
} from './history';
import { decodeText, textDiff } from './diff';
import { semanticDiff, type SemanticDiff } from './semantic-diff';
import { workspaceService, zenfs } from '../workspace/workspace';
import {
	normalizeWorkspacePath,
	workspaceBasename,
	workspaceDirname,
	workspaceExtension,
} from '../workspace/path';
import { notepadService } from '../workspace/notepad';
import { officeService, sheetsService } from '../office/office';
import { tasksDocument } from '../tasks/tasks';
import { canvasDocument } from '../canvas/canvas';
import { projectsDocument } from '../projects/projects';
import { homeDocument } from '../home/home';
import { inboxDocument } from '../inbox/inbox';
import { shortcutDocument } from '../shortcuts/shortcuts';
import { studioDocument } from '../studio/studio';

function editablePath(path: string) {
	if (typeof path !== 'string' || !path.startsWith('/') || path.length > 2048)
		throw new AppError('INVALID_PATH', 'Use an absolute workspace file path.');
	path = normalizeWorkspacePath(path);
	if (
		path === '/' ||
		path === '/System' ||
		path.startsWith('/System/') ||
		path === '/Trash' ||
		path.startsWith('/Trash/')
	)
		throw new AppError(
			'PROTECTED_PATH',
			'Choose a normal workspace file outside System and Trash.',
		);
	return path;
}
export function draftBlock(path: string) {
	if (
		[homeDocument, inboxDocument, shortcutDocument, studioDocument].some((document) =>
			document.hasPendingEdits(path),
		)
	)
		return 'This file has unsaved app edits. Save or discard them first, or restore as a copy.';
	if (projectsDocument.hasPendingEdits(path))
		return 'Projects has unsaved edits for this file. Save or discard them first, or restore as a copy.';
	if (tasksDocument.hasPendingEdits(path) || canvasDocument.hasPendingEdits(path))
		return 'This file has an unsaved Tasks or Canvas edit. Save or discard it first, or restore as a copy.';
	const note = notepadService.getNote(path);
	if (
		note &&
		(note.content !== note.base || ['loading', 'saving', 'conflict', 'error'].includes(note.status))
	)
		return 'Notepad has an unsaved or unresolved draft. Save it first, or restore as a copy.';
	for (const service of [officeService, sheetsService]) {
		const state = service.snapshot();
		if (state.path === path && state.engineRequested)
			return `This file is loaded in ${service.appName}. Close it first so no pending edit can overwrite the restored version, or restore as a copy.`;
	}
	return null;
}
async function suggestedCopy(path: string) {
	const name = workspaceBasename(path),
		dot = /\.(tasks|canvas|project|shortcut|inbox|app)\.json$/.test(name)
			? name.lastIndexOf('.', name.length - 6)
			: name.lastIndexOf('.');
	const stem = dot > 0 ? name.slice(0, dot) : name,
		ext = dot > 0 ? name.slice(dot) : '';
	let candidate = `${workspaceDirname(path)}/${stem} (restored)${ext}`,
		suffix = 2;
	while (await workspaceService.exists(candidate))
		candidate = `${workspaceDirname(path)}/${stem} (restored ${suffix++})${ext}`;
	return candidate;
}
export type VersionReview = Awaited<ReturnType<typeof readReview>>;
async function readReview(id: string) {
	await workspaceService.ready();
	await notepadService.ready();
	const version = await readVersion(id);
	const current = await currentFile(version.path);
	let diff: ReturnType<typeof textDiff> | null = null;
	let semantic: SemanticDiff | null = null;
	if (version.recovery) {
		const before = version.before ? decodeText(await versionBytes(version, 'before')) : '';
		const after = decodeText(await versionBytes(version, 'after'));
		if (before !== null && after !== null) {
			diff = textDiff(before, after);
			semantic = semanticDiff(version.path, before, after);
		}
	}
	const blocked = !version.recovery
		? version.reason!
		: !version.before
			? 'This change created a new file. There is no previous file to restore; save a copy of the result instead.'
			: version.status !== 'saved'
				? 'This save was not confirmed. Recover a snapshot as a copy instead.'
				: !current ||
					  !current.token ||
					  current.token !== version.afterToken ||
					  current.revision !== version.after.revision
					? 'The file has changed, moved, or been removed since this save. Restore as a copy to keep later work.'
					: draftBlock(version.path);
	return {
		version,
		current,
		diff,
		semantic,
		canRestore: !blocked,
		blocked,
		suggestedCopy: await suggestedCopy(version.path),
	};
}

export const reviewService = {
	subscribe: subscribeHistory,
	async list() {
		await workspaceService.ready();
		const [versions, sessions] = await Promise.all([listVersions(), listSessions()]);
		return {
			versions: versions.versions,
			sessions: sessions.sessions,
			warnings: [...versions.warnings, ...sessions.warnings],
			limits: HISTORY_LIMITS,
		};
	},
	read: readReview,
	async session(
		input: {
			id?: string;
			expectedRevision?: number;
			title: string;
			status: 'working' | 'completed';
			summary: string;
			questions: string[];
			results: string[];
			versionIds: string[];
			activityIds: string[];
		},
		actor: ActivityActor = 'human',
		signal?: AbortSignal,
	) {
		return workspaceService.mutate(async () => {
			signal?.throwIfAborted();
			await workspaceService.ready();
			const { sessions } = await listSessions();
			const previous = input.id ? sessions.find((s) => s.id === input.id) : undefined;
			if (input.id && !previous)
				throw new AppError('SESSION_MISSING', 'This work session was not found.');
			if (previous && input.expectedRevision !== previous.revision)
				throw new AppError(
					'SESSION_CHANGED',
					'This summary changed since it was opened. Read the latest summary before saving again.',
				);
			if (!previous && sessions.length >= HISTORY_LIMITS.sessions)
				throw new AppError(
					'SESSION_LIMIT',
					'The workspace has 60 work sessions. Update an existing session instead.',
				);
			if (
				!input.title.trim() ||
				input.title.length > 120 ||
				input.summary.length > 4000 ||
				!['working', 'completed'].includes(input.status)
			)
				throw new AppError(
					'INVALID_INPUT',
					'Use a title up to 120 characters and a summary up to 4000 characters.',
				);
			for (const values of [input.questions, input.results, input.versionIds, input.activityIds])
				if (
					!Array.isArray(values) ||
					values.length > 50 ||
					values.some((v) => typeof v !== 'string' || !v.trim() || v.length > 2048)
				)
					throw new AppError(
						'INVALID_INPUT',
						'Lists support up to 50 non-empty strings, each up to 2048 characters.',
					);
			const versionIds = [...new Set(input.versionIds)];
			for (const id of versionIds) await readVersion(id);
			const available = [...activityService.list(120), ...(previous?.activities ?? [])];
			const activities = [...new Set(input.activityIds)].map((id) => {
				const entry = available.find((e) => e.id === id);
				if (!entry)
					throw new AppError(
						'ACTIVITY_MISSING',
						`Activity ${id} is no longer available. Refresh activity_list.`,
					);
				return entry;
			});
			const results = [...new Set(input.results.map(editablePath))];
			for (const path of results) await workspaceService.stat(path);
			const now = new Date().toISOString();
			const session: WorkSession = {
				id: previous?.id ?? crypto.randomUUID(),
				revision: (previous?.revision ?? 0) + 1,
				actor: previous?.actor ?? actor,
				createdAt: previous?.createdAt ?? now,
				updatedAt: now,
				title: input.title.trim(),
				status: input.status,
				summary: input.summary,
				questions: input.questions,
				results,
				versionIds,
				activities,
			};
			signal?.throwIfAborted();
			await saveSession(session);
			activityService.record({
				actor,
				action: input.status === 'completed' ? 'Work ready for review' : 'Work session updated',
				detail: session.title,
				sessionId: session.id,
			});
			return session;
		});
	},
	async restore(
		input: {
			versionId: string;
			mode: 'replace' | 'copy';
			side?: 'before' | 'after';
			destination?: string;
			expectedCurrentToken?: string;
		},
		actor: ActivityActor = 'human',
		signal?: AbortSignal,
	) {
		await workspaceService.ready();
		await notepadService.ready();
		return workspaceService.mutate(async () => {
			signal?.throwIfAborted();
			const version = await readVersion(input.versionId);
			const side = input.side ?? 'before';
			if (!['replace', 'copy'].includes(input.mode) || !['before', 'after'].includes(side))
				throw new AppError('INVALID_INPUT', 'Choose replace or copy, and before or after.');
			if (input.mode === 'replace' && side !== 'before')
				throw new AppError(
					'INVALID_INPUT',
					'In-place restoration restores the previous version only.',
				);
			const bytes = await versionBytes(version, side);
			const path = editablePath(input.mode === 'copy' ? (input.destination ?? '') : version.path);
			if (input.mode === 'copy') {
				if (workspaceExtension(path) !== workspaceExtension(version.path))
					throw new AppError(
						'INVALID_PATH',
						'Keep the original file extension for the restored copy.',
					);
				if (await workspaceService.exists(path))
					throw new AppError(
						'PATH_EXISTS',
						'The copy destination already exists. Choose a new filename.',
					);
			} else {
				const current = await currentFile(path);
				if (
					version.status !== 'saved' ||
					!current?.token ||
					current.token !== version.afterToken ||
					current.token !== input.expectedCurrentToken ||
					current.revision !== version.after.revision
				)
					throw new AppError(
						'RESTORE_CONFLICT',
						'The original is no longer at the reviewed version. Nothing was overwritten.',
						'Use review_read, or restore as a copy with a new destination.',
					);
				const blocked = draftBlock(path);
				if (blocked) throw new AppError('OPEN_DRAFT', blocked);
			}
			await zenfs.promises.mkdir(workspaceDirname(path), { recursive: true });
			if ((await zenfs.promises.realpath(workspaceDirname(path))) !== workspaceDirname(path))
				throw new AppError('INVALID_PATH', 'Do not restore through a symbolic-link folder.');
			const next = await prepareVersion(path, bytes, actor);
			// UI drafts can change while the snapshot is being persisted.
			if (input.mode === 'replace') {
				const blocked = draftBlock(path);
				if (blocked) throw new AppError('OPEN_DRAFT', blocked);
			}
			signal?.throwIfAborted();
			await zenfs.promises.writeFile(
				path,
				bytes,
				input.mode === 'copy' ? { flag: 'wx' } : undefined,
			);
			const recovery = await workspaceService.finishVersion(next);
			await workspaceService.refresh();
			activityService.record({
				actor,
				action: input.mode === 'copy' ? 'Version restored as a copy' : 'Previous version restored',
				detail: `Recovered ${side === 'before' ? 'the previous version of' : 'the saved result of'} ${version.path}.`,
				path,
				versionId: recovery.versionId,
			});
			return {
				entry: await workspaceService.stat(path),
				...recovery,
				restoredFrom: version.id,
				side,
			};
		});
	},
};
