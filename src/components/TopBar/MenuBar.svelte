<script lang="ts">
	import { tick } from 'svelte';
	import AppleIcon from '~icons/mdi/apple';
	import { click_outside, elevation, focus_outside } from '🍎/actions';
	import { getActiveMenus, menubar_state } from '🍎/state/menubar.svelte';
	import Menu from './Menu.svelte';

	const menus = $derived(getActiveMenus());

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') menubar_state.active = '';
	}
	async function openWithKeyboard(event: KeyboardEvent, menuID: string) {
		if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
		event.preventDefault();
		const container = (event.currentTarget as HTMLElement).closest('.container');
		menubar_state.active = menuID;
		await tick();
		const buttons = container?.querySelectorAll<HTMLButtonElement>(
			'.menu-parent button:not(:disabled)',
		);
		buttons?.[event.key === 'ArrowDown' ? 0 : buttons.length - 1]?.focus();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="container"
	use:click_outside={() => (menubar_state.active = '')}
	use:focus_outside={() => (menubar_state.active = '')}
>
	{#each Object.entries(menus) as [menuID, menuConfig] (menuID)}
		<div>
			<div style:height="100%">
				<button
					class="menu-button"
					aria-expanded={menubar_state.active === menuID}
					onkeydown={(event) => openWithKeyboard(event, menuID)}
					class:default-menu={menuID === 'default'}
					class:apple-icon-button={menuID === 'apple'}
					style:--scale={menubar_state.active === menuID ? 1 : 0}
					onclick={() => (menubar_state.active = menubar_state.active === menuID ? '' : menuID)}
					onmouseover={() => menubar_state.active && (menubar_state.active = menuID)}
					onfocus={() => menubar_state.active && (menubar_state.active = menuID)}
				>
					{#if menuID === 'apple'}
						<AppleIcon />
					{:else}
						{menuConfig.title}
					{/if}
				</button>
			</div>

			{#if menubar_state.active === menuID}
				<div class="menu-parent" use:elevation={'menubar-menu-parent'}>
					<Menu menu={menuConfig.menu} onselect={() => (menubar_state.active = '')} />
				</div>
			{/if}
		</div>
	{/each}
</div>

<style>
	.container {
		height: 100%;
		flex-shrink: 0;
		min-width: 0;
		display: flex;
		position: relative;
		overflow: visible;
	}

	.menu-parent {
		position: absolute;
		margin-top: 1.5px;
	}

	.menu-button {
		white-space: nowrap;
		font-weight: 500;

		border-radius: 0.25rem;

		position: relative;
		z-index: 1;

		padding: 0 0.5rem;

		height: 100%;

		&.default-menu {
			font-weight: 600 !important;
			margin: 0 6px;
		}

		&::after {
			content: '';

			position: absolute;
			top: 0;
			left: 0;
			z-index: -1;

			height: 100%;
			width: 100%;

			border-radius: inherit;

			transform: scale(var(--scale), var(--scale));
			transform-origin: center center;

			transition: transform 100ms ease;

			background-color: hsla(var(--system-color-dark-hsl), 0.2);
		}
	}

	.apple-icon-button {
		margin: 0 0rem 0 0.5rem;
		padding: 0 0.7rem;

		display: block;

		:global(svg) {
			font-size: 1rem;
		}
	}

	@media (max-width: 560px) {
		.container > :global(div:nth-child(n + 6)) {
			display: none;
		}
		.menu-button {
			padding-inline: 0.38rem;
		}
		.menu-button.default-menu {
			margin-inline: 2px;
		}
	}
</style>
