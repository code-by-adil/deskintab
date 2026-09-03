import type { Component } from 'svelte';

interface AppConfig {
	title: string;
	icon: string;
	width: number;
	height: number;
	expandable?: boolean;
	dock_breaks_before?: boolean;
	load: () => Promise<{ default: Component }>;
}

const appDefinitions = {
	home: {
		title: 'Home',
		icon: '/app-icons/home.svg',
		width: 860,
		height: 700,
		load: () => import('🍎/components/apps/Home/Home.svelte'),
	},
	projects: {
		title: 'Projects',
		icon: '/app-icons/projects.svg',
		width: 940,
		height: 720,
		load: () => import('🍎/components/apps/Projects/Projects.svelte'),
	},
	inbox: {
		title: 'Inbox',
		icon: '/app-icons/inbox.svg',
		width: 900,
		height: 700,
		load: () => import('🍎/components/apps/Inbox/Inbox.svelte'),
	},
	finder: {
		title: 'Finder',
		icon: '/app-icons/finder/256.webp',
		width: 820,
		height: 540,
		load: () => import('🍎/components/apps/Finder/Finder.svelte'),
	},
	shortcuts: {
		title: 'Shortcuts',
		icon: '/app-icons/shortcuts.svg',
		width: 960,
		height: 720,
		load: () => import('🍎/components/apps/Shortcuts/Shortcuts.svelte'),
	},
	textedit: {
		title: 'Notepad',
		icon: '/app-icons/notes/256.png',
		width: 860,
		height: 580,
		load: () => import('🍎/components/apps/Notepad/Notepad.svelte'),
	},
	documents: {
		title: 'Documents',
		icon: '/app-icons/documents.svg',
		width: 1100,
		height: 760,
		load: () => import('🍎/components/apps/Documents/Documents.svelte'),
	},
	sheets: {
		title: 'Sheets',
		icon: '/app-icons/sheets.svg',
		width: 1100,
		height: 720,
		load: () => import('🍎/components/apps/Sheets/Sheets.svelte'),
	},
	preview: {
		title: 'Preview',
		icon: '/app-icons/preview.svg',
		width: 740,
		height: 680,
		load: () => import('🍎/components/apps/Preview/Preview.svelte'),
	},
	tasks: {
		title: 'Tasks',
		icon: '/app-icons/tasks.svg',
		width: 760,
		height: 680,
		load: () => import('🍎/components/apps/Tasks/Tasks.svelte'),
	},
	canvas: {
		title: 'Canvas',
		icon: '/app-icons/canvas.svg',
		width: 1100,
		height: 700,
		load: () => import('🍎/components/apps/Canvas/Canvas.svelte'),
	},
	studio: {
		title: 'App Studio',
		icon: '/app-icons/studio.svg',
		width: 1000,
		height: 720,
		load: () => import('🍎/components/apps/Studio/Studio.svelte'),
	},
	terminal: {
		title: 'Terminal',
		icon: '/app-icons/terminal/256.png',
		width: 760,
		height: 470,
		load: () => import('🍎/components/apps/Terminal/Terminal.svelte'),
	},
	activity: {
		title: 'Activity',
		icon: '/app-icons/reminders/256.png',
		width: 560,
		height: 500,
		load: () => import('🍎/components/apps/Activity/Activity.svelte'),
	},
	calculator: {
		title: 'Calculator',
		icon: '/app-icons/calculator/256.webp',
		width: 250,
		height: 250 * 1.414,
		expandable: true,
		load: () => import('🍎/components/apps/Calculator/Calculator.svelte'),
	},
	wallpapers: {
		title: 'Wallpapers',
		icon: '/app-icons/wallpapers/256.webp',
		width: 800,
		height: 600,
		dock_breaks_before: true,
		load: () => import('🍎/components/apps/WallpaperApp/WallpaperSelectorApp.svelte'),
	},
} satisfies Record<string, AppConfig>;

export type AppID = keyof typeof appDefinitions;
export const apps_config: Record<AppID, AppConfig> = appDefinitions;
export const appIds = Object.keys(appDefinitions) as AppID[];
