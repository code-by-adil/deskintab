<script module lang="ts">
	const baseWidth = 57.6;
	const distanceLimit = baseWidth * 3.2;
	const beyondDistanceLimit = distanceLimit + 1;
	const distanceInput = [
		-distanceLimit,
		-distanceLimit / 1.6,
		-distanceLimit / 3,
		0,
		distanceLimit / 3,
		distanceLimit / 1.6,
		distanceLimit,
	];
</script>

<script lang="ts">
	import { interpolate } from 'popmotion';
	import { onDestroy, tick, untrack } from 'svelte';
	import { sineInOut } from 'svelte/easing';
	import { spring, tweened } from 'svelte/motion';
	import { elevation } from '🍎/actions';
	import { apps_config } from '🍎/configs/apps/apps-config.ts';
	import { apps, openApp, type AppID } from '🍎/state/apps.svelte.ts';
	import { preferences } from '🍎/state/preferences.svelte.ts';

	const { mouse_x, app_id }: { mouse_x: number | null; app_id: AppID } = $props();

	let buttonEl = $state<HTMLButtonElement>();
	let viewportWidth = $state(window.innerWidth);
	let distance = $state(beyondDistanceLimit);
	let raf: number;

	const maxScale = $derived(viewportWidth < 1000 ? 1 : 1.65);
	const scaleOutput = $derived(
		maxScale === 1 ? [1, 1, 1, 1, 1, 1, 1] : [1, 1.05, 1.2, maxScale, 1.2, 1.05, 1],
	);
	const scaleFromDistance = $derived(interpolate(distanceInput, scaleOutput));
	const iconScale = spring(1, { damping: 0.5, stiffness: 0.18 });

	$effect(() => {
		distance;
		maxScale;
		untrack(() => ($iconScale = scaleFromDistance(distance)));
	});

	function animate() {
		if (buttonEl && mouse_x !== null) {
			const rect = buttonEl.getBoundingClientRect();
			distance = mouse_x - (rect.left + rect.width / 2);
			return;
		}
		distance = beyondDistanceLimit;
	}

	$effect(() => {
		mouse_x;
		if (preferences.reduced_motion || apps.is_being_dragged) return;
		raf = requestAnimationFrame(animate);
	});

	const { title, icon } = $derived(apps_config[app_id]);
	const appOpenIconBounceTransform = tweened(0, { duration: 400, easing: sineInOut });

	async function bounceEffect() {
		await appOpenIconBounceTransform.set(-40);
		void appOpenIconBounceTransform.set(0);
	}

	async function launchApp() {
		const isAppAlreadyOpen = apps.open[app_id];
		openApp(app_id);
		await tick();
		requestAnimationFrame(() => {
			const appWindow = document.querySelector<HTMLElement>(`[data-app-id="${app_id}"]`);
			(appWindow?.querySelector<HTMLElement>('[data-keyboard-root]') ?? appWindow)?.focus();
		});
		if (!isAppAlreadyOpen && viewportWidth >= 1000) await bounceEffect();
	}

	onDestroy(() => cancelAnimationFrame(raf));
</script>

<svelte:window bind:innerWidth={viewportWidth} />

<button
	bind:this={buttonEl}
	onclick={launchApp}
	aria-label="Launch {title} app"
	class="dock-open-app-button {app_id}"
>
	<p
		class="tooltip"
		class:tooltip-enabled={!apps.is_being_dragged}
		class:dark={preferences.theme.scheme === 'dark'}
		use:elevation={'dock-tooltip'}
	>
		{title}
	</p>

	<span
		class="icon-wrap"
		style:transform={`translateY(${$appOpenIconBounceTransform - ($iconScale - 1) * 20}px) scale(${$iconScale})`}
	>
		<img src={icon} alt="{title} app" draggable="false" />
	</span>

	<div class="dot" style:--opacity={+apps.open[app_id]}></div>
</button>

<style>
	button {
		display: flex;
		flex: 0 0 3.6rem;
		width: 3.6rem;
		height: 4.25rem;
		flex-direction: column;
		justify-content: flex-end;
		align-items: center;
		position: relative;
		border-radius: 0.5rem;
		overflow: visible;

		&:hover,
		&:focus-visible {
			.tooltip.tooltip-enabled {
				display: block;
			}
		}
	}

	.icon-wrap {
		display: flex;
		justify-content: center;
		align-items: center;
		width: 3.6rem;
		height: 3.6rem;
		transform-origin: bottom center;
		will-change: transform;
		position: relative;
		z-index: 1;
	}

	img {
		display: block;
		width: 3.6rem;
		height: 3.6rem;
		object-fit: contain;
	}

	.tooltip {
		--double-border: 0 0 0 0 white;
		white-space: nowrap;
		position: absolute;
		left: 50%;
		bottom: calc(100% + 1.2rem);
		transform: translateX(-50%);
		background-color: hsla(var(--system-color-light-hsl), 0.75);
		backdrop-filter: blur(8px);
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		box-shadow:
			hsla(0deg, 0%, 0%, 30%) 0px 1px 5px 2px,
			var(--double-border);
		color: var(--system-color-light-contrast);
		font-family: var(--system-font-family);
		font-weight: 400;
		font-size: 0.9rem;
		letter-spacing: 0.4px;
		display: none;
		z-index: 3;

		&.dark {
			--double-border:
				inset 0 0 0 0.9px hsla(var(--system-color-dark-hsl), 0.3),
				0 0 0 1.2px hsla(var(--system-color-light-hsl), 0.3);
		}
	}

	.dot {
		height: 4px;
		width: 4px;
		margin: 0;
		border-radius: 50%;
		background-color: var(--system-color-dark);
		opacity: var(--opacity);
	}

	@media (max-width: 520px) {
		.tooltip {
			display: none !important;
		}
	}
</style>
