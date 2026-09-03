<script lang="ts">
	import { elevation } from '🍎/actions';
	import { fade_out } from '🍎/helpers/fade.ts';
	import { requestFinderAction, type FinderAction } from '🍎/lib/workspace/finder-state.svelte';
	import { openApp } from '🍎/state/apps.svelte.ts';
	import { preferences } from '🍎/state/preferences.svelte.ts';

	const { target_element }: { target_element: HTMLElement | undefined } = $props();

	let xPos = $state(0);
	let yPos = $state(0);
	let visible = $state(false);

	function handleContextMenu(event: MouseEvent) {
		const target = event.target as Element;
		if (!target_element?.contains(target)) return (visible = false);
		if (target.closest('[data-app-id], header, .dock-container, button, input, textarea, a')) {
			event.preventDefault();
			return (visible = false);
		}

		event.preventDefault();
		xPos = Math.max(8, Math.min(event.clientX, window.innerWidth - 220));
		yPos = Math.max(34, Math.min(event.clientY, window.innerHeight - 150));
		visible = true;
	}

	function runFinderCommand(command: FinderAction) {
		requestFinderAction(command);
		visible = false;
	}

	function openWallpapers() {
		openApp('wallpapers');
		visible = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') visible = false;
	}
</script>

<svelte:body oncontextmenu={handleContextMenu} onclick={() => (visible = false)} />
<svelte:window onkeydown={handleKeydown} />

{#if visible}
	<div
		class="container"
		class:dark={preferences.theme.scheme === 'dark'}
		style:transform="translate({xPos}px, {yPos}px)"
		out:fade_out
		use:elevation={'context-menu'}
	>
		<button
			class="menu-item"
			onclick={(event) => {
				event.stopPropagation();
				runFinderCommand('new-folder');
			}}>New Folder</button
		>
		<button
			class="menu-item"
			onclick={(event) => {
				event.stopPropagation();
				runFinderCommand('new-document');
			}}>New Document</button
		>
		<div class="divider"></div>
		<button
			class="menu-item"
			onclick={(event) => {
				event.stopPropagation();
				openWallpapers();
			}}>Change Desktop Background…</button
		>
	</div>
{/if}

<style>
	.container {
		--additional-shadow: 0 0 0 0 white;
		display: block;
		min-width: 13rem;
		padding: 0.5rem;
		position: fixed;
		top: 0;
		left: 0;
		user-select: none;
		background-color: hsla(var(--system-color-light-hsl), 0.82);
		backdrop-filter: blur(18px);
		border-radius: 0.5rem;
		box-shadow:
			hsla(0, 0%, 0%, 0.3) 0 0 11px 0,
			var(--additional-shadow);

		&.dark {
			--additional-shadow:
				inset 0 0 0 0.9px hsla(var(--system-color-dark-hsl), 0.3),
				0 0 0 1.2px hsla(var(--system-color-light-hsl), 0.3);
		}
	}

	.menu-item {
		display: flex;
		justify-content: flex-start;
		width: 100%;
		padding: 0.3rem 0.4rem;
		margin: 0.12rem 0;
		letter-spacing: 0.3px;
		font-weight: 400;
		font-size: 0.86rem;
		border-radius: 0.3rem;
		color: hsla(var(--system-color-dark-hsl), 1);

		&:hover,
		&:focus-visible {
			background-color: var(--system-color-primary);
			color: var(--system-color-primary-contrast);
		}
	}

	.divider {
		width: 100%;
		height: 1px;
		background: hsla(var(--system-color-dark-hsl), 0.2);
		margin: 3px 0;
	}
</style>
