<script>
	import Dock from '../Dock/Dock.svelte';
	import TopBar from '../TopBar/TopBar.svelte';
	import Wallpaper from '../apps/WallpaperApp/Wallpaper.svelte';
	import BootupScreen from './BootupScreen.svelte';
	import ContextMenu from './ContextMenu.svelte';
	import SystemUpdate from './SystemUpdate.svelte';
	import WindowsArea from './Window/WindowsArea.svelte';

	const isMac = /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);

	if (!isMac) {
		Promise.all([
			import('@fontsource/inter/latin-ext-300.css'),
			import('@fontsource/inter/latin-ext-400.css'),
			import('@fontsource/inter/latin-ext-500.css'),
			import('@fontsource/inter/latin-ext-600.css'),
		]);
	}
	/** @type {HTMLElement | undefined} */
	let mainEl = $state();

	/** @param {HTMLElement} node */
	function attachMain(node) {
		mainEl = node;
		return () => (mainEl = undefined);
	}
</script>

<div {@attach attachMain} class="container">
	<main>
		<TopBar />
		<WindowsArea />
		<Dock />
	</main>

	<Wallpaper />
	<BootupScreen />
	<SystemUpdate />

	<ContextMenu target_element={mainEl} />
</div>

<style>
	.container {
		height: 100%;
		width: 100%;
		min-width: 0;
		/* The desktop never scrolls, including when an app focuses an offscreen control. */
		overflow: clip;
	}

	main {
		height: 100%;
		width: 100%;
		min-width: 0;
		overflow: clip;

		display: grid;
		grid-template-rows: auto 1fr auto;
		grid-template-columns: minmax(0, 1fr);
	}
</style>
