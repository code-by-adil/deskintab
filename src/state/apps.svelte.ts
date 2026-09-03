import { appIds, type AppID } from '🍎/configs/apps/apps-config';

export type { AppID } from '🍎/configs/apps/apps-config';

function initialAppValues<T>(value: T): Record<AppID, T> {
	return Object.fromEntries(appIds.map((id) => [id, value])) as Record<AppID, T>;
}

class DesktopState {
	open = $state({ ...initialAppValues(false), finder: true });
	minimized = $state(initialAppValues(false));
	maximized = $state(initialAppValues(false));
	is_being_dragged = $state(false);
	#stack = $state<AppID[]>(['finder']);

	get active(): AppID {
		return this.#stack[this.#stack.length - 1];
	}

	set active(appId: AppID) {
		this.#stack = [...this.#stack.filter((id) => id !== appId), appId];
	}

	get z_indices(): Record<AppID, number> {
		return Object.fromEntries(appIds.map((id) => [id, this.#stack.indexOf(id) + 1])) as Record<
			AppID,
			number
		>;
	}
}

export const apps = new DesktopState();

export function openApp(appId: AppID) {
	apps.open[appId] = true;
	apps.minimized[appId] = false;
	apps.active = appId;
}

function activateFrontmostApp(excluding: AppID) {
	const nextApp = (Object.keys(apps.open) as AppID[])
		.filter((appId) => appId !== excluding && apps.open[appId] && !apps.minimized[appId])
		.sort((left, right) => apps.z_indices[right] - apps.z_indices[left])[0];

	apps.active = nextApp ?? 'finder';
}

export function closeApp(appId: AppID) {
	apps.open[appId] = false;
	apps.minimized[appId] = false;
	apps.maximized[appId] = false;

	if (apps.active === appId) activateFrontmostApp(appId);
}

export function minimizeApp(appId: AppID) {
	apps.minimized[appId] = true;

	if (apps.active === appId) activateFrontmostApp(appId);
}
