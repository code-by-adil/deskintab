import { colors } from '🍎/configs/theme/colors.config.ts';
import { wallpapers_config, type WallpaperID } from '🍎/configs/wallpapers/wallpaper.config.ts';

export type WallpaperSettings = {
	id: WallpaperID;
	image: string;
	canControlTheme: boolean;
};

export type Theme = {
	scheme: 'light' | 'dark';
	primaryColor: keyof typeof colors;
};

interface Preferences {
	reduced_motion: boolean;
	theme: Theme;
	wallpaper: WallpaperSettings;
}

function readStoredValue(key: string): unknown {
	try {
		const value = localStorage.getItem(key);
		return value === null ? undefined : JSON.parse(value);
	} catch {
		return undefined;
	}
}

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function loadPreferences(): Preferences {
	const saved = record(readStoredValue('macos:preferences'));
	try {
		localStorage.removeItem('macos:setting:should-show-notch');
	} catch {
		// Retired settings must not block startup when browser storage is unavailable.
	}
	const theme = record(saved.theme);
	const wallpaper = record(saved.wallpaper);
	const wallpaperId =
		typeof wallpaper.id === 'string' && Object.hasOwn(wallpapers_config, wallpaper.id)
			? (wallpaper.id as WallpaperID)
			: 'ventura';
	const scheme =
		theme.scheme === 'light' || theme.scheme === 'dark'
			? theme.scheme
			: matchMedia('(prefers-color-scheme: dark)').matches
				? 'dark'
				: 'light';

	return {
		reduced_motion:
			typeof saved.reduced_motion === 'boolean'
				? saved.reduced_motion
				: matchMedia('(prefers-reduced-motion)').matches,
		theme: {
			scheme,
			primaryColor:
				typeof theme.primaryColor === 'string' && Object.hasOwn(colors, theme.primaryColor)
					? (theme.primaryColor as Theme['primaryColor'])
					: 'blue',
		},
		wallpaper: {
			id: wallpaperId,
			image: wallpapers_config[wallpaperId].image,
			canControlTheme:
				typeof wallpaper.canControlTheme === 'boolean' ? wallpaper.canControlTheme : true,
		},
	};
}

export const preferences = $state(loadPreferences());

$effect.root(() => {
	$effect(() => {
		const serialized = JSON.stringify(preferences);
		try {
			localStorage.setItem('macos:preferences', serialized);
		} catch {
			// Keep settings usable for this page if browser storage is unavailable.
		}
	});

	$effect(() => {
		// Color scheme
		const { classList } = document.body;
		classList.remove('light', 'dark');
		classList.add(preferences.theme.scheme);

		// Primary color
		const colorObj = colors[preferences.theme.primaryColor][preferences.theme.scheme];
		document.body.style.setProperty('--system-color-primary', `hsl(${colorObj.hsl})`);
		document.body.style.setProperty('--system-color-primary-hsl', `${colorObj.hsl}`);
		document.body.style.setProperty(
			'--system-color-primary-contrast',
			`hsl(${colorObj.contrastHsl})`,
		);
		document.body.style.setProperty(
			'--system-color-primary-contrast-hsl',
			`${colorObj.contrastHsl}`,
		);
	});
});
