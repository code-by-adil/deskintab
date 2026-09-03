// React and the drawing engine are loaded only when Canvas work needs them.
let pending: Promise<typeof import('@excalidraw/excalidraw')> | undefined;
export function loadCanvasSDK() {
	(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw/';
	return (pending ??= import('@excalidraw/excalidraw').catch((error) => {
		pending = undefined;
		throw error;
	}));
}
