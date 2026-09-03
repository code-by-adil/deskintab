<script lang="ts">
	import { onMount } from 'svelte';
	import ReviewPanel from './ReviewPanel.svelte';
	import { revealDesktop } from '🍎/lib/desktop/files';
	import { connectActivityContext } from '🍎/lib/workspace/interaction-context';
	import {
		activityService,
		type ActivityActor,
		type ActivityEntry,
	} from '🍎/lib/activity/activity';

	type ActivityFilter = ActivityActor | 'all' | 'terminal-events';
	const filters: Array<{ label: string; id: ActivityFilter }> = [
		{ label: 'All', id: 'all' },
		{ label: 'Agent', id: 'agent' },
		{ label: 'You', id: 'human' },
		{ label: 'Terminal', id: 'terminal-events' },
	];

	let entries = $state.raw<ActivityEntry[]>([]);
	let filter = $state<ActivityFilter>('all');
	let tab = $state<'activity' | 'review'>('activity');
	let reviewSelection = $state<{ kind: 'version' | 'session'; id: string } | null>(null);
	let error = $state('');
	let openingPath = $state<string | null>(null);
	const visibleEntries = $derived(
		filter === 'all'
			? entries
			: filter === 'terminal-events'
				? entries.filter((entry) => entry.action.startsWith('Command'))
				: entries.filter((entry) => entry.actor === filter),
	);

	function refresh() {
		entries = activityService.list(100);
	}

	function actorLabel(actor: ActivityActor) {
		return { human: 'You', agent: 'Agent', terminal: 'Terminal', system: 'Desktop' }[actor];
	}
	function selectReview(kind: 'version' | 'session', id: string) {
		reviewSelection = { kind, id };
		tab = 'review';
	}
	async function reveal(path: string) {
		if (openingPath) return;
		openingPath = path;
		error = '';
		try {
			await revealDesktop({ path });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The result could not be opened.';
		} finally {
			openingPath = null;
		}
	}

	onMount(() => {
		const disconnectContext = connectActivityContext(() => ({ tab, filter }));
		refresh();
		const unsubscribe = activityService.subscribe(refresh);
		return () => {
			disconnectContext();
			unsubscribe();
		};
	});
</script>

<section class="activity-shell">
	<header class="app-window-drag-handle">
		<div class="traffic-space" aria-hidden="true"></div>
		<h1>Activity</h1>
		<nav class="view-tabs" aria-label="Activity views">
			<button
				class={{ active: tab === 'activity' }}
				aria-pressed={tab === 'activity'}
				onclick={() => (tab = 'activity')}>Activity</button
			>
			<button
				class={{ active: tab === 'review' }}
				aria-pressed={tab === 'review'}
				onclick={() => (tab = 'review')}>Review</button
			>
		</nav>
	</header>
	{#if tab === 'activity'}
		<nav class="filters" aria-label="Activity filters">
			{#each filters as item (item.id)}
				<button
					class={{ active: filter === item.id }}
					aria-pressed={filter === item.id}
					onclick={() => (filter = item.id)}>{item.label}</button
				>
			{/each}
		</nav>
		{#if error}<div class="error-banner" role="alert">{error}</div>{/if}
		<div class="timeline" data-testid="activity-list">
			{#if visibleEntries.length === 0}
				<p class="empty">No activity in this view yet.</p>
			{:else}
				{#each visibleEntries as entry (entry.id)}
					<article data-actor={entry.actor}>
						<div
							class={[
								'actor',
								{ agent: entry.actor === 'agent', terminal: entry.actor === 'terminal' },
							]}
						>
							{actorLabel(entry.actor).slice(0, 1)}
						</div>
						<div class="event">
							<div>
								<strong>{entry.action}</strong><time datetime={entry.createdAt}
									>{new Date(entry.createdAt).toLocaleTimeString([], {
										hour: 'numeric',
										minute: '2-digit',
									})}</time
								>
							</div>
							<p>{entry.detail}</p>
							{#if entry.path}<button
									class="path-link"
									title={`Open ${entry.path}`}
									disabled={openingPath !== null}
									onclick={() => reveal(entry.path!)}><code>{entry.path}</code></button
								>{/if}
							{#if entry.versionId || entry.sessionId}<div class="review-links">
									{#if entry.versionId}<button
											onclick={() => selectReview('version', entry.versionId!)}
											>Review change</button
										>{/if}
									{#if entry.sessionId}<button
											onclick={() => selectReview('session', entry.sessionId!)}>Review work</button
										>{/if}
								</div>{/if}
						</div>
					</article>
				{/each}
			{/if}
		</div>
	{:else}
		{#key reviewSelection ? `${reviewSelection.kind}:${reviewSelection.id}` : 'overview'}<ReviewPanel
				initialSelection={reviewSelection}
			/>{/key}
	{/if}
</section>

<style>
	.activity-shell {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		border-radius: inherit;
		background: var(--app-surface);
		color: var(--app-text);
		container-type: inline-size;
	}
	header {
		height: var(--app-titlebar-height);
		flex: none;
		display: flex;
		align-items: center;
		gap: 10px;
		padding-right: 12px;
		border-bottom: 1px solid var(--app-border);
		background: var(--app-chrome);
	}
	.traffic-space {
		width: 77px;
		flex: none;
	}
	header h1 {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-size: 13px;
		font-weight: 600;
	}
	nav {
		flex: none;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 2px;
		border-radius: var(--app-control-radius);
		background: var(--app-hover);
	}
	nav button {
		padding: 3px 12px;
		min-height: 23px;
		border-radius: 4px;
		color: var(--app-text-secondary);
		font-size: 11px;
	}
	nav button.active {
		background: var(--app-control);
		color: var(--app-text);
		box-shadow: 0 1px 3px #0002;
	}
	.filters {
		align-self: flex-start;
		margin: 8px 12px;
	}
	.timeline {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 0.55rem 1rem 1rem;
		background: var(--app-surface);
	}
	@container (max-width: 560px) {
		nav button {
			flex: none;
		}
		.timeline {
			padding-inline: 0.7rem;
		}
	}
	article {
		display: grid;
		grid-template-columns: 2rem 1fr;
		gap: 0.7rem;
		padding: 0.72rem 0;
		border-bottom: 1px solid var(--app-border);
	}
	.actor {
		display: grid;
		place-items: center;
		width: 1.85rem;
		height: 1.85rem;
		border-radius: 50%;
		background: var(--app-border);
		color: var(--app-text-secondary);
		font-size: 0.72rem;
		font-weight: 700;
	}
	.actor.agent {
		background: var(--app-info-bg);
		color: var(--app-accent);
	}
	.actor.terminal {
		background: var(--app-text-secondary);
		color: var(--app-surface);
	}
	.event > div {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.7rem;
	}
	.event {
		min-width: 0;
	}
	.view-tabs button {
		min-width: 68px;
	}
	.path-link {
		display: block;
		max-width: 100%;
		padding: 0;
		text-align: left;
	}
	.path-link code {
		color: var(--app-accent);
		overflow-wrap: anywhere;
	}
	.path-link:hover code {
		text-decoration: underline;
	}
	.event .review-links {
		justify-content: flex-start;
		margin-top: 7px;
		gap: 12px;
	}
	.review-links button {
		color: var(--app-accent);
		font-size: 11px;
		padding: 0;
	}
	button:focus-visible {
		outline: 2px solid var(--app-focus);
		outline-offset: 2px;
	}
	button:disabled {
		opacity: 0.45;
	}
	.error-banner {
		padding: 8px 12px;
		background: var(--app-danger-bg);
		color: var(--app-danger);
		font-size: 12px;
		line-height: 1.45;
	}
	.event strong {
		font-size: 0.78rem;
	}
	.event time {
		color: var(--app-text-tertiary);
		font-size: 0.64rem;
	}
	.event p {
		margin: 0.2rem 0 0.28rem;
		color: var(--app-text-secondary);
		font-size: 0.73rem;
		line-height: 1.4;
	}
	.event code {
		color: var(--app-text-secondary);
		font:
			0.62rem ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
	}
	.empty {
		margin: 3rem 0;
		text-align: center;
		color: var(--app-text-secondary);
		font-size: 0.78rem;
	}
</style>
