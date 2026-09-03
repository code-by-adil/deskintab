<script lang="ts">
	import {
		wallpapers_config,
		wallpaperIds,
		type WallpaperID,
	} from '🍎/configs/wallpapers/wallpaper.config.ts';
	import { preferences } from '🍎/state/preferences.svelte.ts';

	const dynamic_wallpapers = wallpaperIds.filter((id) => wallpapers_config[id].type === 'dynamic');

	const standalone_wallpapers = wallpaperIds.filter(
		(id) => wallpapers_config[id].type === 'standalone',
	);

	const current_wallpaper_thumb = $derived(`url(${preferences.wallpaper.image})`);

	function change_wallpaper(wallpaperName: WallpaperID) {
		preferences.wallpaper.id = wallpaperName;
	}

	const preloaded = new Set<string>();

	function preload(url: string) {
		if (preloaded.has(url)) return;
		preloaded.add(url);
		const link = document.createElement('link');
		link.rel = 'prefetch';

		link.href = url;
		link.as = 'image';

		document.head.appendChild(link);
	}
</script>

<section class="container">
	<header class="titlebar app-window-drag-handle">
		<span>Wallpapers</span>
	</header>

	<section class="main-area">
		<section class="selected-wallpaper-section">
			<div class="image" style:background-image={current_wallpaper_thumb}></div>

			<div class="info">
				<h2>{wallpapers_config[preferences.wallpaper.id].name}</h2>
				<p class="wallpaper-type">
					{wallpapers_config[preferences.wallpaper.id].type} wallpaper
				</p>

				{#if wallpapers_config[preferences.wallpaper.id].type !== 'standalone'}
					<label>
						<input type="checkbox" bind:checked={preferences.wallpaper.canControlTheme} />
						Match the theme to the wallpaper
					</label>
				{/if}
			</div>
		</section>

		<section class="dynamic-wallpapers">
			<h2>Dynamic wallpapers</h2>

			<div class="wallpapers">
				{#each dynamic_wallpapers as id (id)}
					{@const { thumbnail, name, image } = wallpapers_config[id]}
					<div class="wallpaper-button">
						<button
							aria-label={`Use ${name} wallpaper`}
							aria-pressed={preferences.wallpaper.id === id}
							onclick={() => change_wallpaper(id)}
							onpointerenter={() => preload(image)}
						>
							<img src={thumbnail} alt="{name} wallpaper" />
						</button>
						<p>{name}</p>
					</div>
				{/each}
			</div>
		</section>

		<section class="standalone-wallpapers">
			<h2>Still wallpapers</h2>

			<div class="wallpapers">
				{#each standalone_wallpapers as id (id)}
					{@const { thumbnail, name, image } = wallpapers_config[id]}
					<div class="wallpaper-button">
						<button
							aria-label={`Use ${name} wallpaper`}
							aria-pressed={preferences.wallpaper.id === id}
							onclick={() => change_wallpaper(id)}
							onpointerenter={() => preload(image)}
						>
							<img src={thumbnail} alt="{name} wallpaper" />
						</button>
						<p>{name}</p>
					</div>
				{/each}
			</div>
		</section>
	</section>
</section>

<style>
	h2 {
		margin: 0 0 12px;
		font-size: 16px;
		font-weight: 600;
		line-height: 1.35;
	}

	.container {
		container-type: inline-size;
		background: var(--app-surface);
		color: var(--app-text);
		border-radius: inherit;
		display: grid;
		grid-template-rows: var(--app-titlebar-height) minmax(0, 1fr);
		height: 100%;
		min-width: 0;
		overflow: hidden;
	}

	.titlebar {
		display: flex;
		align-items: center;
		justify-content: center;
		padding-inline: 80px;
		border-bottom: 1px solid var(--app-border);
		background: var(--app-chrome);
		font-size: 13px;
		font-weight: 600;
	}

	.main-area {
		min-height: 0;
		overflow: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 20px 24px 28px;
		gap: 24px;
		font-size: 13px;
		line-height: 1.4;
	}

	.selected-wallpaper-section {
		display: grid;
		grid-template-columns: 200px minmax(0, 1fr);
		align-items: center;
		gap: 20px;
		width: min(48rem, 100%);
		padding-bottom: 20px;
		border-bottom: 1px solid var(--app-border);

		.image {
			width: 100%;
			aspect-ratio: 16 / 10;
			overflow: hidden;
			border-radius: 8px;
			box-shadow: inset 0 0 0 1px var(--app-border);
			background-repeat: no-repeat;
			background-size: cover;
			background-position: center;
		}

		.info {
			display: flex;
			flex-direction: column;
			min-width: 0;
		}

		h2 {
			margin-bottom: 4px;
		}

		.wallpaper-type {
			color: var(--app-text-secondary);
			text-transform: capitalize;
			font-size: 12px;
		}

		label {
			display: flex;
			align-items: flex-start;
			gap: 7px;
			margin-top: 16px;

			input {
				flex: none;
				width: 14px;
				height: 14px;
				margin: 2px 0 0;
				accent-color: var(--app-accent);
			}
		}
	}

	.dynamic-wallpapers,
	.standalone-wallpapers {
		width: min(48rem, 100%);
		flex: none;

		.wallpapers {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(min(120px, 100%), 1fr));
			gap: 16px 14px;
		}
	}

	.wallpaper-button {
		min-width: 0;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 7px;

		button {
			width: 100%;
			aspect-ratio: 16 / 10;
			overflow: hidden;
			border-radius: 7px;
			box-shadow: 0 0 0 1px var(--app-border);
		}

		button:hover {
			box-shadow: 0 0 0 1px var(--app-text-secondary);
		}

		button[aria-pressed='true'] {
			outline: 2px solid var(--app-accent);
			outline-offset: 2px;
		}

		button:focus-visible {
			outline: 2px solid var(--app-focus);
			outline-offset: 3px;
		}

		img {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			object-fit: cover;
			border-radius: inherit;
		}

		p {
			text-align: center;
			font-size: 12px;
			color: var(--app-text-secondary);
		}
	}

	@container (max-width: 500px) {
		.main-area {
			padding: 16px;
			gap: 20px;
		}
		.selected-wallpaper-section {
			grid-template-columns: 130px minmax(0, 1fr);
			gap: 14px;
			padding-bottom: 16px;
		}
		.selected-wallpaper-section label {
			margin-top: 10px;
		}
	}

	@container (max-width: 330px) {
		.selected-wallpaper-section {
			grid-template-columns: 100px minmax(0, 1fr);
			gap: 12px;
		}
	}
</style>
