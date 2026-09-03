import { apps, type AppID } from '../../state/apps.svelte';
import type { TaskStatus } from '../tasks/tasks';
import type { ActivityActor } from '../activity/activity';

export const isAppVisible = (id: AppID) => apps.open[id] && !apps.minimized[id];

export type TasksInteractionContext = {
	path: string | null;
	revision: string | null;
	selectedTaskId: string | null;
	selectedTaskTitle: string | null;
	filter: 'all' | TaskStatus;
	draft: {
		dirty: boolean;
		stale: boolean;
		isNew: boolean;
		path: string;
		baseRevision: string;
	} | null;
	busy: boolean;
	dialog: 'open' | 'new-list' | null;
};
type ActivityInteractionContext = {
	tab: 'activity' | 'review';
	filter: ActivityActor | 'all' | 'terminal-events';
};
export type ReviewSelectionContext = {
	selectedVersionId: string | null;
	selectedSessionId: string | null;
	path: string | null;
	reading: boolean;
	busy: boolean;
	summaryDraft: { sessionId: string | null; isNew: boolean } | null;
};

let readTasks: (() => TasksInteractionContext) | undefined;
export type ProjectsInteractionContext = {
	path: string | null;
	revision: string | null;
	projectId: string | null;
	selectedRunId: string | null;
	view: 'overview' | 'handoff' | 'work' | 'context';
	draft: { dirty: boolean; stale: boolean; path: string; baseRevision: string } | null;
	busy: boolean;
};
let readProjects: (() => ProjectsInteractionContext) | undefined;
let readActivity: (() => ActivityInteractionContext) | undefined;
let readReview: (() => ReviewSelectionContext) | undefined;

// Components lend a live getter while mounted. No copied selection or draft
// contents are stored here, and hidden windows never expose selected IDs.
export function connectTasksContext(read: () => TasksInteractionContext) {
	readTasks = read;
	return () => {
		if (readTasks === read) readTasks = undefined;
	};
}
export function connectActivityContext(read: () => ActivityInteractionContext) {
	readActivity = read;
	return () => {
		if (readActivity === read) readActivity = undefined;
	};
}
export function connectReviewContext(read: () => ReviewSelectionContext) {
	readReview = read;
	return () => {
		if (readReview === read) readReview = undefined;
	};
}
export function tasksInteractionContext() {
	return isAppVisible('tasks') ? (readTasks?.() ?? null) : null;
}
export function connectProjectsContext(read: () => ProjectsInteractionContext) {
	readProjects = read;
	return () => {
		if (readProjects === read) readProjects = undefined;
	};
}
export function projectsInteractionContext() {
	return isAppVisible('projects') ? (readProjects?.() ?? null) : null;
}
export function reviewInteractionContext() {
	if (!isAppVisible('activity')) return null;
	const activity = readActivity?.();
	if (!activity) return null;
	const review = activity.tab === 'review' ? readReview?.() : null;
	return {
		...activity,
		selectedVersionId: review?.selectedVersionId ?? null,
		selectedSessionId: review?.selectedSessionId ?? null,
		path: review?.path ?? null,
		reading: review?.reading ?? false,
		busy: review?.busy ?? false,
		summaryDraft: review?.summaryDraft ?? null,
	};
}
