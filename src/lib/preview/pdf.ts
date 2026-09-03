import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';

let libraryPromise: Promise<typeof import('pdfjs-dist')> | undefined;
export function pdfLibrary() {
	return (libraryPromise ??= Promise.all([
		import('pdfjs-dist'),
		import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
	]).then(([library, worker]) => {
		library.GlobalWorkerOptions.workerSrc = worker.default;
		return library;
	}));
}

export async function loadPdf(source: { data?: Uint8Array; url?: string }, signal?: AbortSignal) {
	signal?.throwIfAborted();
	const library = await pdfLibrary();
	signal?.throwIfAborted();
	// Own this worker so closing during its startup does not wait for the script download.
	const worker = new library.PDFWorker();
	let loading: PDFDocumentLoadingTask | undefined;
	let rejectAbort: (reason: unknown) => void;
	const aborted = new Promise<never>((_, reject) => {
		rejectAbort = reject;
	});
	const abort = () => {
		rejectAbort(signal?.reason ?? new DOMException('Preview closed.', 'AbortError'));
		worker.destroy();
		void loading?.destroy().catch(() => {});
	};
	signal?.addEventListener('abort', abort, { once: true });
	try {
		await Promise.race([worker.promise, aborted]);
		signal?.throwIfAborted();
		loading = library.getDocument({ ...source, worker });
		const document = await Promise.race([loading.promise, aborted]);
		signal?.throwIfAborted();
		const task = loading;
		return {
			document,
			destroy: async () => {
				try {
					await task.destroy();
				} finally {
					worker.destroy();
				}
			},
		};
	} catch (error) {
		worker.destroy();
		void loading?.destroy().catch(() => {});
		throw error;
	} finally {
		signal?.removeEventListener('abort', abort);
	}
}

export async function extractPdfPage(
	document: PDFDocumentProxy,
	number: number,
	maxChars = 100000,
) {
	const page = await document.getPage(number);
	const content = await page.getTextContent();
	let text = '',
		truncated = false;
	for (const item of content.items) {
		if (!('str' in item)) continue;
		const part = item.str + (item.hasEOL ? '\n' : ' ');
		const remaining = maxChars - text.length;
		text += part.slice(0, Math.max(0, remaining));
		if (part.length > remaining) {
			truncated = true;
			break;
		}
	}
	return { page: number, text: text.trimEnd(), truncated };
}
