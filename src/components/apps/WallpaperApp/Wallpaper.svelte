<script lang="ts">
	import { untrack } from 'svelte';
	import { elevation } from '🍎/actions';
	import { wallpapers_config } from '🍎/configs/wallpapers/wallpaper.config.ts';
	import { create_interval } from '🍎/state/interval.svelte.ts';
	import { preferences } from '🍎/state/preferences.svelte.ts';

	let visible_background_image = $state(wallpapers_config.ventura.image);

	const interval = create_interval(5 * 1000);

	function valueAtHour<T>(schedule: Record<number, T>, hour: number): T {
		const hours = Object.keys(schedule)
			.map(Number)
			.sort((a, b) => a - b);
		const active = hours.filter((value) => value <= hour).at(-1) ?? hours.at(-1)!;
		return schedule[active];
	}

	$effect(() => {
		const wallpaper = wallpapers_config[preferences.wallpaper.id];
		const hour = new Date(interval.value).getHours();
		const image =
			wallpaper.type === 'dynamic'
				? valueAtHour(wallpaper.timestamps.wallpaper, hour)
				: wallpaper.image;
		const theme =
			wallpaper.type === 'dynamic' && preferences.wallpaper.canControlTheme
				? valueAtHour(wallpaper.timestamps.theme, hour)
				: null;
		untrack(() => {
			preferences.wallpaper.image = image;
			if (theme) preferences.theme.scheme = theme;
		});
	});

	function previewImageOnLoad() {
		visible_background_image = preferences.wallpaper.image;
	}
</script>

<!-- Load the next image before replacing the wallpaper. -->
<img src={preferences.wallpaper.image} aria-hidden="true" alt="" onload={previewImageOnLoad} />

<div
	class="background-cover"
	style:background-image="url({visible_background_image})"
	use:elevation={'wallpaper'}
></div>

<style>
	img {
		height: 1px;
		width: 1px;

		display: none;
	}

	.background-cover {
		height: 100%;
		width: 100%;

		position: fixed;
		top: 0;
		left: 0;

		will-change: background-image;

		transition: background-image 150ms ease-in;

		background-repeat: no-repeat;
		background-size: cover;
		background-position: center;
	}
</style>
