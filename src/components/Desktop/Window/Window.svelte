<script lang="ts">
	import { onMount } from 'svelte';
	import { sineInOut } from 'svelte/easing';
	import { elevation } from '🍎/actions';
	import { apps_config } from '🍎/configs/apps/apps-config.ts';
	import { rand_int } from '🍎/helpers/random.ts';
	import { sleep } from '🍎/helpers/sleep';
	import { subscribeToDesktopCommands } from '🍎/lib/desktop/commands';
	import {
		apps,
		closeApp as closeAppState,
		minimizeApp as minimizeAppState,
		type AppID,
	} from '🍎/state/apps.svelte.ts';
	import { preferences } from '🍎/state/preferences.svelte.ts';

	import AppContent from '../../apps/AppContent.svelte';
	import TrafficLights from './TrafficLights.svelte';

	const { app_id }: { app_id: AppID } = $props();

	const is_maximized = $derived(apps.maximized[app_id]);
	let windowEl = $state<HTMLElement>();
	let x = $state(8);
	let y = $state(8);
	let restorePosition = { x: 8, y: 8 };
	let dragState:
		| { pointerId: number; originX: number; originY: number; windowX: number; windowY: number }
		| undefined;
	let viewportHeight = $state(window.innerHeight);

	const { height, width } = $derived(apps_config[app_id]);
	const remModifier = $derived(
		app_id === 'documents' ||
			app_id === 'sheets' ||
			app_id === 'preview' ||
			app_id === 'tasks' ||
			app_id === 'projects' ||
			app_id === 'canvas'
			? 16
			: +height * 1.2 >= viewportHeight
				? 24
				: 16,
	);

	function focusApp() {
		apps.active = app_id;
	}

	function clampPosition(nextX = x, nextY = y) {
		if (!windowEl || is_maximized) return;

		const parent = windowEl.parentElement;
		const availableWidth = Math.min(parent?.clientWidth ?? window.innerWidth, window.innerWidth);
		const availableHeight = parent?.clientHeight ?? window.innerHeight;
		const maxX = Math.max(8, availableWidth - windowEl.offsetWidth - 8);
		const maxY = Math.max(8, availableHeight - windowEl.offsetHeight - 8);

		x = Math.max(8, Math.min(nextX, maxX));
		y = Math.max(8, Math.min(nextY, maxY));
	}

	function handlePointerDown(event: PointerEvent) {
		focusApp();
		if (dragState || is_maximized || event.button !== 0) return;
		const target = event.target as Element;
		if (!target.closest('.app-window-drag-handle')) return;
		if (target.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;

		event.preventDefault();
		dragState = {
			pointerId: event.pointerId,
			originX: event.clientX,
			originY: event.clientY,
			windowX: x,
			windowY: y,
		};
		apps.is_being_dragged = true;
		windowEl.setPointerCapture(event.pointerId);
	}

	function handleMouseDown(event: MouseEvent) {
		focusApp();
		if (dragState || is_maximized || event.button !== 0) return;
		const target = event.target as Element;
		if (!target.closest('.app-window-drag-handle')) return;
		if (target.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;

		event.preventDefault();
		dragState = {
			pointerId: -1,
			originX: event.clientX,
			originY: event.clientY,
			windowX: x,
			windowY: y,
		};
		apps.is_being_dragged = true;
	}

	function handlePointerMove(event: PointerEvent) {
		if (!dragState || dragState.pointerId !== event.pointerId) return;
		clampPosition(
			dragState.windowX + event.clientX - dragState.originX,
			dragState.windowY + event.clientY - dragState.originY,
		);
	}

	function handleMouseMove(event: MouseEvent) {
		if (!dragState || dragState.pointerId !== -1) return;
		clampPosition(
			dragState.windowX + event.clientX - dragState.originX,
			dragState.windowY + event.clientY - dragState.originY,
		);
	}

	function endDrag(event: PointerEvent) {
		if (!dragState || dragState.pointerId !== event.pointerId) return;
		if (windowEl.hasPointerCapture(event.pointerId))
			windowEl.releasePointerCapture(event.pointerId);
		dragState = undefined;
		apps.is_being_dragged = false;
	}

	function endMouseDrag() {
		if (!dragState || dragState.pointerId !== -1) return;
		dragState = undefined;
		apps.is_being_dragged = false;
	}

	function windowCloseTransition(
		el: HTMLElement,
		{ duration = preferences.reduced_motion ? 0 : 300 }: SvelteTransitionConfig = {},
	): SvelteTransitionReturnType {
		const existingTransform = getComputedStyle(el).transform;

		return {
			duration,
			easing: sineInOut,
			css: (t) => `opacity: ${t}; transform: ${existingTransform} scale(${t})`,
		};
	}

	async function maximizeApp() {
		if (!windowEl) return;
		if (!preferences.reduced_motion) {
			windowEl.style.transition = 'height 0.3s ease, width 0.3s ease, transform 0.3s ease';
		}

		if (!is_maximized) {
			restorePosition = { x, y };
			x = 0;
			y = 0;
		} else {
			x = restorePosition.x;
			y = restorePosition.y;
		}

		apps.maximized[app_id] = !is_maximized;
		if (!is_maximized) requestAnimationFrame(() => clampPosition());

		await sleep(300);
		if (!preferences.reduced_motion && windowEl) windowEl.style.transition = '';
	}

	async function closeApp() {
		if (app_id === 'home' && !(await (await import('🍎/lib/home/home')).homeDocument.beforeClose()))
			return;
		if (
			app_id === 'inbox' &&
			!(await (await import('🍎/lib/inbox/inbox')).inboxDocument.beforeClose())
		)
			return;
		if (
			app_id === 'shortcuts' &&
			!(await (await import('🍎/lib/shortcuts/shortcuts')).shortcutDocument.beforeClose())
		)
			return;
		if (
			app_id === 'studio' &&
			!(await (await import('🍎/lib/studio/studio')).studioDocument.beforeClose())
		)
			return;
		if (app_id === 'projects') {
			const { projectsDocument } = await import('🍎/lib/projects/projects');
			if (!(await projectsDocument.beforeClose())) return;
		}
		if (app_id === 'tasks' || app_id === 'canvas') {
			const document =
				app_id === 'tasks'
					? (await import('🍎/lib/tasks/tasks')).tasksDocument
					: (await import('🍎/lib/canvas/canvas')).canvasDocument;
			if (!(await document.beforeClose())) return;
		}
		if (app_id === 'documents' || app_id === 'sheets') {
			try {
				const { officeService, sheetsService } = await import('🍎/lib/office/office');
				if (!(await (app_id === 'sheets' ? sheetsService : officeService).beforeClose())) return;
			} catch {
				return;
			}
		}
		closeAppState(app_id);
	}

	function minimizeApp() {
		minimizeAppState(app_id);
	}

	onMount(() => {
		const parent = windowEl?.parentElement;
		if (windowEl && parent) {
			const maxX = Math.max(8, parent.clientWidth - windowEl.offsetWidth - 8);
			const maxY = Math.max(8, parent.clientHeight - windowEl.offsetHeight - 8);
			x = Math.max(
				8,
				Math.min((parent.clientWidth - windowEl.offsetWidth) / 2 + rand_int(-80, 80), maxX),
			);
			y = Math.max(8, Math.min(24 + rand_int(-12, 44), maxY));
		}

		requestAnimationFrame(() => {
			(windowEl?.querySelector<HTMLElement>('[data-keyboard-root]') ?? windowEl)?.focus();
		});
		const resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => clampPosition()));
		if (windowEl) resizeObserver.observe(windowEl);
		if (parent) resizeObserver.observe(parent);
		const unsubscribeCommands = subscribeToDesktopCommands(({ target, command }) => {
			if (target !== app_id) return;
			if (command === 'close') closeApp();
			if (command === 'minimize') minimizeApp();
			if (command === 'zoom') void maximizeApp();
		});
		return () => {
			resizeObserver.disconnect();
			unsubscribeCommands();
		};
	});
</script>

<svelte:window
	bind:innerHeight={viewportHeight}
	onmousemove={handleMouseMove}
	onmouseup={endMouseDrag}
/>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
	role="application"
	data-app-id={app_id}
	aria-label={apps_config[app_id].title}
	class="container"
	class:dark={preferences.theme.scheme === 'dark'}
	class:active={apps.active === app_id}
	class:minimized={apps.minimized[app_id]}
	class:maximized={is_maximized}
	style:width={is_maximized ? '100%' : `${+width / remModifier}rem`}
	style:height={is_maximized ? '100%' : `${+height / remModifier}rem`}
	style:transform={`translate3d(${x}px, ${y}px, 0)`}
	style:z-index={apps.z_indices[app_id]}
	tabindex="-1"
	bind:this={windowEl}
	onpointerdown={handlePointerDown}
	onmousedown={handleMouseDown}
	onpointermove={handlePointerMove}
	onpointerup={endDrag}
	onpointercancel={endDrag}
	onkeydown={() => {}}
	out:windowCloseTransition
>
	<div class="tl-container {app_id}" use:elevation={'window-traffic-lights'}>
		<TrafficLights
			{app_id}
			on_maximize_click={maximizeApp}
			on_minimize_app={minimizeApp}
			on_close_app={closeApp}
		/>
	</div>

	<AppContent {app_id} />
</section>

<style>
	.container {
		--elevated-shadow: 0px 8.5px 10px rgba(0, 0, 0, 0.115), 0px 68px 80px rgba(0, 0, 0, 0.23);

		max-width: calc(100% - 1rem);
		max-height: calc(100% - 1rem);
		display: grid;
		grid-template-rows: 1fr;
		position: absolute;
		top: 0;
		left: 0;
		will-change: width, height, transform;
		border-radius: 0.75rem;
		box-shadow: var(--elevated-shadow);
		cursor: var(--system-cursor-default), auto;

		&.minimized {
			display: none;
		}

		&.maximized {
			max-width: 100%;
			max-height: 100%;
			border-radius: 0;
		}

		&.active {
			--elevated-shadow: 0px 8.5px 10px rgba(0, 0, 0, 0.28), 0px 68px 80px rgba(0, 0, 0, 0.56);
		}

		&.dark {
			& > :global(section),
			& > :global(div) {
				border-radius: inherit;
				box-shadow:
					inset 0 0 0 0.9px hsla(var(--system-color-dark-hsl), 0.3),
					0 0 0 1px hsla(var(--system-color-light-hsl), 0.5),
					var(--elevated-shadow);
			}
		}
	}

	/* Window focus routes keyboard commands; controls inside show the focus ring. */
	.container:focus-visible {
		outline: none;
	}

	.tl-container {
		position: absolute;
		top: 1rem;
		left: 1rem;
		box-shadow: none !important;
		z-index: 3;
	}

	.container :global(.app-window-drag-handle) {
		cursor: grab;
		touch-action: none;
	}

	.container:active :global(.app-window-drag-handle) {
		cursor: grabbing;
	}
</style>
