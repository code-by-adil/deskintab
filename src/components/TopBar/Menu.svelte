<script lang="ts">
	import type { MenuItemConfig } from '🍎/state/menubar.svelte';
	import { preferences } from '🍎/state/preferences.svelte.ts';

	const { menu, onselect }: { menu: Record<string, MenuItemConfig>; onselect: () => void } =
		$props();

	function selectItem(item: MenuItemConfig) {
		if (item.disabled || !item.action) return;
		item.action();
		onselect();
	}
	function navigate(event: KeyboardEvent) {
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const current = event.currentTarget as HTMLButtonElement;
		const buttons = [
			...current.parentElement!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
		];
		const index = buttons.indexOf(current);
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? buttons.length - 1
					: (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
		buttons[next]?.focus();
	}
</script>

<section class="container" class:dark={preferences.theme.scheme === 'dark'}>
	{#each Object.entries(menu) as [key, val] (key)}
		<button
			class="menu-item"
			disabled={val.disabled || !val.action}
			aria-label={val.title}
			onclick={() => selectItem(val)}
			onkeydown={navigate}
		>
			<span class="check" aria-hidden="true">{val.checked ? '✓' : ''}</span>
			<span class="label">{val.title}</span>
			{#if val.shortcut}<kbd aria-hidden="true">{val.shortcut}</kbd>{/if}
		</button>
		{#if val.breakAfter}
			<div class="divider"></div>
		{/if}
	{/each}
</section>

<style>
	.container {
		/* // Initial invisible border */
		--additional-box-shadow: 0 0 0 0 white;

		display: block;

		min-width: 16rem;
		width: max-content;

		padding: 0.5rem;

		position: relative;

		user-select: none;

		background-color: hsla(var(--system-color-light-hsl), 0.3);
		backdrop-filter: blur(25px);

		border-radius: 0.5rem;

		box-shadow:
			hsla(0, 0%, 0%, 0.3) 0px 0px 11px 0px,
			var(--additional-box-shadow);

		&.dark {
			--additional-box-shadow:
				inset 0 0 0 0.9px hsla(var(--system-color-dark-hsl), 0.3),
				0 0 0 1.2px hsla(var(--system-color-light-hsl), 0.3);
		}
	}

	.menu-item {
		--alpha: 1;

		display: flex;
		justify-content: flex-start;

		width: 100%;

		padding: 0.2rem 0.4rem;
		margin: 0.1rem;

		letter-spacing: 0.4px;
		font-weight: 400 !important;
		font-size: 0.9rem !important;

		border-radius: 0.3rem;

		transition: none;

		color: hsla(var(--system-color-dark-hsl), var(--alpha));

		&:disabled {
			--alpha: 0.5;
		}

		&:not(:disabled) {
			&:hover,
			&:focus-visible {
				background-color: var(--system-color-primary);
				color: var(--system-color-primary-contrast);
				font-weight: 500 !important;
			}
		}
	}

	.check {
		width: 12px;
		flex: none;
		margin-right: 3px;
	}
	.label {
		flex: 1;
		text-align: left;
	}
	kbd {
		font: inherit;
		font-size: 12px;
		opacity: 0.65;
		margin-left: 28px;
		letter-spacing: 0;
	}
	.divider {
		width: 100%;
		height: 0.2px;

		background-color: hsla(var(--system-color-dark-hsl), 0.3);

		margin: 2px 0;
	}
</style>
