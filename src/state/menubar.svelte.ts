import { apps_config } from '🍎/configs/apps/apps-config';
import { issueDesktopCommand, type DesktopCommand } from '🍎/lib/desktop/commands';
import { notepadView } from '🍎/lib/workspace/notepad-view.svelte';
import { finderState } from '🍎/lib/workspace/finder-state.svelte';
import { apps, openApp, type AppID } from './apps.svelte.ts';

export interface MenuItemConfig {
	title: string;
	disabled?: boolean;
	shortcut?: string;
	checked?: boolean;
	breakAfter?: boolean;
	action?: () => void;
}

export interface MenuConfig {
	title: string;
	menu: Record<string, MenuItemConfig>;
}

export const menubar_state = $state({ active: '' as string });

function command(appId: AppID, desktopCommand: DesktopCommand, disabled = false): MenuItemConfig {
	return {
		title: desktopCommand
			.split('-')
			.map((part) => part[0].toUpperCase() + part.slice(1))
			.join(' '),
		disabled,
		action: disabled ? undefined : () => issueDesktopCommand(appId, desktopCommand),
	};
}

export function getActiveMenus(): Record<string, MenuConfig> {
	const appId = apps.active as AppID;
	const appTitle = apps_config[appId].title;
	const rich = notepadView.editor.ready && !notepadView.source && !notepadView.plain;
	const noFinderSelection = !finderState.selectedPath;
	const fileMenu: Record<string, MenuItemConfig> =
		appId === 'finder'
			? {
					newFolder: command(appId, 'new-folder'),
					newDocument: { ...command(appId, 'new-document'), breakAfter: true },
					open: command(appId, 'open', noFinderSelection),
					rename: command(appId, 'rename', noFinderSelection),
					duplicate: command(appId, 'duplicate', noFinderSelection),
					trash: command(appId, 'trash', noFinderSelection),
				}
			: appId === 'textedit'
				? {
						newDocument: { ...command(appId, 'new-document'), title: 'New Note', shortcut: '⌘N' },
						trash: { ...command(appId, 'trash'), title: 'Move to Trash' },
						rename: command(appId, 'rename'),
						download: { ...command(appId, 'download'), title: 'Download Note' },
						save: { ...command(appId, 'save'), shortcut: '⌘S' },
						close: command(appId, 'close'),
					}
				: appId === 'tasks' || appId === 'canvas' || appId === 'projects' || appId === 'shortcuts'
					? {
							newDocument: {
								...command(appId, 'new-document'),
								title:
									appId === 'shortcuts'
										? 'New shortcut'
										: appId === 'projects'
											? 'New project'
											: appId === 'tasks'
												? 'New Task List'
												: 'New Canvas',
							},
							open: command(appId, 'open'),
							save: command(appId, 'save'),
							...(appId === 'canvas'
								? { download: { ...command(appId, 'download'), title: 'Export PNG' } }
								: {}),
							close: command(appId, 'close'),
						}
					: appId === 'documents' || appId === 'sheets'
						? {
								newDocument: {
									...command(appId, 'new-document'),
									title: appId === 'sheets' ? 'New Spreadsheet' : 'New Document',
								},
								open: command(appId, 'open'),
								save: command(appId, 'save'),
								close: command(appId, 'close'),
							}
						: appId === 'preview'
							? {
									open: command(appId, 'open'),
									download: command(appId, 'download'),
									close: command(appId, 'close'),
								}
							: appId === 'terminal' || appId === 'calculator'
								? {
										clear: { ...command(appId, 'clear'), breakAfter: true },
										close: command(appId, 'close'),
									}
								: { close: command(appId, 'close') };
	const editMenu: Record<string, MenuItemConfig> =
		appId === 'textedit'
			? {
					undo: { ...command(appId, 'undo', !rich || !notepadView.editor.undo), shortcut: '⌘Z' },
					redo: {
						...command(appId, 'redo', !rich || !notepadView.editor.redo),
						shortcut: '⇧⌘Z',
						breakAfter: true,
					},
					find: { ...command(appId, 'find'), title: 'Find Notes', shortcut: '⌥⌘F' },
					selectAll: { ...command(appId, 'select-all'), shortcut: '⌘A' },
				}
			: appId === 'finder' || appId === 'preview'
				? { find: command(appId, 'find') }
				: appId === 'calculator'
					? { copyResult: command(appId, 'copy-result') }
					: { unavailable: { title: 'No Editing Commands', disabled: true } };

	return {
		apple: {
			title: 'Apple',
			menu: {
				about: { title: 'About Deskstead', disabled: true, breakAfter: true },
				home: { title: 'Home & Workspace…', action: () => openApp('home') },
				wallpaper: {
					title: 'Desktop & Wallpaper…',
					action: () => {
						apps.open.wallpapers = true;
						apps.minimized.wallpapers = false;
						apps.active = 'wallpapers';
					},
				},
			},
		},
		default: {
			title: appTitle,
			menu: {
				about: { title: `About ${appTitle}`, disabled: true, breakAfter: true },
				close: { ...command(appId, 'close'), title: `Close ${appTitle}` },
			},
		},
		file: { title: 'File', menu: fileMenu },
		edit: { title: 'Edit', menu: editMenu },
		...(appId === 'textedit'
			? {
					format: {
						title: 'Format',
						menu: {
							title: {
								...command(appId, 'title', !rich),
								checked: rich && notepadView.editor.heading === 1,
								shortcut: '⌥⌘1',
							},
							heading: {
								...command(appId, 'heading', !rich),
								checked: rich && notepadView.editor.heading === 2,
								shortcut: '⌥⌘2',
							},
							subheading: {
								...command(appId, 'subheading', !rich),
								checked: rich && notepadView.editor.heading === 3,
								shortcut: '⌥⌘3',
							},
							body: {
								...command(appId, 'body', !rich),
								checked: rich && notepadView.editor.heading === 0,
								shortcut: '⌥⌘0',
								breakAfter: true,
							},
							bold: {
								...command(appId, 'bold', !rich),
								checked: rich && notepadView.editor.bold,
								shortcut: '⌘B',
							},
							italic: {
								...command(appId, 'italic', !rich),
								checked: rich && notepadView.editor.italic,
								shortcut: '⌘I',
								breakAfter: true,
							},
							bullet: {
								...command(appId, 'bullet', !rich),
								title: 'Bulleted List',
								checked: rich && notepadView.editor.list === 'bullet',
							},
							ordered: {
								...command(appId, 'ordered', !rich),
								title: 'Numbered List',
								checked: rich && notepadView.editor.list === 'ordered',
							},
							checklist: {
								...command(appId, 'checklist', !rich),
								checked: rich && notepadView.editor.list === 'checklist',
								shortcut: '⇧⌘L',
								breakAfter: true,
							},
							link: { ...command(appId, 'add-link', !rich), title: 'Add Link…', shortcut: '⌘K' },
						},
					},
				}
			: {}),
		view: {
			title: 'View',
			menu:
				appId === 'textedit'
					? {
							notes: {
								...command(appId, 'toggle-notes'),
								title: notepadView.sidebar ? 'Hide Notes' : 'Show Notes',
								shortcut: '⇧⌘\\',
							},
							source: {
								...command(appId, 'toggle-source', notepadView.plain),
								title: notepadView.source ? 'Show Formatted Note' : 'Show Markdown Source',
								breakAfter: true,
							},
							zoom: command(appId, 'zoom'),
						}
					: { zoom: command(appId, 'zoom') },
		},
		...(appId !== 'textedit'
			? {
					go: {
						title: 'Go',
						menu:
							appId === 'finder'
								? {
										projects: command(appId, 'go-projects'),
										documents: command(appId, 'go-documents'),
										notes: command(appId, 'go-notes'),
										trash: command(appId, 'go-trash'),
									}
								: { unavailable: { title: 'Available in Finder', disabled: true } },
					},
				}
			: {}),
		window: {
			title: 'Window',
			menu: {
				minimize: command(appId, 'minimize'),
				zoom: command(appId, 'zoom'),
				close: command(appId, 'close'),
			},
		},
		help: {
			title: 'Help',
			menu: { hint: { title: 'Use Files, Terminal, and Activity together', disabled: true } },
		},
	};
}
