import { preferences, type Theme } from '../../state/preferences.svelte';
import {
	wallpapers_config,
	wallpaperIds,
	type WallpaperID,
} from '../../configs/wallpapers/wallpaper.config';
export function wallpaperContext() {
	return {
		id: preferences.wallpaper.id,
		name: wallpapers_config[preferences.wallpaper.id].name,
		matchTheme: preferences.wallpaper.canControlTheme,
		theme: preferences.theme.scheme,
		reducedMotion: preferences.reduced_motion,
	};
}
export function wallpaperCatalog() {
	return wallpaperIds.map((id) => ({
		id,
		name: wallpapers_config[id].name,
		type: wallpapers_config[id].type,
	}));
}
export function setAppearance(options: {
	id?: WallpaperID;
	matchTheme?: boolean;
	theme?: Theme['scheme'];
	reducedMotion?: boolean;
}) {
	if (options.id !== undefined) preferences.wallpaper.id = options.id;
	if (options.matchTheme !== undefined) preferences.wallpaper.canControlTheme = options.matchTheme;
	if (options.theme !== undefined) {
		preferences.wallpaper.canControlTheme = false;
		preferences.theme.scheme = options.theme;
	}
	if (options.reducedMotion !== undefined) preferences.reduced_motion = options.reducedMotion;
}
