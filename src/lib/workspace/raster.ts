import { AppError } from '../errors';
import { workspaceService } from './workspace';

export function rasterMime(bytes: Uint8Array, path: string) {
	const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
	const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
	const webp =
		new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
		new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
	if (/\.png$/i.test(path) && png) return 'image/png';
	if (/\.jpe?g$/i.test(path) && jpeg) return 'image/jpeg';
	if (/\.webp$/i.test(path) && webp) return 'image/webp';
	throw new AppError(
		'INVALID_IMAGE',
		'Use a PNG, JPEG, or WebP whose contents match its extension.',
	);
}
export function base64Bytes(bytes: Uint8Array) {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 8192)
		binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
	return btoa(binary);
}
export async function pngContent(canvas: HTMLCanvasElement) {
	const blob = await new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(value) =>
				value
					? resolve(value)
					: reject(new AppError('IMAGE_RENDER_FAILED', 'Could not render a PNG.')),
			'image/png',
		),
	);
	return {
		type: 'image' as const,
		mimeType: 'image/png',
		data: base64Bytes(new Uint8Array(await blob.arrayBuffer())),
	};
}
export async function readWorkspaceRaster(path: string, signal?: AbortSignal) {
	if (!path.startsWith('/') || path.length > 2048)
		throw new AppError('INVALID_PATH', 'Use an absolute workspace image path.');
	const entry = await workspaceService.stat(path);
	if (entry.kind !== 'file' || entry.size > 5_900_000)
		throw new AppError(
			'INVALID_IMAGE',
			'Choose a PNG, JPEG, or WebP file under 5.9 MB so its embedded data fits Canvas.',
		);
	const bytes = await workspaceService.readBytes(path);
	if (bytes.length > 5_900_000) throw new AppError('INVALID_IMAGE', 'The image exceeds 5.9 MB.');
	const mimeType = rasterMime(bytes, path);
	const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: mimeType }));
	try {
		signal?.throwIfAborted();
		if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000)
			throw new AppError('INVALID_IMAGE', 'Choose an image with at most 40 million pixels.');
		const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
		const id = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
		return {
			id,
			mimeType,
			dataURL: `data:${mimeType};base64,${base64Bytes(bytes)}`,
			width: bitmap.width,
			height: bitmap.height,
		};
	} finally {
		bitmap.close();
	}
}
