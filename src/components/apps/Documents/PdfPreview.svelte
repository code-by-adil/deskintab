<script lang="ts">
	import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
	import { extractPdfPage, loadPdf } from '🍎/lib/preview/pdf';
	let { url }: { url: string } = $props();
	let pageNumber = $state(1);
	let pages = $state(0);
	let rendering = $state(true);
	let message = $state('Loading PDF…');
	let pageText = $state('');
	let renderPage: (number: number) => void = () => {};

	function preview(canvas: HTMLCanvasElement) {
		let active = true;
		const loadingAbort = new AbortController();
		let pdf: PDFDocumentProxy;
		let task: RenderTask;
		let queued: number | undefined;
		let running = false;
		let destroy: (() => Promise<void>) | undefined;
		async function render(number: number) {
			if (!pdf || !active) return;
			if (running) {
				queued = number;
				return;
			}
			running = true;
			rendering = true;
			try {
				const page = await pdf.getPage(number);
				if (!active) return;
				const normal = page.getViewport({ scale: 1 });
				const width = Math.max(240, Math.min(960, canvas.parentElement.clientWidth - 40));
				const viewport = page.getViewport({ scale: width / normal.width });
				const density = Math.min(devicePixelRatio || 1, 2);
				canvas.width = Math.floor(viewport.width * density);
				canvas.height = Math.floor(viewport.height * density);
				canvas.style.width = `${viewport.width}px`;
				canvas.style.height = `${viewport.height}px`;
				task = page.render({ canvas, viewport, transform: [density, 0, 0, density, 0, 0] });
				await task.promise;
				const text = await extractPdfPage(pdf, number);
				if (!active) return;
				pageText = text.text;
				pageNumber = number;
				message = '';
			} catch (error) {
				if (active)
					message = error instanceof Error ? error.message : 'Could not display this PDF.';
			} finally {
				running = false;
				if (active) {
					rendering = false;
					if (queued !== undefined) {
						const next = queued;
						queued = undefined;
						void render(next);
					}
				}
			}
		}
		renderPage = (number) => {
			void render(number);
		};
		void (async () => {
			try {
				const loaded = await loadPdf({ url }, loadingAbort.signal);
				destroy = loaded.destroy;
				pdf = loaded.document;
				if (!active) {
					void loaded.destroy().catch(() => {});
					return;
				}
				pages = pdf.numPages;
				await render(1);
			} catch (error) {
				if (active) {
					rendering = false;
					message = error instanceof Error ? error.message : 'Could not load this PDF.';
				}
			}
		})();
		let previousWidth = 0;
		const observer = new ResizeObserver(([entry]) => {
			const width = Math.round(entry.contentRect.width);
			if (width !== previousWidth) {
				previousWidth = width;
				void render(pageNumber);
			}
		});
		observer.observe(canvas.parentElement);
		return () => {
			active = false;
			loadingAbort.abort();
			observer.disconnect();
			task?.cancel();
			void destroy?.().catch(() => {});
		};
	}
</script>

<section class="pdf-preview" aria-label="PDF preview">
	<nav aria-label="PDF pages">
		<button disabled={rendering || pageNumber <= 1} onclick={() => renderPage(pageNumber - 1)}
			>Previous</button
		>
		<span role="status">{pages ? `Page ${pageNumber} of ${pages}` : 'Loading PDF…'}</span>
		<button disabled={rendering || pageNumber >= pages} onclick={() => renderPage(pageNumber + 1)}
			>Next</button
		>
	</nav>
	{#if message}<p role="status">{message}</p>{/if}
	<div class="page-scroll" aria-busy={rendering}>
		<canvas
			aria-label={`PDF page ${pageNumber}`}
			data-rendered={!rendering && !message}
			{@attach preview}
		></canvas>
		{#if pageText}<details>
				<summary>Page text</summary>
				<p>{pageText}</p>
			</details>{/if}
	</div>
</section>

<style>
	.pdf-preview {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: #dadadd;
		color: #333;
	}
	nav {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 16px;
		padding: 8px;
		background: #f5f5f6;
		border-bottom: 1px solid #c6c6ca;
		font-size: 12px;
	}
	button {
		border: 1px solid #c6c6ca;
		border-radius: 4px;
		background: white;
		padding: 3px 10px;
		font: inherit;
	}
	button:disabled {
		opacity: 0.45;
	}
	.page-scroll {
		overflow: auto;
		flex: 1;
		min-height: 0;
		padding: 20px;
	}
	canvas {
		display: block;
		margin: 0 auto;
		background: white;
		box-shadow: 0 1px 5px #0003;
	}
	p {
		padding: 8px 16px;
		font-size: 13px;
	}
	details {
		max-width: 960px;
		margin: 16px auto;
		font-size: 12px;
	}
	details p {
		user-select: text;
		white-space: pre-wrap;
		line-height: 1.5;
	}
</style>
