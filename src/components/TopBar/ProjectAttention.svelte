<script lang="ts">
	import { onMount } from 'svelte';
	import MessageIcon from '~icons/mdi/message-question-outline';
	import { projectsService } from '🍎/lib/projects/projects';
	import { workspaceService } from '🍎/lib/workspace/workspace';
	import { revealDesktop } from '🍎/lib/desktop/files';
	let count = $state(0);
	let firstPath = '';
	let error = $state('');
	let alive = true;
	let generation = 0;
	async function refresh() {
		const current = ++generation;
		try {
			const result = await projectsService.list();
			if (!alive || current !== generation) return;
			count = result.projects.reduce((total, project) => total + project.openDecisionCount, 0);
			firstPath = result.projects.find((project) => project.openDecisionCount)?.path ?? '';
		} catch {
			if (alive && current === generation) {
				count = 0;
				firstPath = '';
			}
		}
	}
	async function open() {
		if (!firstPath) return;
		try {
			await revealDesktop({ path: firstPath });
			error = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Projects could not open.';
		}
	}
	onMount(() => {
		alive = true;
		void refresh();
		const unsubscribe = workspaceService.subscribe(() => {
			void refresh();
		});
		return () => {
			alive = false;
			unsubscribe();
		};
	});
</script>

{#if count}
	<button
		aria-label={`${count} project ${count === 1 ? 'decision needs' : 'decisions need'} you`}
		title={error || 'Open a project waiting for your answer'}
		onclick={open}
	>
		<MessageIcon width="15" height="15" aria-hidden="true" /><span>{count}</span>
	</button>
{/if}

<style>
	button {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 100%;
		padding: 0 9px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: inherit;
		font: 500 12px var(--system-font-family);
		cursor: pointer;
	}
	button:hover {
		background: var(--app-hover);
	}
	button:focus-visible {
		outline: 2px solid var(--app-focus);
		outline-offset: -2px;
	}
</style>
