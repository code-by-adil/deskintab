import { tick } from 'svelte';
import type { AppID } from '../../state/apps.svelte';
import { AppError } from '../errors';

export type AppNavigation = {
	home: { pane?: 'preferences' | 'toolbox' | 'packs'; skillPath?: string };
	projects: { view?: 'overview' | 'handoff' | 'work' | 'context'; runId?: string };
	tasks: { taskId?: string; filter?: 'all' | 'todo' | 'in-progress' | 'done' };
	inbox: { filter?: 'all' | 'new' | 'filed' | 'done' };
	finder: { query?: string; selectedPath?: string };
	textedit: {
		mode?: 'formatted' | 'markdown' | 'plain';
		sidebar?: boolean;
		selection?: { start: number; end: number };
	};
	preview: { zoom?: number; textView?: boolean };
	activity: {
		tab?: 'activity' | 'review';
		filter?: 'all' | 'human' | 'agent' | 'terminal' | 'system' | 'terminal-events';
		versionId?: string;
		sessionId?: string;
	};
	review: { versionId?: string; sessionId?: string };
};
type NavigationId = keyof AppNavigation;
type Connection<K extends NavigationId> = {
	read: () => Record<string, unknown>;
	navigate: (options: AppNavigation[K], signal: AbortSignal) => void | Promise<void>;
	ready?: () => boolean;
};
const connections = new Map<NavigationId, Connection<NavigationId>>();
const mounted = new Map<AppID, object>();

export function connectAppNavigation<K extends NavigationId>(id: K, connection: Connection<K>) {
	const value = connection as Connection<NavigationId>;
	connections.set(id, value);
	return () => {
		if (connections.get(id) === value) connections.delete(id);
	};
}
export function appNavigationContext(id: NavigationId) {
	return connections.get(id)?.read() ?? null;
}
export function markAppMounted(id: AppID) {
	const token = {};
	mounted.set(id, token);
	return () => {
		if (mounted.get(id) === token) mounted.delete(id);
	};
}
export async function waitForApp(id: AppID, signal: AbortSignal) {
	await waitUntil(
		() => mounted.has(id) && (connections.get(id as NavigationId)?.ready?.() ?? true),
		signal,
	);
	await tick();
}
export async function waitUntil(
	ready: () => boolean,
	signal: AbortSignal,
	message = 'The app is still loading. Retry shortly.',
) {
	const deadline = Date.now() + 10_000;
	while (!ready()) {
		signal.throwIfAborted();
		if (Date.now() >= deadline) throw new AppError('APP_NOT_READY', message);
		await new Promise<void>((resolve) => setTimeout(resolve, 20));
	}
	signal.throwIfAborted();
}
export async function navigateApp<K extends NavigationId>(
	id: K,
	options: AppNavigation[K],
	signal: AbortSignal,
) {
	await waitUntil(() => connections.has(id), signal);
	const connection = connections.get(id)!;
	await connection.navigate(options, signal);
	await tick();
	return connection.read();
}

export type WindowOperation = {
	action: 'close' | 'minimize' | 'maximize' | 'restore' | 'move';
	x?: number;
	y?: number;
};
type WindowConnection = {
	read: () => Record<string, unknown>;
	control: (options: WindowOperation) => Promise<void>;
};
const windows = new Map<AppID, WindowConnection>();
export function connectWindow(id: AppID, connection: WindowConnection) {
	windows.set(id, connection);
	return () => {
		if (windows.get(id) === connection) windows.delete(id);
	};
}
export function windowContext(id: AppID) {
	return windows.get(id)?.read() ?? null;
}
export async function controlWindow(id: AppID, options: WindowOperation) {
	const connection = windows.get(id);
	if (!connection) throw new AppError('APP_NOT_OPEN', 'Open this app with desktop_reveal first.');
	await connection.control(options);
	await tick();
	return connection.read();
}
