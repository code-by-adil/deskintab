<script lang="ts">
	import DarkMode from '~icons/gg/dark-mode';
	import CheckedIcon from '~icons/ic/outline-check';
	import TransitionMaskedIcon from '~icons/mdi/transition-masked';

	import { colors } from '🍎/configs/theme/colors.config';
	import { wallpapers_config } from '🍎/configs/wallpapers/wallpaper.config';
	import { openApp } from '🍎/state/apps.svelte.ts';
	import { preferences } from '🍎/state/preferences.svelte.ts';

	const { onclose }: { onclose: () => void } = $props();
	const colorIds = Object.keys(colors) as (keyof typeof colors)[];

	function toggleTheme() {
		preferences.wallpaper.canControlTheme = false;
		preferences.theme.scheme = preferences.theme.scheme === 'light' ? 'dark' : 'light';
	}

	function openWallpapers() {
		openApp('wallpapers');
		onclose();
	}

	function focusFirstControl(node: HTMLElement) {
		node.querySelector('button')?.focus();
	}
</script>

<section
	id="control-center"
	aria-label="Control Center"
	class="container"
	class:dark={preferences.theme.scheme === 'dark'}
	{@attach focusFirstControl}
>
	<button class="tile" aria-pressed={preferences.theme.scheme === 'dark'} onclick={toggleTheme}>
		<span class="toggle-icon" class:filled={preferences.theme.scheme === 'dark'}>
			<DarkMode />
		</span>
		Dark mode
	</button>

	<button
		class="tile"
		aria-pressed={!preferences.reduced_motion}
		onclick={() => (preferences.reduced_motion = !preferences.reduced_motion)}
	>
		<span class="toggle-icon" class:filled={!preferences.reduced_motion}>
			<TransitionMaskedIcon />
		</span>
		Animations
	</button>

	<div class="tile color-picker">
		<p>Accent color</p>
		<div class="color-palette">
			{#each colorIds as colorID (colorID)}
				{@const { contrastHsl, hsl } = colors[colorID][preferences.theme.scheme]}
				<button
					aria-label={`Use ${colorID} accent color`}
					aria-pressed={preferences.theme.primaryColor === colorID}
					style:--color-hsl={hsl}
					style:--color-contrast-hsl={contrastHsl}
					onclick={() => (preferences.theme.primaryColor = colorID)}
				>
					{#if preferences.theme.primaryColor === colorID}<CheckedIcon />{/if}
				</button>
			{/each}
		</div>
	</div>

	<button class="tile wallpaper-tile" aria-label="Open Wallpapers" onclick={openWallpapers}>
		<img src={wallpapers_config[preferences.wallpaper.id].thumbnail} alt="Current wallpaper" />
		<div>
			<h3>{wallpapers_config[preferences.wallpaper.id].name}</h3>
			<p>{wallpapers_config[preferences.wallpaper.id].type} wallpaper</p>
		</div>
	</button>
</section>

<style>
	.container {
		--border-size: 0;

		display: grid;
		grid-template-columns: repeat(12, 1fr);
		grid-auto-rows: minmax(1.55rem, auto);
		gap: 0.75rem;

		width: 19.5rem;

		padding: 0.75rem;

		position: relative;

		user-select: none;

		background-color: hsla(var(--system-color-light-hsl), 0.3);

		border-radius: 1rem;

		box-shadow:
			hsla(0, 0%, 0%, 0.3) 0px 0px 11px 0px,
			inset 0 0 0 var(--border-size) hsla(var(--system-color-dark-hsl), 0.3),
			0 0 0 var(--border-size) hsla(var(--system-color-light-hsl), 0.3);

		&.dark {
			--border-size: 0.5px;
		}

		&::before {
			content: '';

			width: 100%;
			height: 100%;

			border-radius: inherit;

			position: absolute;
			left: 0;
			top: 0;

			z-index: -1;
			backdrop-filter: blur(12px);
		}
	}

	.tile {
		--border-size: 0;
		display: flex;
		gap: 0.4rem;
		align-items: center;
		grid-column: span 6;
		grid-row: span 2;
		padding: 0.5rem;
		border-radius: 0.75rem;
		box-shadow:
			hsla(0, 0%, 0%, 0.3) 0 1px 4px -1px,
			inset 0 0 0 var(--border-size) hsla(var(--system-color-dark-hsl), 0.3),
			0 0 0 var(--border-size) hsla(var(--system-color-light-hsl), 0.3);
		background: hsla(var(--system-color-light-hsl), 0.5);
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--system-color-dark);
		text-align: start;
	}

	.dark .tile {
		--border-size: 0.4px;
	}

	.tile:focus-visible {
		outline: 2px solid var(--system-color-primary);
		outline-offset: 2px;
	}

	.color-picker,
	.wallpaper-tile {
		grid-column: span 12;
	}

	.toggle-icon {
		--size: 1.7rem;

		--bgcolor: var(--system-color-dark-hsl);
		--bgalpha: 0.1;

		--svgcolor: var(--system-color-light-contrast-hsl);
		--svgalpha: 0.9;

		height: var(--size) !important;
		width: var(--size);

		padding: 0;

		display: flex;
		justify-content: center;
		place-items: center;

		border-radius: 50%;

		background-color: hsla(var(--bgcolor), var(--bgalpha));

		transition:
			box-shadow 100ms ease,
			background-color 150ms ease;

		:global(svg) {
			color: hsla(var(--svgcolor), var(--svgalpha));
		}

		&:focus-visible {
			box-shadow: 0 0 0 0.25rem hsla(var(--bgcolor), 0.4);
		}

		&.filled {
			--bgcolor: var(--system-color-primary-hsl);
			--bgalpha: 1;

			--svgcolor: var(--system-color-primary-contrast-hsl);
			--svgalpha: 1;
		}
	}

	.wallpaper-tile {
		grid-row: span 3;
		height: 100%;
		width: 100%;

		display: grid;
		grid-template-columns: auto 1fr;
		gap: 1rem;
		align-items: center;

		padding: 0.75rem;

		img {
			aspect-ratio: 1 / 1;
			height: 4.5rem;

			object-fit: cover;

			border-radius: 0.5rem;
		}

		h3 {
			width: 100%;

			font-size: 1rem;
			line-height: 1.618;
		}

		p {
			text-transform: capitalize;
			font-size: 0.8rem;
			font-weight: 400;
		}
	}

	.color-picker {
		height: max-content;
		width: 100%;

		display: grid;
		gap: 0.5rem;

		padding: 0.75rem;

		.color-palette {
			margin-top: 0.5rem;

			display: flex;
			justify-content: space-between;

			width: 100%;

			button {
				height: 1.4rem;
				width: 1.4rem;

				color: hsl(var(--color-contrast-hsl));

				border-radius: 50%;

				background-color: hsl(var(--color-hsl));

				transition: box-shadow 200ms ease-in;

				&:hover,
				&:focus-visible {
					box-shadow: 0 0 0 0.2rem hsla(var(--color-hsl), 0.25);
				}
			}
		}
	}
</style>
