import { AppError } from '../errors';
export const isOfficeImagePath = (path: string) => /\.(png|jpe?g)$/i.test(path);
export const maxImageBytes = 10 * 1024 * 1024;

export async function prepareOfficeImage(path: string, bytes: Uint8Array) {
	if (!isOfficeImagePath(path))
		throw new AppError('UNSUPPORTED_IMAGE', 'Choose a PNG or JPEG image.');
	if (bytes.length > maxImageBytes)
		throw new AppError('FILE_TOO_LARGE', 'Choose an image smaller than 10 MiB.');
	const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
	const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
	if (/\.png$/i.test(path) ? !png : !jpeg)
		throw new AppError('INVALID_IMAGE', 'This file does not contain a valid PNG or JPEG image.');
	try {
		const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
		const { width, height } = bitmap;
		bitmap.close();
		// Use 96 dpi, reducing oversized images to a comfortable page size.
		const scale = Math.min(2540 / 96, 15000 / width, 18000 / height);
		return {
			bytes,
			extension: png ? 'png' : 'jpg',
			width: Math.max(1, Math.round(width * scale)),
			height: Math.max(1, Math.round(height * scale)),
		};
	} catch {
		throw new AppError(
			'INVALID_IMAGE',
			'This image could not be decoded. Choose another PNG or JPEG.',
		);
	}
}
