<script lang="ts">
	import { workspaceService } from '🍎/lib/workspace/workspace';
	import { readSources, revealSource, type SourceReference } from '🍎/lib/preview/sources';
	let { path }: { path: string } = $props();
	let sources = $state.raw<SourceReference[]>([]);
	let error = $state('');
	let openError = $state('');
	let loading = $state(true);
	let opening = $state('');
	function watchSources(_node: HTMLElement) {
		const report = path;
		let active = true,
			revision = 0;
		async function refresh() {
			const turn = ++revision;
			try {
				const items = await readSources(report);
				if (active && turn === revision) {
					sources = items;
					error = '';
				}
			} catch (cause) {
				if (active && turn === revision) {
					sources = [];
					error = cause instanceof Error ? cause.message : 'Could not read sources.';
				}
			} finally {
				if (active && turn === revision) loading = false;
			}
		}
		void refresh();
		const unsubscribe = workspaceService.subscribe(() => void refresh());
		return () => {
			active = false;
			unsubscribe();
		};
	}
	async function open(reference: SourceReference) {
		opening = reference.id;
		openError = '';
		try {
			await revealSource(reference);
		} catch (cause) {
			openError = cause instanceof Error ? cause.message : 'Could not open this source.';
		} finally {
			opening = '';
		}
	}
</script>

<aside aria-label="Report sources" {@attach watchSources}>
	<header><strong>Sources</strong><span>Open the evidence in Preview</span></header>
	{#if error || openError}<p class="error" role="alert">{error || openError}</p>{/if}
	{#if loading}<p role="status">Loading references…</p>
	{:else if sources.length}
		<ul>
			{#each sources as source (source.id)}<li>
					<button
						disabled={!!opening}
						onclick={() => open(source)}
						aria-label={`Open source ${source.id}: ${source.label}, page ${source.page}`}
					>
						<span class="number">[{source.id}]</span><span
							><strong>{source.label}</strong><small
								>{source.path} · Page {source.page}{source.revision
									? ' · Checks for changes on open'
									: ''}</small
							>{#if source.quote}<q>{source.quote}</q>{/if}</span
						><span class="arrow" aria-hidden="true">↗</span>
					</button>
				</li>{/each}
		</ul>
	{:else if !error}<p>No sources are linked to this report yet.</p>{/if}
</aside>

<style>
	aside {
		flex: none;
		max-height: 190px;
		overflow: auto;
		border-bottom: 1px solid var(--app-border);
		background: var(--app-surface-secondary);
		color: var(--app-text);
		font-size: 12px;
	}
	header {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px 12px;
		padding: 8px 14px;
		position: sticky;
		top: 0;
		background: var(--app-surface-secondary);
		z-index: 1;
	}
	header span {
		color: var(--app-text-secondary);
		font-size: 12px;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		border-top: 1px solid var(--app-border);
	}
	button {
		display: flex;
		align-items: flex-start;
		width: 100%;
		gap: 10px;
		padding: 8px 14px;
		text-align: left;
		background: transparent;
		border: 0;
		color: inherit;
		font: inherit;
		line-height: 1.4;
	}
	button:hover:not(:disabled) {
		background: var(--app-hover);
	}
	button:focus-visible {
		outline: 2px solid var(--app-focus);
		outline-offset: -2px;
	}
	button:disabled {
		opacity: 0.55;
	}
	button > span:nth-child(2) {
		min-width: 0;
		flex: 1;
		overflow-wrap: anywhere;
	}
	strong {
		font-weight: 600;
	}
	.number,
	.arrow {
		color: var(--app-info);
	}
	small {
		display: block;
		color: var(--app-text-secondary);
		font-size: 11px;
		margin-top: 3px;
		overflow-wrap: anywhere;
	}
	q {
		display: block;
		font-size: 12px;
		line-height: 1.5;
		margin-top: 5px;
		white-space: pre-wrap;
	}
	p {
		margin: 0;
		padding: 8px 14px 13px;
		line-height: 1.5;
	}
	.error {
		color: var(--app-danger);
	}
</style>
