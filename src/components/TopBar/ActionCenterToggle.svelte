<script lang="ts">
	import { click_outside, elevation, focus_outside } from '🍎/actions';
	import SwitchSvg from '../SVG/SwitchSVG.svelte';
	import ActionCenter from './ActionCenter.svelte';

	let visible = $state(false);
	let toggleEl: HTMLButtonElement;

	function hide() {
		visible = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !visible) return;
		hide();
		toggleEl.focus();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="container" use:click_outside={hide} use:focus_outside={hide}>
	<button
		bind:this={toggleEl}
		aria-label="Control Center"
		aria-controls="control-center"
		aria-expanded={visible}
		style:--scale={visible ? 1 : 0}
		onclick={() => (visible = !visible)}
	>
		<SwitchSvg />
	</button>

	{#if visible}
		<div class="menu-parent" use:elevation={'menubar-menu-parent'}>
			<ActionCenter onclose={hide} />
		</div>
	{/if}
</div>

<style>
	.container button {
		height: 100%;
		width: max-content;

		padding: 0 0.5rem !important;

		border-radius: 0.25rem;

		position: relative;

		&::before {
			content: '';

			position: absolute;
			top: 0;
			left: 0;
			z-index: -1;

			height: 100%;
			width: 100%;

			border-radius: inherit;

			transform: scale(var(--scale));
			transform-origin: center center;

			transition: none;

			background-color: hsla(0, 0%, 96%, 0.3);
		}

		:global(svg),
		:global(svg path) {
			height: 1rem;
			width: 1rem;

			fill: var(--system-color-light-contrast) !important;

			position: relative;
		}
	}

	.menu-parent {
		z-index: 1;
		position: absolute;
		right: 1rem;
		margin-top: 7px;
	}
</style>
