<script lang="ts">
	import { onMount } from 'svelte';
	import { workspaceDirname } from '🍎/lib/workspace/path';
	import { workspaceService } from '🍎/lib/workspace/workspace';

	let {
		path,
		visible,
		onselect,
		onedit,
	}: {
		path: string;
		visible: boolean;
		onselect: (path: string, intent: 'open' | 'navigate') => void;
		onedit: () => void;
	} = $props();

	let query = $state('');
	let notes = $state.raw<
		Array<{ path: string; name: string; preview: string; modifiedAt: string }>
	>([]);
	let listError = $state('');
	let noteList: HTMLElement | undefined;
	let searchInput: HTMLInputElement | undefined;
	let listRevision = 0;
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	const tabStopPath = $derived(notes.some((entry) => entry.path === path) ? path : notes[0]?.path);

	export function focusSearch() {
		searchInput?.focus();
		searchInput?.select();
	}

	export function focusCurrent() {
		noteList?.querySelector<HTMLButtonElement>('button[aria-current="page"]')?.focus();
	}

	export function nextPath(excluded: string) {
		return notes.find((entry) => entry.path !== excluded)?.path;
	}

	function dateGroup(value: string) {
		const date = new Date(value);
		const today = new Date();
		const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
		if (date.toDateString() === today.toDateString()) return 'Today';
		if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
		return 'Earlier';
	}

	function noteDate(value: string) {
		const date = new Date(value);
		return dateGroup(value) === 'Today'
			? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
			: date.toLocaleDateString([], { month: 'short', day: 'numeric' });
	}

	function navigateNotes(event: KeyboardEvent, index: number) {
		if (event.key === 'Enter') {
			event.preventDefault();
			onedit();
			return;
		}
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? notes.length - 1
					: Math.max(0, Math.min(notes.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
		onselect(notes[next].path, 'navigate');
		noteList?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
	}

	async function loadNotes() {
		const revision = ++listRevision;
		const needle = query.trim().toLowerCase();
		try {
			const paths = workspaceService
				.getAllPaths()
				.filter(
					(path) =>
						!path.startsWith('/System/') &&
						!path.startsWith('/Trash/') &&
						/\.(md|markdown|txt)$/i.test(path),
				);
			const entries = await Promise.all(
				paths.map(async (path) => {
					const entry = await workspaceService.stat(path);
					if (entry.kind !== 'file') return null;
					const content = entry.size < 1_000_000 ? await workspaceService.readText(path) : '';
					if (needle && !`${entry.name}\n${content}`.toLowerCase().includes(needle)) return null;
					const preview = content
						.replace(/^#{1,6}\s.*$/gm, '')
						.replace(/^\s*[-*+]\s+(?:\[[ xX]\]\s*)?/gm, '')
						.replace(/[#*_`>\[\]]/g, '')
						.replace(/\s+/g, ' ')
						.trim()
						.slice(0, 100);
					return {
						path,
						name: entry.name.replace(/\.(md|markdown|txt)$/i, ''),
						preview,
						modifiedAt: entry.modifiedAt,
					};
				}),
			);
			if (revision !== listRevision) return;
			notes = entries
				.filter((entry) => entry !== null)
				.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.name.localeCompare(b.name));
			listError = '';
		} catch {
			if (revision === listRevision) listError = 'Could not load notes.';
		}
	}

	onMount(() => {
		void loadNotes();
		const unsubscribe = workspaceService.subscribe(() => {
			void loadNotes();
		});
		return () => {
			listRevision++;
			clearTimeout(searchTimer);
			unsubscribe();
		};
	});
</script>

{#if visible}
	<aside aria-label="Notes">
		<div class="search">
			<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"
				><circle cx="8" cy="8" r="5" /><path d="m12 12 5 5" /></svg
			>
			<input
				aria-label="Search notes"
				placeholder="Search notes"
				value={query}
				{@attach (node) => {
					searchInput = node;
					return () => {
						searchInput = undefined;
					};
				}}
				oninput={(event) => {
					query = event.currentTarget.value;
					listRevision++;
					clearTimeout(searchTimer);
					searchTimer = setTimeout(() => {
						void loadNotes();
					}, 150);
				}}
			/>
		</div>
		<div class="list-heading"><span>All notes</span><span>{notes.length}</span></div>
		<nav
			class="note-list"
			aria-label="Note list"
			{@attach (node) => {
				noteList = node;
				return () => {
					noteList = undefined;
				};
			}}
		>
			{#each notes as entry, index (entry.path)}
				{#if !query && (index === 0 || dateGroup(notes[index - 1].modifiedAt) !== dateGroup(entry.modifiedAt))}
					<div class="date-heading">{dateGroup(entry.modifiedAt)}</div>
				{/if}
				<button
					class:selected={entry.path === path}
					aria-current={entry.path === path ? 'page' : undefined}
					title={entry.path}
					tabindex={entry.path === tabStopPath ? 0 : -1}
					onkeydown={(event) => navigateNotes(event, index)}
					onclick={() => onselect(entry.path, 'open')}
				>
					<strong>{entry.name}</strong>
					<span class="preview"
						><time datetime={entry.modifiedAt}>{noteDate(entry.modifiedAt)}</time>
						{entry.preview || 'Empty note'}</span
					>
					{#if workspaceDirname(entry.path) !== '/Notes'}<span class="folder"
							>{workspaceDirname(entry.path).slice(1)}</span
						>{/if}
				</button>
			{:else}<p class="empty-list">
					{query ? 'No matching notes.' : 'Your notes will appear here.'}
				</p>{/each}
		</nav>
		{#if listError}<p class="list-error" role="alert">
				{listError} <button onclick={loadNotes}>Retry</button>
			</p>{/if}
	</aside>
{/if}

<style>
	button:hover:not(:disabled) {
		background: var(--app-hover);
	}
	button:focus-visible,
	input:focus-visible {
		outline: 2px solid var(--app-focus);
		outline-offset: -2px;
	}
	aside {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-right: 1px solid var(--app-border);
		background: var(--app-sidebar);
	}
	.search {
		height: 29px;
		margin: 12px 12px 14px;
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 0 7px;
		background: var(--app-field);
		border-radius: var(--app-control-radius);
		border: 1px solid var(--app-control-border);
		color: var(--app-text-secondary);
	}
	.search svg {
		width: 14px;
		height: 14px;
		flex: none;
	}
	.search:focus-within {
		outline: 2px solid var(--app-focus);
		outline-offset: 1px;
	}
	.search input:focus-visible {
		outline: none;
	}
	.search input {
		color: var(--app-text);
		width: 100%;
		min-width: 0;
		background: none;
		border: none;
		font-size: 12px;
		height: 29px;
	}
	.list-heading {
		display: flex;
		justify-content: space-between;
		padding: 0 17px 7px;
		font-size: 11px;
		color: var(--app-text-secondary);
	}
	.note-list {
		padding: 0 7px 12px;
		overflow: auto;
		flex: 1;
	}
	.note-list button {
		display: block;
		text-align: left;
		width: 100%;
		padding: 12px 10px 10px;
		border-radius: 6px;
		border-bottom: 1px solid var(--app-border);
	}
	.note-list button.selected {
		color: var(--note-selected-text);
		background: var(--note-selection);
		border-color: transparent;
	}
	.selected .preview,
	.selected time,
	.selected .folder {
		color: var(--note-selected-secondary);
	}
	.note-list strong {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		font-weight: 600;
		line-height: 19px;
	}
	.preview {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-size: 12px;
		line-height: 18px;
		color: var(--app-text-secondary);
		margin-top: 3px;
	}
	.folder {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11px;
		color: var(--app-text-secondary);
		margin-top: 6px;
	}
	.date-heading {
		padding: 14px 10px 7px;
		font-size: 12px;
		font-weight: 600;
		color: var(--app-text-secondary);
	}
	.date-heading:first-child {
		padding-top: 2px;
	}
	time {
		color: var(--app-text-secondary);
		white-space: nowrap;
	}
	.empty-list {
		font-size: 12px;
		line-height: 1.6;
		padding: 24px;
		color: var(--app-text-secondary);
	}
	.list-error {
		margin: 12px;
		font-size: 11px;
		color: var(--app-danger);
	}
	.list-error button {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	@container (max-width: 560px) {
		aside {
			position: absolute;
			inset: 0;
			z-index: 2;
		}
	}
</style>
