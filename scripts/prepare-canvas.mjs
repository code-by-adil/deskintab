import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const entry = require.resolve('@excalidraw/excalidraw');
const source = resolve(dirname(entry), 'fonts');
const destination = new URL('../public/excalidraw/fonts/', import.meta.url);
await mkdir(destination, { recursive: true });
// Rewriting identical public assets triggers a Vite full-page reload, including
// other desktop sessions. Leave already-prepared font bytes alone.
await cp(source, destination, {
	recursive: true,
	force: true,
	async filter(from, to) {
		if ((await stat(from)).isDirectory()) return true;
		try {
			const [original, existing] = await Promise.all([readFile(from), readFile(to)]);
			return !original.equals(existing);
		} catch {
			return true;
		}
	},
});
console.log('Prepared local Excalidraw fonts.');
