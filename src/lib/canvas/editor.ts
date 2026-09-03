import { cloneElement, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { toStore } from 'svelte/store';
import '@excalidraw/excalidraw/index.css';
import { preferences } from '🍎/state/preferences.svelte';
import { loadCanvasSDK } from './sdk';
import { canvasService } from './canvas';
import { revealDesktop } from '../desktop/files';

// React is confined to this lazy-loaded drawing engine. Files, persistence,
// revision checks, and WebMCP remain shared TypeScript services.
export async function mountCanvas(host: HTMLElement) {
	await canvasService.ensure();
	const sdk = await loadCanvasSDK();
	if (!host.isConnected) return () => {};
	const root = createRoot(host);
	let detach: (() => void) | undefined, refresh: (() => void) | undefined;
	const windowElement = host.closest('[data-app-id]') ?? host.parentElement!;
	const positions = new MutationObserver(() => refresh?.());
	positions.observe(windowElement, { attributes: true, attributeFilter: ['style'] });
	const saveKey = (event: KeyboardEvent) => {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
			event.preventDefault();
			event.stopPropagation();
			void canvasService.save().catch(canvasService.reportError);
		}
	};
	host.addEventListener('keydown', saveKey, true);
	const input = () => canvasService.input();
	host.addEventListener('pointerdown', input, true);
	host.addEventListener('keydown', input, true);
	host.addEventListener('paste', input, true);
	host.addEventListener('drop', input, true);
	const beforeUnload = (event: BeforeUnloadEvent) => {
		if (canvasService.hasPendingEdits()) {
			event.preventDefault();
			event.returnValue = '';
		}
	};
	window.addEventListener('beforeunload', beforeUnload);
	const editor = createElement(
		sdk.Excalidraw,
		{
			initialData: { ...canvasService.current(), scrollToContent: true },
			excalidrawAPI: (api) => {
				detach?.();
				detach = canvasService.attach(api);
				refresh = () => api.refresh();
			},
			onChange: (elements, appState, files) => canvasService.changed(elements, appState, files),
			onPointerDown: () => canvasService.pointer(true),
			onPointerUp: () => canvasService.pointer(false),
			handleKeyboardGlobally: false,
			autoFocus: false,
			aiEnabled: false,
			validateEmbeddable: false,
			UIOptions: {
				canvasActions: {
					loadScene: false,
					saveToActiveFile: false,
					saveAsImage: false,
					export: false,
					toggleTheme: false,
				},
			},
			onLinkOpen: (element, event) => {
				event.preventDefault();
				const link = element.link;
				if (link?.startsWith('/') && !link.startsWith('//'))
					void revealDesktop({ path: link }).catch(canvasService.reportError);
				else
					canvasService.reportError(
						new Error('Canvas links open workspace files only. External links are not opened.'),
					);
			},
		},
		createElement(
			sdk.MainMenu,
			null,
			createElement(sdk.MainMenu.DefaultItems.ClearCanvas),
			createElement(sdk.MainMenu.DefaultItems.ChangeCanvasBackground),
			createElement(sdk.MainMenu.DefaultItems.Help),
		),
	);
	// Updating the controlled theme on the same component preserves selection and undo history.
	const unsubscribeTheme = toStore(() => preferences.theme.scheme).subscribe((theme) => {
		root.render(cloneElement(editor, { theme }));
	});
	return () => {
		unsubscribeTheme();
		positions.disconnect();
		host.removeEventListener('keydown', saveKey, true);
		host.removeEventListener('pointerdown', input, true);
		host.removeEventListener('keydown', input, true);
		host.removeEventListener('paste', input, true);
		host.removeEventListener('drop', input, true);
		window.removeEventListener('beforeunload', beforeUnload);
		detach?.();
		root.unmount();
	};
}
