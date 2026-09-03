<script lang="ts">
	import ActionCenterToggle from './ActionCenterToggle.svelte';
	import MenuBar from './MenuBar.svelte';
	import TopBarTime from './TopBarTime.svelte';
	import ProjectAttention from './ProjectAttention.svelte';
</script>

<header>
	<MenuBar />

	<span style:flex="1 1 auto"></span>

	<ProjectAttention />
	<ActionCenterToggle />

	<div class="time" aria-label="Current date and time">
		<TopBarTime />
	</div>
</header>

<style>
	header {
		display: flex;
		align-items: center;

		position: relative;

		width: 100%;
		height: 1.8rem;

		background-color: hsla(var(--system-color-light-hsl), 0.3);

		color: var(--system-color-light-contrast);
		fill: var(--system-color-light-contrast);

		.time {
			flex-shrink: 0;
			white-space: nowrap;
			font-weight: 500;
			font-size: 0.8rem;
			font-family: var(--system-font-family);

			letter-spacing: 0.3px;

			position: relative;

			height: 100%;
			display: flex;
			align-items: center;
			padding: 0 0.55rem;

			text-shadow: 0 0 1px hsla(0, 0%, 0%, 0.1);
		}
	}

	header::before {
		content: '';

		width: inherit;
		height: inherit;

		position: fixed;
		left: 0;
		top: 0;

		z-index: 0;
		backdrop-filter: blur(12px);
	}

	@media (max-width: 700px) {
		header .time {
			display: none;
		}
	}
</style>
