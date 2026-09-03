<svelte:options runes={true} />

<script lang="ts">
	import { elevation } from '🍎/actions';
	import { appIds, apps_config } from '🍎/configs/apps/apps-config';
	import { apps } from '🍎/state/apps.svelte.ts';
	import DockItem from './DockItem.svelte';

	let dock_mouse_x = $state<number | null>(null);
	let bodyHeight = $state(0);
	let mouseY = $state(0);
	let dockHeight = $state(0);

	const mouseInDock = $derived(
		dock_mouse_x !== null && Math.abs(mouseY - bodyHeight) <= dockHeight,
	);
	const dockHidden = $derived(
		!mouseInDock &&
			appIds.some((id) => apps.open[id] && !apps.minimized[id] && apps.maximized[id]) &&
			Math.abs(mouseY - bodyHeight) > 30,
	);
</script>

<svelte:body onmousemove={({ y }) => (mouseY = y)} />

<svelte:window bind:innerHeight={bodyHeight} />

<section
	class="dock-container"
	class:dock-hidden={dockHidden}
	bind:clientHeight={dockHeight}
	use:elevation={'dock'}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="dock-el"
		class:hidden={dockHidden}
		onmousemove={(event) => (dock_mouse_x = event.x)}
		onmouseleave={() => (dock_mouse_x = null)}
	>
		{#each appIds as appID (appID)}
			{#if apps_config[appID].dock_breaks_before}
				<div class="divider" aria-hidden="true"></div>
			{/if}

			<DockItem mouse_x={mouseInDock ? dock_mouse_x : null} app_id={appID} />
		{/each}
	</div>
</section>

<style>
	.dock-container {
		padding-bottom: 0.7rem;
		left: 0;
		bottom: 0;

		width: 100%;
		max-width: 100vw;
		height: 5.2rem;

		padding: 0.4rem;

		display: flex;
		justify-content: safe center;
		overflow: visible;
		scrollbar-width: none;

		&::-webkit-scrollbar {
			display: none;
		}

		&:not(.dock-hidden) {
			pointer-events: none;
		}
	}

	.dock-el {
		background-color: hsla(var(--system-color-light-hsl), 0.4);

		box-shadow:
			inset 0 0 0 0.2px hsla(var(--system-color-grey-100-hsl), 0.7),
			0 0 0 0.2px hsla(var(--system-color-grey-900-hsl), 0.7),
			hsla(0, 0%, 0%, 0.3) 2px 5px 19px 7px;

		position: relative;
		flex: none;

		padding: 0.3rem;

		border-radius: 1.2rem;

		height: 100%;

		display: flex;
		align-items: flex-end;
		overflow: visible;

		transition: transform 0.3s ease;

		&:not(.hidden) {
			pointer-events: auto;
		}

		&.hidden {
			transform: translate3d(0, 200%, 0);

			&::before {
				width: calc(100% - 2px);
				height: calc(100% - 2px);

				margin-top: 1px;
				margin-left: 1px;
			}
		}

		&::before {
			content: '';

			border-radius: 20px;

			width: 100%;
			height: 100%;

			border: inherit;

			backdrop-filter: blur(10px);

			position: absolute;
			top: 0;
			left: 0;

			z-index: -1;
		}
	}

	.divider {
		height: 100%;
		width: 0.2px;

		background-color: hsla(var(--system-color-dark-hsl), 0.3);

		margin: 0 4px;
	}

	@media (max-width: 1000px) {
		.dock-container {
			justify-content: flex-start;
			overflow-x: auto;
			overflow-y: hidden;
		}
	}
</style>
