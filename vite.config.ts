import { svelte } from '@sveltejs/vite-plugin-svelte';
import UnpluginIcons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';
import { imagetools } from 'vite-imagetools';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';

const isolationHeaders = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Public scripts are not bundled by Vite. Give the iframe and its bridge the
// same content version so an older installed service worker cannot mix them.
const officeVersion = createHash('sha256');
for (const path of ['index.html', 'bootstrap.js', 'office-thread.js', 'sheets-thread.js'])
	officeVersion.update(readFileSync(new URL(`./public/office/${path}`, import.meta.url)));

export default defineConfig({
	server: { headers: isolationHeaders },
	preview: { headers: isolationHeaders },
	build: { license: { fileName: 'licenses/dependencies.md' } },
	// Crepe uses Vue internally for its list controls. Keep that runtime small.
	define: {
		__OFFICE_BUILD_ID__: JSON.stringify(officeVersion.digest('hex').slice(0, 16)),
		__VUE_OPTIONS_API__: false,
		__VUE_PROD_DEVTOOLS__: false,
		__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
	},
	// Discover lazy app dependencies before the first interaction in dev.
	optimizeDeps: {
		entries: [
			'src/main.ts',
			'src/lib/canvas/editor.ts',
			'src/components/apps/Notepad/RichEditor.svelte',
			'src/components/apps/Documents/Documents.svelte',
			'src/components/apps/Sheets/Sheets.svelte',
			'src/components/apps/Preview/Preview.svelte',
			'src/components/apps/Terminal/Terminal.svelte',
		],
	},
	plugins: [
		{
			name: 'desktop-license-notices',
			apply: 'build',
			generateBundle() {
				// Keep the deployed notices in sync with their source files.
				for (const [source, fileName] of [
					['./LICENSE', 'LICENSE'],
					['./node_modules/@fontsource/inter/LICENSE', 'licenses/INTER-OFL.txt'],
				]) {
					this.emitFile({
						type: 'asset',
						fileName,
						source: readFileSync(new URL(source, import.meta.url), 'utf8'),
					});
				}
			},
		},
		svelte(),
		UnpluginIcons({ autoInstall: true, compiler: 'svelte' }),
		VitePWA({
			// Let vite-plugin-pwa handle the web manifest + registration, but write
			// our own service worker (src/sw.ts) powered by Serwist instead of
			// workbox's generateSW. The precache list is injected as self.__WB_MANIFEST.
			strategies: 'injectManifest',
			injectManifest: { globIgnores: ['**/office/**', '**/excalidraw/fonts/**'] },
			srcDir: 'src',
			filename: 'sw.ts',
			includeAssets: [
				'robots.txt',
				'app-icons/finder/32.png',
				'cover-image.png',
				'cursors/(normal|link|text|help)-select.svg',
				'**/*.mp3',
			],
			manifest: {
				name: 'DeskInTab',
				short_name: 'DeskInTab',
				theme_color: '#ffffff',
				description:
					'An operating system in your browser, where you and your AI agent share apps, files, and projects through WebMCP.',
				icons: [
					{
						src: 'app-icons/finder/128.png',
						sizes: '128x128',
						type: 'image/png',
					},
					{
						src: 'app-icons/finder/192.png',
						sizes: '192x192',
						type: 'image/png',
					},
					{
						src: 'app-icons/finder/256.png',
						sizes: '256x256',
						type: 'image/png',
					},
					{
						src: 'app-icons/finder/512.png',
						sizes: '512x512',
						type: 'image/png',
					},
					{
						src: 'app-icons/finder/512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'any maskable',
					},
				],
			},
		}),
		imagetools(),
	],
	resolve: {
		alias: {
			'🍎': new URL('./src/', import.meta.url).pathname,
		},
	},
});
