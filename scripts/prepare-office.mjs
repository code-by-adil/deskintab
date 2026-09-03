import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

// Pin the official May 2025 ZetaOffice build by content, including its data pack.
// The CDN's `latest` alias is checked against these hashes, never trusted blindly.
const files = {
	'soffice.js': '5143e5354f470b87f86ba272bcfef857bd13e6f07b59666e48a7ccb89643cd77',
	'soffice.data.js.metadata': '5d9d909d0b9b38443c0f19704032d0fc12d654f6c9c24c2c3b237739c4848ae3',
	'soffice.wasm': '9ebd9a487e849a24b9c69f843ebdb451709c27b7722c010e36846433474a5bd4',
	'soffice.data': '3dab0a5448e599dccc1b1e69f4f86ea9eb30777c3f1ed7b9c386a5f4163e361c',
};
const origin = 'https://cdn.zetaoffice.net/zetaoffice_latest/';
// Unmodified Noto releases, pinned to source commits and verified by SHA-256.
// Keep one Chinese regional subset and two Bengali weights; no full CJK bundle.
const fonts = {
	'NotoSerifBengali-Regular.ttf': {
		url: 'https://raw.githubusercontent.com/notofonts/bengali/302df440f56996d55729644be29585af2b9ad555/fonts/NotoSerifBengali/hinted/ttf/NotoSerifBengali-Regular.ttf',
		sha256: '38079ebcab186c4731e30ad7ff0d57b33ab1bf8409ade9adfca328b1a3c6deaa',
	},
	'NotoSerifBengali-Bold.ttf': {
		url: 'https://raw.githubusercontent.com/notofonts/bengali/302df440f56996d55729644be29585af2b9ad555/fonts/NotoSerifBengali/hinted/ttf/NotoSerifBengali-Bold.ttf',
		sha256: '8d06fdee6accc0ceacccb90881dcf189c93548cec907328eb6b737e70b3da385',
	},
	'NotoSansSC-Regular.otf': {
		url: 'https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf',
		sha256: 'faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9',
	},
};
const build = JSON.stringify({ files, fonts });
const out = new URL('../public/office/runtime/', import.meta.url);
const cache = new URL('../node_modules/.cache/zetaoffice/', import.meta.url);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
await mkdir(out, { recursive: true });
await mkdir(cache, { recursive: true });
// Rewriting identical public files reloads every running Vite desktop.
for (const [source, destination] of [
	['source/zeta.js', 'zeta.js'],
	['LICENSE', 'ZETAJS-LICENSE.txt'],
]) {
	const bytes = await readFile(new URL(`../node_modules/zetajs/${source}`, import.meta.url));
	const target = new URL(destination, out);
	const current = await readFile(target).catch(() => null);
	if (!current?.equals(bytes)) await writeFile(target, bytes);
}
let existing;
try {
	existing = JSON.parse(await readFile(new URL('manifest.json', out), 'utf8'));
} catch {}
if (existing?.build === build) {
	try {
		await Promise.all(existing.assets.map((name) => stat(new URL(name, out))));
		console.log('Office runtime ready (cached).');
		process.exit(0);
	} catch {}
}
const manifest = {
	build,
	assets: ['soffice.js', 'soffice.data.js.metadata'],
	packages: {},
	fonts: Object.keys(fonts),
};
for (const [name, expected] of Object.entries({
	...files,
	...Object.fromEntries(Object.entries(fonts).map(([name, font]) => [name, font.sha256])),
})) {
	let bytes;
	try {
		bytes = await readFile(new URL(name, cache));
	} catch {}
	if (!bytes || sha(bytes) !== expected) {
		console.log(`Downloading Office asset ${name}…`);
		const response = await fetch(fonts[name]?.url ?? origin + name, {
			signal: AbortSignal.timeout(180_000),
		});
		if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
		bytes = Buffer.from(await response.arrayBuffer()); // fetch decodes CDN Brotli.
		if (sha(bytes) !== expected)
			throw new Error(
				`${name}: upstream build changed; review and update the pinned runtime hashes.`,
			);
		await writeFile(new URL(name, cache), bytes);
	}
	if (!['soffice.wasm', 'soffice.data'].includes(name) && !fonts[name]) {
		await writeFile(new URL(name, out), bytes);
		continue;
	}
	// Cloudflare static assets are limited to 25 MiB each. Ship compressed 8 MiB
	// pieces and reassemble through Emscripten's documented preload hooks.
	const compressed = gzipSync(bytes, { level: 9 });
	const parts = [];
	for (let offset = 0; offset < compressed.length; offset += 8 * 1024 * 1024) {
		const part = compressed.subarray(offset, offset + 8 * 1024 * 1024);
		const filename = `${name}-${sha(part).slice(0, 16)}.chunk`;
		await writeFile(new URL(filename, out), part);
		parts.push(filename);
	}
	manifest.packages[name] = { parts, size: bytes.length, compressedSize: compressed.length };
	manifest.assets.push(...parts);
}
await writeFile(new URL('manifest.json', out), JSON.stringify(manifest));
console.log('Office runtime prepared for same-origin static hosting.');
