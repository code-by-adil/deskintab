<script lang="ts">
	import { appIds } from '🍎/configs/apps/apps-config';
	import { apps } from '🍎/state/apps.svelte.ts';
	import Window from './Window.svelte';
</script>

<section id="windows-area">
	{#each appIds as app_id (app_id)}
		{#if apps.open[app_id]}
			<Window {app_id} />
		{/if}
	{/each}
</section>

<style>
	section {
		display: block;
		height: 100%;
		min-height: 0;
		width: 100%;
		justify-self: center;
		position: relative;
		/* Clip windows without allowing focus to scroll the whole desktop. */
		overflow: clip;
	}
</style>
