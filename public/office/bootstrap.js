// Full-office bootstrap adapted from allotropia/zetajs (MIT), see NOTICE.md.
(() => {
	const pending = new Map();
	const loading = new AbortController();
	let metadataUrl,
		isReady = false;
	performance.mark('office:bootstrap');
	let port,
		sequence = 0,
		resolveReady,
		rejectReady,
		stopped = false;
	const send = (event) => {
		if (!stopped)
			window.parent?.postMessage({ source: 'desktop-office', ...event }, location.origin);
	};
	const ready = new Promise((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	ready.catch(() => {});
	const fail = (error, notify = true) => {
		if (stopped) return;
		stopped = true;
		loading.abort();
		if (metadataUrl) URL.revokeObjectURL(metadataUrl);
		const message =
			error?.name === 'TimeoutError'
				? 'Office assets took too long to load. Check your connection and choose Try Again.'
				: String(error?.message || error);
		rejectReady(new Error(message));
		for (const request of pending.values()) request.reject(new Error(message));
		pending.clear();
		port?.close();
		if (notify)
			window.parent?.postMessage(
				{ source: 'desktop-office', type: 'error', message },
				location.origin,
			);
	};
	addEventListener(
		'error',
		(event) => {
			if (!isReady && (event.error || event.target instanceof HTMLScriptElement))
				fail(new Error(event.message || 'An Office script could not load. Try again.'));
		},
		true,
	);
	addEventListener('unhandledrejection', (event) => {
		if (!isReady) fail(event.reason);
	});
	window.officeBridge = {
		ready,
		async request(cmd, input = {}) {
			await ready;
			if (stopped) throw new Error('Office session has closed. Reopen Documents.');
			const id = ++sequence;
			let imageFile;
			if (cmd === 'open') {
				const path = `/tmp/input.${input.extension}`;
				FS.writeFile(path, input.bytes);
				input = { ...input, bytes: undefined, file: path };
			}
			if (cmd === 'edit' && input.image) {
				imageFile = `/tmp/image-${id}.${input.image.extension}`;
				FS.writeFile(imageFile, input.image.bytes);
				input = { ...input, image: { ...input.image, bytes: undefined, file: imageFile } };
			}
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error('Office operation timed out. Reopen the document before retrying.'));
				}, 60_000);
				pending.set(id, {
					cmd,
					resolve: (value) => {
						clearTimeout(timer);
						resolve(value);
					},
					reject: (error) => {
						clearTimeout(timer);
						reject(error);
					},
				});
				port.postMessage({ id, cmd, ...input });
			}).finally(() => {
				if (imageFile) FS.unlink(imageFile);
			});
		},
		dispose() {
			fail(new Error('Office session closed.'), false);
			// The owning iframe is removed after its document has been saved.
		},
	};
	send({ type: 'boot' });
	addEventListener('pointerdown', () => send({ type: 'focus' }));
	addEventListener('focus', () => send({ type: 'focus' }));
	const canvas = document.getElementById('qtcanvas');
	const sheetMode = new URLSearchParams(location.search).get('app') === 'sheets';
	if (sheetMode) {
		document.title = 'Sheets — ZetaOffice Calc';
		canvas.setAttribute('aria-label', 'Spreadsheet editor');
	}
	canvas.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });
	addEventListener(
		'keydown',
		(event) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
				event.preventDefault();
				event.stopImmediatePropagation();
				send({ type: 'action', action: 'print-help' });
				return;
			}
			if ((event.ctrlKey || event.metaKey) && ['o', 'n'].includes(event.key.toLowerCase())) {
				event.preventDefault();
				event.stopImmediatePropagation();
				send({ type: 'action', action: event.key.toLowerCase() === 'o' ? 'open' : 'new' });
				return;
			}
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
				event.preventDefault();
				event.stopImmediatePropagation();
				send({ type: 'action', action: event.shiftKey ? 'save-as' : 'save' });
			}
		},
		true,
	);
	async function start() {
		if (!crossOriginIsolated)
			throw new Error(
				'Documents needs cross-origin isolation. Serve the desktop with its COOP/COEP headers.',
			);
		performance.mark('office:assets-start');
		const signal = AbortSignal.any([loading.signal, AbortSignal.timeout(180_000)]);
		const jsonAsset = async (name) => {
			const response = await fetch(`./runtime/${name}`, { signal, cache: 'no-cache' });
			if (!response.ok)
				throw new Error(`Could not load Office ${name} (HTTP ${response.status}). Try again.`);
			try {
				return await response.json();
			} catch {
				signal.throwIfAborted();
				throw new Error(`Office ${name} is invalid. Run pnpm office:prepare and try again.`);
			}
		};
		const [manifest, metadata] = await Promise.all([
			jsonAsset('manifest.json'),
			jsonAsset('soffice.data.js.metadata'),
		]);
		if (!manifest.fonts?.length || !manifest.packages || !Array.isArray(metadata.files))
			throw new Error(
				'Office assets are incomplete. Run pnpm office:prepare and restart the server.',
			);
		// Preload metadata ourselves: the pinned Emscripten XHR loader has no
		// non-200/error branch and otherwise leaves a run dependency stuck forever.
		metadataUrl = URL.createObjectURL(
			new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
		);
		// Cache only immutable compressed runtime assets, never documents or a
		// live engine. Storage denial/quota exhaustion must not prevent startup.
		const cache =
			typeof caches === 'undefined'
				? null
				: await caches.open('desktop-office-assets-v1').catch(() => null);
		if (cache) {
			const keep = new Set(
				manifest.assets.map((name) => new URL(`./runtime/${name}`, location.href).href),
			);
			void cache
				.keys()
				.then((keys) =>
					Promise.all(keys.filter((key) => !keep.has(key.url)).map((key) => cache.delete(key))),
				)
				.catch(() => {});
		}
		let loaded = 0,
			lastPercent = -1;
		const total = Object.values(manifest.packages).reduce(
			(sum, entry) => sum + entry.compressedSize,
			0,
		);
		function progress(size) {
			loaded += size;
			const percent = Math.min(100, Math.round((loaded / total) * 100));
			if (percent === lastPercent) return;
			lastPercent = percent;
			send({ type: 'progress', phase: 'assets', message: `Loading Office · ${percent}%` });
		}
		async function unpack(entry) {
			const decoder = new DecompressionStream('gzip');
			const output = new Response(decoder.readable).arrayBuffer();
			const writer = decoder.writable.getWriter();
			const feed = (async () => {
				try {
					for (const name of entry.parts) {
						loading.signal.throwIfAborted();
						const url = new URL(`./runtime/${name}`, location.href).href;
						let response = await cache?.match(url).catch(() => undefined);
						if (!response) {
							response = await fetch(url, { signal });
							if (!response.ok)
								throw new Error(
									`Could not load Office ${name} (HTTP ${response.status}). Try again.`,
								);
							if (cache) void cache.put(url, response.clone()).catch(() => {});
						}
						const reader = response.body.getReader();
						try {
							while (true) {
								const { done, value } = await reader.read();
								if (done) break;
								loading.signal.throwIfAborted();
								await writer.write(value);
								progress(value.byteLength);
							}
						} finally {
							await reader.cancel().catch(() => {});
							reader.releaseLock();
						}
					}
					await writer.close();
				} catch (error) {
					await writer.abort(error).catch(() => {});
					throw error;
				} finally {
					writer.releaseLock();
				}
			})();
			try {
				const [bytes] = await Promise.all([output, feed]);
				if (bytes.byteLength !== entry.size)
					throw new Error('Office asset is incomplete. Try again.');
				return bytes;
			} catch (error) {
				// A truncated cached response must not poison every future retry.
				if (cache)
					await Promise.all(
						entry.parts.map((name) =>
							cache.delete(new URL(`./runtime/${name}`, location.href).href),
						),
					).catch(() => {});
				throw error;
			}
		}
		const [wasm, data, fonts] = await Promise.all([
			unpack(manifest.packages['soffice.wasm']),
			unpack(manifest.packages['soffice.data']),
			Promise.all(
				manifest.fonts.map(async (name) => ({
					name,
					bytes: await unpack(manifest.packages[name]),
				})),
			),
		]);
		loading.signal.throwIfAborted();
		performance.mark('office:assets-ready');
		send({
			type: 'progress',
			phase: 'runtime',
			message: sheetMode ? 'Starting Calc…' : 'Starting Writer…',
		});
		window.Module = {
			canvas,
			wasmBinary: new Uint8Array(wasm),
			getPreloadedPackage: () => data,
			preRun: [
				() => {
					// The pinned runtime's fonts.conf scans /usr/share/fonts. Install
					// before main() so Writer and PDF export share native font fallback.
					Module.FS_createPath('/', 'usr/share/fonts', true, true);
					for (const font of fonts)
						FS.writeFile(`/usr/share/fonts/${font.name}`, new Uint8Array(font.bytes));
				},
			],
			uno_scripts: [
				new URL('./runtime/zeta.js', location.href).href,
				new URL('./sheets-thread.js' + location.search, location.href).href,
				new URL('./office-thread.js' + location.search, location.href).href,
			],
			locateFile: (path) =>
				path === 'soffice.data.js.metadata'
					? metadataUrl
					: new URL(`./runtime/${path}`, location.href).href,
			onRuntimeInitialized: () => performance.mark('office:runtime-initialized'),
			mainScriptUrlOrBlob: new Blob(
				[`importScripts(${JSON.stringify(new URL('./runtime/soffice.js', location.href).href)});`],
				{ type: 'text/javascript' },
			),
			onAbort: (reason) => fail(new Error(`Office stopped: ${reason}`)),
			print: () => {},
		};
		performance.mark('office:runtime-start');
		const script = document.createElement('script');
		script.src = './runtime/soffice.js';
		script.onerror = () => fail(new Error('Could not load the Office runtime.'));
		script.onload = () =>
			Module.uno_main
				.then((channel) => {
					if (stopped) {
						channel.close();
						return;
					}
					performance.mark('office:bridge-ready');
					port = channel;
					port.onmessage = ({ data: event }) => {
						if (stopped) return;
						if (event.type === 'ready') {
							isReady = true;
							performance.mark('office:ready');
							URL.revokeObjectURL(metadataUrl);
							resolveReady();
							send(event);
							return;
						}
						if (event.type === 'changed' || event.type === 'action') {
							send(event);
							return;
						}
						const request = pending.get(event.id);
						if (!request) return;
						pending.delete(event.id);
						if (event.error)
							request.reject(
								Object.assign(new Error(event.error.message), { code: event.error.code }),
							);
						else {
							if (event.result?.file) {
								event.result.bytes = FS.readFile(event.result.file);
								FS.unlink(event.result.file);
								delete event.result.file;
							}
							request.resolve(event.result);
							if (request.cmd === 'open' || request.cmd === 'create') {
								if (!performance.getEntriesByName('office:first-document').length)
									performance.mark('office:first-document');
								window.dispatchEvent(new Event('resize'));
							}
						}
					};
				})
				.catch(fail);
		document.body.append(script);
	}
	start().catch(fail);
})();
