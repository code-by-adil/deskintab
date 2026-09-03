import { AppError } from '../errors';
import type { RenderTask } from 'pdfjs-dist';
import { apps, openApp } from '../../state/apps.svelte';
import { workspaceService, type WorkspaceEntry } from '../workspace/workspace';
import { normalizeWorkspacePath, workspaceBasename } from '../workspace/path';
import { extractPdfPage, loadPdf } from './pdf';
import { pngContent } from '../workspace/raster';

export const isPreviewPath = (path: string) => /\.(pdf|png|jpe?g)$/i.test(path);
export type PreviewSnapshot = {
	path: string | null;
	kind: 'pdf' | 'image' | null;
	page: number;
	pages: number;
	text: string;
	textTruncated: boolean;
	revision: string | null;
	url: string | null;
	width: number;
	height: number;
	busy: boolean;
	error: string;
	renderKey: number;
	selection: { text: string; page: number; revision: string; truncated: boolean } | null;
};
type Pdf = Awaited<ReturnType<typeof loadPdf>>;
type Resource = {
	path: string;
	revision: string;
	url: string;
	blob: Blob;
	pdf?: Pdf;
	width: number;
	height: number;
	entry: WorkspaceEntry;
};
const sessionPath = '/System/preview.json';
const stamp = (entry: WorkspaceEntry) => `${entry.modifiedAt}:${entry.size}`;
function integer(value: number, low: number, high: number, label: string) {
	if (!Number.isInteger(value) || value < low || value > high)
		throw new AppError('INVALID_INPUT', `${label} must be between ${low} and ${high}.`);
	return value;
}
async function revision(bytes: Uint8Array) {
	const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
	return `sha256:${Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('')}`;
}
async function prepare(
	path: string,
	bytes: Uint8Array,
	entry: WorkspaceEntry,
	hash: string,
	signal?: AbortSignal,
): Promise<Resource> {
	if (!isPreviewPath(path))
		throw new AppError('UNSUPPORTED_PREVIEW', 'Preview opens PDF, PNG and JPEG files.');
	const isPdf = /\.pdf$/i.test(path);
	if (bytes.length > (isPdf ? 50 : 10) * 1024 * 1024)
		throw new AppError(
			'FILE_TOO_LARGE',
			`Use a ${isPdf ? 'PDF under 50' : 'PNG/JPEG under 10'} MiB.`,
		);
	const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
	const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
	if (
		isPdf
			? new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-'
			: /\.png$/i.test(path)
				? !png
				: !jpeg
	)
		throw new AppError(
			'INVALID_PREVIEW',
			'The file contents do not match its PDF, PNG or JPEG extension.',
		);
	const blob = new Blob([new Uint8Array(bytes)], {
		type: isPdf ? 'application/pdf' : png ? 'image/png' : 'image/jpeg',
	});
	const url = URL.createObjectURL(blob);
	let pdf: Pdf | undefined;
	try {
		let width = 0,
			height = 0;
		if (isPdf) pdf = await loadPdf({ data: new Uint8Array(bytes) }, signal);
		else {
			const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
			width = bitmap.width;
			height = bitmap.height;
			bitmap.close();
		}
		signal?.throwIfAborted();
		return { path, revision: hash, url, blob, pdf, width, height, entry };
	} catch (error) {
		URL.revokeObjectURL(url);
		await pdf?.destroy().catch(() => {});
		throw error;
	}
}

async function releaseResource(resource: Resource) {
	URL.revokeObjectURL(resource.url);
	await resource.pdf?.destroy().catch(() => {});
}

class PreviewService {
	#state: PreviewSnapshot = {
		path: null,
		kind: null,
		page: 1,
		pages: 0,
		text: '',
		textTruncated: false,
		revision: null,
		url: null,
		width: 0,
		height: 0,
		busy: false,
		error: '',
		renderKey: 0,
		selection: null,
	};
	#resource: Resource | undefined;
	#listeners = new Set<() => void>();
	#queue: Promise<unknown> = Promise.resolve();
	#generation = 0;
	#refreshing = false;
	#workspaceRevision = 0;
	#renderCancels = new Set<() => void>();
	#canvasQueues = new WeakMap<HTMLCanvasElement, Promise<void>>();
	constructor() {
		workspaceService.subscribe(() => {
			this.#workspaceRevision++;
			void this.#refresh();
		});
		workspaceService.subscribeToMoves((source, destination) => {
			const path = this.#state.path;
			if (path && (path === source || path.startsWith(source + '/'))) {
				const next = destination + path.slice(source.length);
				if (this.#resource) this.#resource.path = next;
				this.#update({ path: next });
				void this.#remember();
			}
		});
	}
	snapshot() {
		return this.#state;
	}
	subscribe(listener: () => void) {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}
	#update(part: Partial<PreviewSnapshot>) {
		this.#state = { ...this.#state, ...part };
		for (const fn of this.#listeners) fn();
	}
	async #remember() {
		try {
			await workspaceService.writeText(
				sessionPath,
				JSON.stringify({ path: this.#state.path, page: this.#state.page }),
				{ quiet: true },
			);
		} catch {
			this.#update({ error: 'The source is open, but its last-viewed page could not be saved.' });
		}
	}
	async #refresh() {
		if (this.#refreshing || this.#state.busy || !this.#resource || !apps.open.preview) return;
		this.#refreshing = true;
		const generation = this.#generation;
		try {
			// A write can arrive while the previous version is loading. Recheck
			// after each load, including notifications from our own checkpoint.
			while (generation === this.#generation && this.#resource && apps.open.preview) {
				const resource = this.#resource;
				const path = resource.path;
				const observedRevision = this.#workspaceRevision;
				const entry = await workspaceService.stat(path);
				if (resource !== this.#resource || path !== resource.path) continue;
				if (stamp(entry) === stamp(resource.entry)) {
					if (observedRevision !== this.#workspaceRevision) continue;
					return;
				}
				await this.#run(async (s) => {
					if (this.#resource?.path === path) await this.#open(path, undefined, s, false);
				});
			}
		} catch (error) {
			if (generation === this.#generation)
				this.#update({
					error: error instanceof Error ? error.message : 'The source is unavailable.',
				});
		} finally {
			this.#refreshing = false;
		}
	}
	#run<T>(fn: (signal: AbortSignal) => Promise<T>, external?: AbortSignal) {
		const generation = this.#generation;
		const result = this.#queue.then(async () => {
			if (generation !== this.#generation)
				throw new AppError('PREVIEW_CLOSED', 'Preview was closed. Reopen the source.');
			const controller = new AbortController();
			const close = () => controller.abort();
			this.#pendingAborts.add(close);
			const abort = () => controller.abort(external?.reason);
			external?.addEventListener('abort', abort, { once: true });
			if (external?.aborted) abort();
			this.#update({ busy: true, error: '' });
			try {
				controller.signal.throwIfAborted();
				return await fn(controller.signal);
			} catch (error) {
				if (generation === this.#generation)
					this.#update({
						error: error instanceof Error ? error.message : 'Preview could not open this source.',
					});
				throw error;
			} finally {
				this.#pendingAborts.delete(close);
				external?.removeEventListener('abort', abort);
				if (generation === this.#generation) {
					this.#update({ busy: false });
					void this.#refresh();
				}
			}
		});
		this.#queue = result.catch(() => {});
		return result;
	}
	#pendingAborts = new Set<() => void>();
	async #open(
		path: string,
		page: number | undefined,
		signal: AbortSignal,
		reveal = true,
		citedRevision?: string,
	) {
		path = normalizeWorkspacePath(path);
		if (!isPreviewPath(path))
			throw new AppError('UNSUPPORTED_PREVIEW', 'Preview opens PDF, PNG and JPEG files.');
		const entry = await workspaceService.stat(path);
		if (entry.kind !== 'file')
			throw new AppError('NOT_A_FILE', 'Choose a file rather than a folder.');
		if (entry.size > (/\.pdf$/i.test(path) ? 50 : 10) * 1024 * 1024)
			throw new AppError('FILE_TOO_LARGE', 'Choose a PDF under 50 MiB or an image under 10 MiB.');
		const bytes = await workspaceService.readBytes(path);
		const hash = await revision(bytes);
		const current = this.#resource;
		let resource = current?.path === path && current.revision === hash ? current : undefined;
		if (!resource) resource = await prepare(path, bytes, entry, hash, signal);
		resource.entry = entry;
		return this.#present(resource, page, signal, reveal, citedRevision);
	}
	async #present(
		resource: Resource,
		page: number | undefined,
		signal: AbortSignal,
		reveal = true,
		citedRevision?: string,
	) {
		const current = this.#resource;
		const path = resource.path;
		const loaded = resource !== current;
		let adopted = false;
		try {
			const pages = resource.pdf?.document.numPages || 1;
			const requestedPage =
				page ?? (current?.path === path ? Math.min(this.#state.page, pages) : 1);
			const number = integer(
				citedRevision && citedRevision !== resource.revision
					? Math.min(requestedPage, pages)
					: requestedPage,
				1,
				pages,
				'Page',
			);
			const text = resource.pdf
				? await extractPdfPage(resource.pdf.document, number)
				: { text: '', truncated: false };
			signal.throwIfAborted();
			if (loaded) {
				this.#release();
				this.#resource = resource;
				adopted = true;
			}
			const changed = loaded || this.#state.page !== number;
			this.#update({
				path,
				kind: resource.pdf ? 'pdf' : 'image',
				page: number,
				pages,
				text: text.text,
				textTruncated: text.truncated,
				revision: resource.revision,
				url: resource.url,
				width: resource.width,
				height: resource.height,
				...(changed ? { selection: null, renderKey: this.#state.renderKey + 1 } : {}),
			});
			if (reveal) openApp('preview');
			await this.#remember();
			return resource;
		} catch (error) {
			if (loaded && !adopted) await releaseResource(resource);
			throw error;
		}
	}
	open(path: string, page = 1, signal?: AbortSignal) {
		return this.#run(async (s) => {
			await this.#open(path, page, s);
			return this.context();
		}, signal);
	}
	goToPage(page: number) {
		return this.open(this.#source(), page);
	}
	#source(path?: string) {
		const source = path ?? this.#state.path;
		if (!source)
			throw new AppError(
				'NO_SOURCE',
				'Open a PDF or image in Preview, or provide a workspace path.',
			);
		return source;
	}
	async #resolveSource(path?: string, page?: number) {
		if (path || this.#state.path) return { path: this.#source(path), page };
		if (await workspaceService.exists(sessionPath)) {
			try {
				if ((await workspaceService.stat(sessionPath)).size <= 8192) {
					const saved = JSON.parse(await workspaceService.readText(sessionPath));
					if (
						typeof saved.path === 'string' &&
						saved.path.startsWith('/') &&
						isPreviewPath(saved.path)
					)
						return {
							path: saved.path,
							page: page ?? (Number.isInteger(saved.page) ? saved.page : 1),
						};
				}
			} catch {
				/* Ignore malformed view checkpoints, never source files. */
			}
		}
		return { path: this.#source(), page };
	}
	async #image(resource: Resource, number: number, signal: AbortSignal) {
		const canvas = document.createElement('canvas');
		if (resource.pdf) {
			const page = await resource.pdf.document.getPage(number);
			const normal = page.getViewport({ scale: 1 });
			const viewport = page.getViewport({
				scale: Math.min(2, 1600 / Math.max(normal.width, normal.height)),
			});
			canvas.width = Math.max(1, Math.ceil(viewport.width));
			canvas.height = Math.max(1, Math.ceil(viewport.height));
			const task = page.render({ canvas, viewport });
			const abort = () => task.cancel();
			signal.addEventListener('abort', abort, { once: true });
			try {
				signal.throwIfAborted();
				await task.promise;
			} finally {
				signal.removeEventListener('abort', abort);
			}
		} else {
			const scale = Math.min(1, 1600 / Math.max(resource.width, resource.height));
			canvas.width = Math.max(1, Math.round(resource.width * scale));
			canvas.height = Math.max(1, Math.round(resource.height * scale));
			const bitmap = await createImageBitmap(resource.blob, {
				resizeWidth: canvas.width,
				resizeHeight: canvas.height,
			});
			try {
				canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
			} finally {
				bitmap.close();
			}
		}
		signal.throwIfAborted();
		const image = await pngContent(canvas);
		signal.throwIfAborted();
		return { image, rendered: { page: number, width: canvas.width, height: canvas.height } };
	}
	async show() {
		if (this.#resource || this.#state.busy) return;
		let saved: { path?: string; page?: number } = {};
		try {
			saved = JSON.parse(await workspaceService.readText(sessionPath));
		} catch {}
		if (saved.path && (await workspaceService.exists(saved.path)))
			await this.open(saved.path, saved.page || 1);
	}
	context() {
		const { path, kind, page, pages, revision, width, height, selection, textTruncated } =
			this.#state;
		return {
			path,
			kind,
			warning: this.#state.error || null,
			page,
			pages,
			revision,
			width,
			height,
			selection,
			textTruncated,
			isOpen: apps.open.preview,
			isFocused: apps.active === 'preview',
			citation: path
				? { path, page, revision, label: `${workspaceBasename(path)}, p. ${page}` }
				: null,
		};
	}
	setSelection(text: string) {
		const state = this.#state;
		const valid =
			state.kind === 'pdf' && state.revision && text.trim() && state.text.includes(text);
		this.#update({
			selection: valid
				? {
						text: text.slice(0, 10000),
						page: state.page,
						revision: state.revision!,
						truncated: text.length > 10000,
					}
				: null,
		});
	}
	read(
		input: {
			path?: string;
			page?: number;
			pageCount?: number;
			maxChars?: number;
			includeImage?: boolean;
		} = {},
		signal?: AbortSignal,
	) {
		const count = integer(input.pageCount ?? 1, 1, 20, 'pageCount'),
			max = integer(input.maxChars ?? 20000, 1, 100000, 'maxChars');
		return this.#run(async (s) => {
			const target = await this.#resolveSource(input.path, input.page);
			const resource = await this.#open(target.path, target.page, s);
			const context = this.context();
			const result: Awaited<ReturnType<typeof extractPdfPage>>[] = [];
			let remaining = max;
			if (resource.pdf)
				for (let p = context.page; p <= Math.min(context.pages, context.page + count - 1); p++) {
					s.throwIfAborted();
					const value = await extractPdfPage(resource.pdf.document, p, remaining);
					result.push(value);
					remaining -= value.text.length;
					if (remaining <= 0) break;
				}
			s.throwIfAborted();
			return {
				...context,
				...(input.includeImage ? await this.#image(resource, context.page, s) : {}),
				pageTexts: result,
				truncated:
					!!resource.pdf &&
					(result.some((p) => p.truncated) ||
						result.length < Math.min(count, context.pages - context.page + 1)),
				note: resource.pdf
					? result.every((p) => !p.text)
						? 'No extractable text on these pages. Scans require OCR, which Preview does not provide.'
						: 'PDF extraction order can differ from visual reading order; verify quoted evidence on the page.'
					: input.includeImage
						? 'Image pixels are attached as PNG. No OCR was performed.'
						: 'Set includeImage:true to receive the image pixels as PNG. No OCR is performed.',
			};
		}, signal);
	}
	search(
		query: string,
		input: { path?: string; startPage?: number; maxPages?: number; limit?: number } = {},
		signal?: AbortSignal,
	) {
		if (typeof query !== 'string' || !query.trim() || query.length > 500)
			throw new AppError('INVALID_INPUT', 'Enter a literal search of 1–500 characters.');
		const maxPages = integer(input.maxPages ?? 25, 1, 50, 'maxPages'),
			limit = integer(input.limit ?? 50, 1, 100, 'limit');
		return this.#run(async (s) => {
			const target = await this.#resolveSource(input.path);
			const resource = await this.#open(target.path, target.page, s);
			if (!resource.pdf)
				throw new AppError(
					'TEXT_UNAVAILABLE',
					'Search works on PDF text only. Images and scans need OCR.',
				);
			const start = integer(input.startPage ?? 1, 1, this.#state.pages, 'startPage');
			const end = Math.min(this.#state.pages, start + maxPages - 1),
				needle = query.toLocaleLowerCase();
			const matches: { page: number; excerpt: string }[] = [];
			let scannedPages = 0,
				truncated = false,
				nextPage: number | null = null;
			for (let p = start; p <= end; p++) {
				s.throwIfAborted();
				const text = await extractPdfPage(resource.pdf.document, p);
				scannedPages++;
				truncated ||= text.truncated;
				const normalized = text.text.toLocaleLowerCase();
				const index = normalized.indexOf(needle);
				if (index !== -1) {
					matches.push({
						page: p,
						excerpt: text.text.slice(
							Math.max(0, index - 100),
							Math.min(text.text.length, index + query.length + 160),
						),
					});
				}
				if (matches.length >= limit) {
					nextPage = p < this.#state.pages ? p + 1 : null;
					break;
				}
				if (p === end) nextPage = p < this.#state.pages ? p + 1 : null;
			}
			s.throwIfAborted();
			return {
				...this.context(),
				query,
				matches,
				scannedPages,
				nextPage,
				truncated: truncated || nextPage !== null,
			};
		}, signal);
	}
	reveal(path: string, page = 1, expectedRevision?: string, signal?: AbortSignal) {
		if (expectedRevision !== undefined && !/^sha256:[a-f0-9]{64}$/.test(expectedRevision))
			throw new AppError(
				'INVALID_INPUT',
				'expectedRevision must be the sha256 revision returned by preview_read.',
			);
		return this.#run(async (s) => {
			await this.#open(path, page, s, true, expectedRevision);
			if (expectedRevision && expectedRevision !== this.#state.revision)
				throw new AppError(
					'SOURCE_CHANGED',
					'This source has changed since it was cited. Preview shows the current file; verify the page before relying on the old reference.',
				);
			return this.context();
		}, signal);
	}
	importFile(file: File) {
		return this.#run(async (s) => {
			const base = workspaceBasename(file.name),
				original = `/Documents/${base}`;
			if (file.size > 50 * 1024 * 1024)
				throw new AppError('FILE_TOO_LARGE', 'Choose a PDF under 50 MiB or an image under 10 MiB.');
			const bytes = new Uint8Array(await file.arrayBuffer());
			const prepared = await prepare(
				original,
				bytes,
				{
					path: original,
					name: base,
					kind: 'file',
					size: bytes.length,
					modifiedAt: '',
					extension: base.split('.').pop()!,
				},
				await revision(bytes),
				s,
			);
			try {
				let path = original,
					n = 2;
				while (await workspaceService.exists(path))
					path = original.replace(/(\.[^.]+)$/, ` ${n++}$1`);
				s.throwIfAborted();
				prepared.entry = await workspaceService.writeBytes(path, bytes, {
					createOnly: true,
					actor: 'human',
				});
				prepared.path = path;
			} catch (error) {
				await releaseResource(prepared);
				throw error;
			}
			await this.#present(prepared, 1, s);
			return this.context();
		});
	}
	download() {
		if (this.#state.url && this.#state.path) {
			const link = document.createElement('a');
			link.href = this.#state.url;
			link.download = workspaceBasename(this.#state.path);
			link.click();
		}
	}
	render(canvas: HTMLCanvasElement, width: number, zoom = 1) {
		const resource = this.#resource,
			number = this.#state.page;
		let active = true,
			task: RenderTask | undefined;
		canvas.dataset.rendered = 'false';
		const cancel = () => {
			active = false;
			task?.cancel();
			this.#renderCancels.delete(cancel);
		};
		this.#renderCancels.add(cancel);
		const previous = this.#canvasQueues.get(canvas) ?? Promise.resolve();
		const work = previous
			.catch(() => {})
			.then(async () => {
				if (!active || !resource?.pdf) return;
				try {
					const page = await resource.pdf.document.getPage(number);
					if (!active) return;
					const normal = page.getViewport({ scale: 1 });
					const density = Math.min(devicePixelRatio || 1, 2);
					const scale = Math.min(
						(Math.max(120, Math.min(1200, width)) * Math.min(2, Math.max(0.5, zoom))) /
							normal.width,
						4096 / (Math.max(normal.width, normal.height) * density),
					);
					const viewport = page.getViewport({ scale });
					canvas.width = Math.floor(viewport.width * density);
					canvas.height = Math.floor(viewport.height * density);
					canvas.style.width = `${viewport.width}px`;
					canvas.style.height = `${viewport.height}px`;
					task = page.render({ canvas, viewport, transform: [density, 0, 0, density, 0, 0] });
					await task.promise;
					if (active) canvas.dataset.rendered = 'true';
				} catch (error) {
					if (active)
						this.#update({
							error: error instanceof Error ? error.message : 'Could not render the page.',
						});
				}
			});
		this.#canvasQueues.set(canvas, work);
		return cancel;
	}
	#release() {
		for (const cancel of this.#renderCancels) cancel();
		if (this.#resource) {
			void releaseResource(this.#resource);
		}
		this.#resource = undefined;
	}
	detachView() {
		this.#generation++;
		for (const abort of this.#pendingAborts) abort();
		this.#release();
		this.#update({ url: null, selection: null, busy: false, renderKey: this.#state.renderKey + 1 });
	}
}
export const previewService = new PreviewService();
