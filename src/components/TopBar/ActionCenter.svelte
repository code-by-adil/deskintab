<script lang="ts">
	import Sun from '~icons/mdi/white-balance-sunny';
	import Moon from '~icons/mdi/weather-night';
	import ChevronRight from '~icons/mdi/chevron-right';
	import { wallpapers_config } from '🍎/configs/wallpapers/wallpaper.config';
	import { setAppearance } from '🍎/lib/desktop/appearance';
	import { openApp } from '🍎/state/apps.svelte.ts';
	import { preferences } from '🍎/state/preferences.svelte.ts';

	const { onclose }: { onclose: () => void } = $props();
	const wallpaper = $derived(wallpapers_config[preferences.wallpaper.id]);

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
	aria-labelledby="control-center-title"
	class={['control-center', { dark: preferences.theme.scheme === 'dark' }]}
	{@attach focusFirstControl}
>
	<h2 id="control-center-title">Control Center</h2>
	<div class="settings-group">
		<div class="appearance">
			<h3 id="appearance-label">Appearance</h3>
			<div class="appearance-options" role="group" aria-labelledby="appearance-label">
				<button
					aria-label="Light mode"
					aria-pressed={preferences.theme.scheme === 'light'}
					onclick={() => setAppearance({ theme: 'light' })}
				>
					<Sun aria-hidden="true" />Light
				</button>
				<button
					aria-label="Dark mode"
					aria-pressed={preferences.theme.scheme === 'dark'}
					onclick={() => setAppearance({ theme: 'dark' })}
				>
					<Moon aria-hidden="true" />Dark
				</button>
			</div>
		</div>
		<button class="wallpaper-row" aria-label="Open Wallpapers" onclick={openWallpapers}>
			<img src={wallpaper.thumbnail} alt="" />
			<span class="wallpaper-label"><strong>Wallpaper</strong><span>{wallpaper.name}</span></span>
			<ChevronRight aria-hidden="true" />
		</button>
	</div>
</section>

<style>
	.control-center {
		--panel-bg: rgba(236, 236, 239, 0.94);
		--group-bg: rgba(255, 255, 255, 0.56);
		--segment-bg: rgba(0, 0, 0, 0.045);
		--selected-bg: #fff;
		--separator: rgba(0, 0, 0, 0.09);
		--panel-border: rgba(255, 255, 255, 0.65);
		--hover-bg: rgba(0, 0, 0, 0.04);
		width: min(19rem, calc(100vw - 1.5rem));
		padding: 16px 12px 12px;
		border: 1px solid var(--panel-border);
		border-radius: 16px;
		background: var(--panel-bg);
		backdrop-filter: blur(28px) saturate(0.7);
		box-shadow:
			0 12px 36px rgba(0, 0, 0, 0.22),
			0 2px 6px rgba(0, 0, 0, 0.1);
		color: var(--app-text);
		user-select: none;
		transition: none;
	}
	.control-center.dark {
		--panel-bg: rgba(38, 38, 42, 0.94);
		--group-bg: rgba(255, 255, 255, 0.045);
		--segment-bg: rgba(0, 0, 0, 0.17);
		--selected-bg: #606066;
		--separator: rgba(255, 255, 255, 0.09);
		--panel-border: rgba(255, 255, 255, 0.2);
		--hover-bg: rgba(255, 255, 255, 0.05);
	}
	h2 {
		margin: 0 4px 13px;
		font-size: 13px;
		line-height: 18px;
		font-weight: 600;
		letter-spacing: -0.1px;
	}
	.settings-group {
		border: 1px solid var(--separator);
		border-radius: 11px;
		background: var(--group-bg);
	}
	.appearance {
		padding: 12px;
	}
	h3 {
		margin: 0 0 9px;
		font-size: 12px;
		font-weight: 500;
		line-height: 16px;
	}
	.appearance-options {
		display: flex;
		gap: 3px;
		padding: 3px;
		border-radius: 8px;
		background: var(--segment-bg);
	}
	.appearance-options button {
		flex: 1;
		gap: 7px;
		min-height: 34px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		color: var(--app-text-secondary);
	}
	.appearance-options button[aria-pressed='true'] {
		background: var(--selected-bg);
		color: var(--app-text);
		box-shadow:
			0 1px 3px rgba(0, 0, 0, 0.12),
			0 0 0 0.5px var(--separator);
	}
	button:hover {
		background: var(--hover-bg);
	}
	button:focus-visible {
		outline: 2px solid var(--app-focus);
		outline-offset: 2px;
	}
	.wallpaper-row {
		display: flex;
		width: 100%;
		gap: 11px;
		padding: 12px;
		border-top: 1px solid var(--separator);
		border-radius: 0 0 10px 10px;
		text-align: left;
	}
	.wallpaper-row img {
		width: 42px;
		height: 42px;
		border-radius: 8px;
		object-fit: cover;
		box-shadow: 0 0 0 0.5px var(--separator);
	}
	.wallpaper-label {
		display: grid;
		flex: 1;
		min-width: 0;
		gap: 3px;
		font-size: 12px;
		line-height: 16px;
	}
	.wallpaper-label strong {
		font-size: 13px;
		font-weight: 500;
	}
	.wallpaper-label > span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--app-text-secondary);
	}
	.control-center :global(svg) {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}
	.wallpaper-row :global(svg) {
		color: var(--app-text-secondary);
	}
	.control-center :global(*) {
		transition: none;
	}
</style>
