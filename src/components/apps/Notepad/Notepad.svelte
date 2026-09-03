<script lang="ts">
	import { onMount, tick } from 'svelte';
	import RichEditor from './RichEditor.svelte';
	import NotesList from './NotesList.svelte';
	import { subscribeToDesktopCommands, type DesktopCommand } from '🍎/lib/desktop/commands';
	import { notepadService } from '🍎/lib/workspace/notepad';
	import {
		connectNoteEditor,
		notifyNoteEditor,
		type NoteEditorSnapshot,
	} from '🍎/lib/workspace/notepad-editor';
	import { workspaceBasename, workspaceDirname, workspaceExtension } from '🍎/lib/workspace/path';
	import { workspaceService } from '🍎/lib/workspace/workspace';
	import { emptyFormatting, notepadView } from '🍎/lib/workspace/notepad-view.svelte';
	import { apps } from '🍎/state/apps.svelte';

	let note = $state.raw({ ...notepadService.current });
	let checkpointError = $state('');
	let width = $state(860);
	let notepadElement: HTMLElement | undefined;
	let sidebar = $derived(notepadView.sidebar);
	let source = $derived(notepadView.source);
	let error = $state('');
	let renaming = $state(false);
	let name = $state('');
	let creating = $state(false);
	let richEditor = $state<RichEditor>();
	let formatPopup: HTMLDivElement;
	let morePopup: HTMLDivElement;
	let linkPopup: HTMLDivElement;
	let formatButton = $state<HTMLButtonElement>();
	let moreButton: HTMLButtonElement;
	let linkButton = $state<HTMLButtonElement>();
	let notesList: NotesList | undefined;
	let linkInput: HTMLInputElement;
	let linkUrl = $state('');
	let linkError = $state('');
	let sourceEditor: HTMLTextAreaElement | undefined;
	let pendingFocusPath: string | undefined;

	const title = $derived(workspaceBasename(note.path));
	const plain = $derived(!['md', 'markdown'].includes(workspaceExtension(note.path)));
	const sourceMode = $derived(source || plain);
	const canFormat = $derived(!sourceMode && notepadView.editor.ready);
	const words = $derived(note.content.trim() ? note.content.trim().split(/\s+/).length : 0);
	const saveStatus = $derived(
		{
			loading: 'Opening...',
			saved: 'Saved',
			edited: 'Edited',
			saving: 'Saving...',
			conflict: 'Draft kept',
			missing: 'File unavailable',
			error: 'Not saved',
		}[note.status],
	);

	function positionPopup(event: ToggleEvent, button: HTMLButtonElement | undefined) {
		if (event.newState !== 'open' || !button) return;
		const popup = event.currentTarget as HTMLElement;
		const rect = button.getBoundingClientRect();
		popup.style.left = `${Math.max(8, Math.min(rect.right - 248, window.innerWidth - 256))}px`;
		popup.style.top = `${rect.bottom + 8}px`;
	}

	function closePopups() {
		formatPopup?.hidePopover();
		morePopup?.hidePopover();
		linkPopup?.hidePopover();
	}

	function format(action: string, value = 0) {
		closePopups();
		if (canFormat) richEditor?.command(action, value);
	}

	function showLink() {
		if (!canFormat) return;
		closePopups();
		linkUrl = '';
		linkError = '';
		linkPopup.showPopover();
		linkInput.focus();
	}

	function insertLink(event: SubmitEvent) {
		event.preventDefault();
		if (!/^(https?:\/\/|mailto:)/i.test(linkUrl.trim())) {
			linkError = 'Use an https://, http://, or mailto: link.';
			return;
		}
		linkPopup.hidePopover();
		richEditor?.command('link', 0, linkUrl.trim());
	}

	async function findNotes() {
		notepadView.sidebar = true;
		await tick();
		notesList?.focusSearch();
	}

	async function focusEditor(atEnd = false) {
		pendingFocusPath = note.path;
		if (width <= 560) notepadView.sidebar = false;
		await tick();
		if (note.status === 'loading') return;
		if (sourceMode && sourceEditor) {
			sourceEditor.focus();
			pendingFocusPath = undefined;
		} else if (notepadView.editor.ready && richEditor) {
			richEditor.focus(atEnd);
			pendingFocusPath = undefined;
		}
	}

	async function focusNoteList() {
		pendingFocusPath = undefined;
		notepadView.sidebar = true;
		await tick();
		notesList?.focusCurrent();
	}

	function popupKeys(event: KeyboardEvent) {
		if (
			!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) ||
			event.target instanceof HTMLInputElement
		)
			return;
		const buttons = [
			...(event.currentTarget as HTMLElement)
				.closest('.popover')!
				.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
		];
		const index = buttons.indexOf(event.target as HTMLButtonElement);
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? buttons.length - 1
					: (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
		event.preventDefault();
		buttons[next]?.focus();
	}

	$effect(() => {
		// Native popovers live above the window, so dismiss them when it loses focus.
		if (apps.active !== 'textedit' || apps.minimized.textedit) closePopups();
	});

	async function perform(action: () => Promise<unknown>) {
		error = '';
		try {
			await action();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'This action could not be completed.';
		}
	}

	async function newNote() {
		if (creating) return;
		creating = true;
		await perform(() => notepadService.create());
		creating = false;
		if (width <= 560) notepadView.sidebar = false;
	}

	function openNote(path: string, intent: 'open' | 'navigate') {
		pendingFocusPath = undefined;
		if (intent === 'open') {
			renaming = false;
			error = '';
			if (width <= 560) notepadView.sidebar = false;
		}
		void notepadService.open(path);
	}

	async function rename(event: SubmitEvent) {
		event.preventDefault();
		await perform(async () => {
			await notepadService.rename(name);
			renaming = false;
		});
	}

	function exportNote() {
		const url = URL.createObjectURL(new Blob([note.content], { type: 'text/plain;charset=utf-8' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = title;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function runCommand(command: DesktopCommand) {
		if (command === 'save') void notepadService.save();
		if (command === 'download') exportNote();
		if (command === 'trash')
			void perform(async () => {
				const path = note.path;
				await workspaceService.trash(path, { actor: 'human' });
				const next = notesList?.nextPath(path);
				if (next) await notepadService.open(next);
			});
		if (command === 'new-document') void newNote();
		if (command === 'rename') {
			name = title;
			renaming = true;
		}
		if (command === 'find') void findNotes();
		if (command === 'toggle-notes') notepadView.sidebar = !sidebar;
		if (command === 'toggle-source' && !plain) notepadView.source = !source;
		if (command === 'select-all') {
			if (sourceMode) {
				sourceEditor?.focus();
				sourceEditor?.select();
			} else richEditor?.selectAll();
		}
		if (['undo', 'redo', 'bold', 'italic', 'bullet', 'ordered', 'checklist'].includes(command))
			format(command);
		if (command === 'title') format('heading', 1);
		if (command === 'heading') format('heading', 2);
		if (command === 'subheading') format('heading', 3);
		if (command === 'body') format('heading', 0);
		if (command === 'add-link') showLink();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (apps.active !== 'textedit' || !(event.metaKey || event.ctrlKey) || event.isComposing)
			return;
		const key = event.key.toLowerCase();
		if (key === 's') {
			event.preventDefault();
			runCommand('save');
		}
		if (key === 'n') {
			event.preventDefault();
			runCommand('new-document');
		}
		if (event.code === 'KeyF' && event.altKey) {
			event.preventDefault();
			void findNotes();
		}
		if (key === 'l' && event.shiftKey) {
			event.preventDefault();
			format('checklist');
		}
		if (key === 'k') {
			event.preventDefault();
			showLink();
		}
		if (event.code === 'Backslash' && event.shiftKey) {
			event.preventDefault();
			runCommand('toggle-notes');
		}
		if (key === 'enter' && !(event.target instanceof HTMLInputElement)) {
			event.preventDefault();
			void focusNoteList();
		}
		if (event.altKey && /^Digit[0-3]$/.test(event.code)) {
			event.preventDefault();
			format('heading', Number(event.code.slice(-1)));
		}
		// ProseMirror owns its native editing shortcuts. Handle them here only
		// when a toolbar/menu has focus, preserving the editor's selection.
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			!target.closest('input, textarea, [contenteditable="true"]')
		) {
			if (key === 'z') {
				event.preventDefault();
				format(event.shiftKey ? 'redo' : 'undo');
			}
			if (key === 'b' || key === 'i') {
				event.preventDefault();
				format(key === 'b' ? 'bold' : 'italic');
			}
		}
	}

	function editorSnapshot(): NoteEditorSnapshot {
		// ResizeObserver updates the bound width after layout. Read the mounted
		// width here so a tool called immediately after a resize sees current visibility.
		const visible = !((notepadElement?.clientWidth ?? width) <= 560 && sidebar);
		if (!sourceMode) {
			const snapshot = richEditor?.getSnapshot();
			return {
				path: note.path,
				mode: 'formatted',
				content: snapshot?.content ?? '',
				ready: Boolean(snapshot?.ready && snapshot.content === note.content),
				visible,
				selection: snapshot?.selection ?? null,
			};
		}
		const content = sourceEditor?.value ?? '';
		const start = sourceEditor?.selectionStart ?? 0;
		const end = sourceEditor?.selectionEnd ?? 0;
		return {
			path: note.path,
			mode: plain ? 'plain' : 'markdown',
			content,
			ready: Boolean(sourceEditor && content === note.content),
			visible,
			selection:
				start === end
					? null
					: {
							text: content.slice(start, end),
							before: content.slice(Math.max(0, start - 200), start),
							after: content.slice(end, end + 200),
							sourceStart: start,
							sourceEnd: end,
						},
		};
	}

	$effect(() => {
		// Notify tool calls after Svelte has rendered a new note or source view.
		note.path;
		note.content;
		sourceMode;
		richEditor;
		notifyNoteEditor();
	});

	onMount(() => {
		notepadView.sidebar = window.innerWidth > 700;
		notepadView.source = false;
		notepadView.plain = plain;
		const unsubscribe = notepadService.subscribe(() => {
			const next = notepadService.current;
			if (next.path !== note.path) renaming = false;
			if (next.path !== note.path) closePopups();
			notepadView.plain = !['md', 'markdown'].includes(workspaceExtension(next.path));
			note = { ...next };
			checkpointError = notepadService.checkpointError;
		});
		const unsubscribeCommands = subscribeToDesktopCommands(({ target, command }) => {
			if (target !== 'textedit') return;
			runCommand(command);
		});
		const disconnectEditor = connectNoteEditor(editorSnapshot);
		return () => {
			disconnectEditor();
			notepadView.editor = emptyFormatting();
			unsubscribe();
			unsubscribeCommands();
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<section
	class="notepad"
	bind:clientWidth={width}
	{@attach (element) => {
		notepadElement = element;
		return () => {
			notepadElement = undefined;
		};
	}}
>
	<header class="titlebar app-window-drag-handle">
		<div class="traffic-space"></div>
		<button
			class="icon-button sidebar-toggle"
			aria-label={sidebar ? 'Hide notes' : 'Show notes'}
			aria-expanded={sidebar}
			title="Show or hide notes"
			onclick={() => (notepadView.sidebar = !sidebar)}
		>
			<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4"
				><rect x="2" y="3" width="16" height="14" rx="2" /><path d="M7 3v14" /></svg
			>
		</button>

		<button
			class="icon-button"
			title="New note, ⌘N"
			aria-label="New note"
			disabled={creating}
			onclick={newNote}
		>
			<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4"
				><path
					d="M10 3H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6M10 12l-4 1 1-4L15 1l3 3Z"
				/></svg
			>
		</button>
		<div class="document-title">
			{#if renaming}
				<form onsubmit={rename}>
					<input
						aria-label="Note name"
						bind:value={name}
						onkeydown={(event) => {
							if (event.key === 'Escape') renaming = false;
						}}
						{@attach (node) => {
							node.focus();
							node.select();
						}}
					/>
					<button type="submit" aria-label="Save name">Save</button>
				</form>
			{:else}
				<button
					class="name-button"
					title="Rename note"
					aria-label={`Rename ${title}`}
					disabled={note.status === 'loading' || note.status === 'missing'}
					onclick={() => {
						name = title;
						renaming = true;
					}}>{title.replace(/\.(md|markdown|txt)$/i, '')}</button
				>
				<span title={note.path}>{workspaceDirname(note.path)}</span>
			{/if}
		</div>
		{#if !sourceMode}
			<div class="toolbar-formatting" role="group" aria-label="Formatting">
				<button
					class="icon-button text-style"
					aria-label="Text formatting"
					title="Text formatting"
					disabled={!canFormat}
					popovertarget="notepad-format"
					bind:this={formatButton}>Aa</button
				>
				<button
					class="icon-button"
					aria-label="Checklist"
					title="Checklist, ⇧⌘L"
					aria-pressed={notepadView.editor.list === 'checklist'}
					disabled={!canFormat}
					onclick={() => format('checklist')}
				>
					<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"
						><circle cx="5" cy="5" r="3" /><path d="m3.5 5 1 1 2-2M11 5h7M11 14h7" /><circle
							cx="5"
							cy="14"
							r="3"
						/></svg
					>
				</button>
				<button
					class="icon-button"
					aria-label="Add a link"
					title="Add a link, ⌘K"
					disabled={!canFormat}
					bind:this={linkButton}
					onclick={showLink}
				>
					<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"
						><path d="m8 6 2-2a4 4 0 0 1 6 6l-2 2M6 8l-2 2a4 4 0 0 0 6 6l2-2M7 13l6-6" /></svg
					>
				</button>
			</div>
		{/if}
		<button
			class="icon-button"
			aria-label="More note actions"
			title="More"
			popovertarget="notepad-more"
			bind:this={moreButton}
		>
			<svg viewBox="0 0 20 20" fill="currentColor"
				><circle cx="4" cy="10" r="1.4" /><circle cx="10" cy="10" r="1.4" /><circle
					cx="16"
					cy="10"
					r="1.4"
				/></svg
			>
		</button>
	</header>
	<div
		id="notepad-format"
		class="popover"
		popover="auto"
		role="group"
		aria-label="Text formatting"
		bind:this={formatPopup}
		onbeforetoggle={(event) => positionPopup(event, formatButton)}
	>
		<div class="popover-label">Paragraph style</div>
		{#each [{ label: 'Title', level: 1 }, { label: 'Heading', level: 2 }, { label: 'Subheading', level: 3 }, { label: 'Body', level: 0 }] as style (style.level)}
			<button
				onkeydown={popupKeys}
				class="popover-row"
				class:chosen={notepadView.editor.heading === style.level}
				aria-pressed={notepadView.editor.heading === style.level}
				aria-label={style.label}
				onclick={() => format('heading', style.level)}
				><span>{style.label}</span><kbd>⌥⌘{style.level}</kbd></button
			>
		{/each}
		<div class="popover-divider"></div>
		<div class="marks">
			<button
				onkeydown={popupKeys}
				aria-label="Bold"
				aria-pressed={notepadView.editor.bold}
				onclick={() => format('bold')}><b>B</b></button
			>
			<button
				onkeydown={popupKeys}
				aria-label="Italic"
				aria-pressed={notepadView.editor.italic}
				onclick={() => format('italic')}><i>I</i></button
			>
		</div>
		<div class="popover-divider"></div>
		{#each [{ action: 'bullet', label: 'Bulleted list' }, { action: 'ordered', label: 'Numbered list' }] as item (item.action)}
			<button
				onkeydown={popupKeys}
				class="popover-row"
				aria-pressed={notepadView.editor.list === item.action}
				onclick={() => format(item.action)}>{item.label}</button
			>
		{/each}
	</div>
	<div
		id="notepad-more"
		class="popover"
		popover="auto"
		role="group"
		aria-label="Note actions"
		bind:this={morePopup}
		onbeforetoggle={(event) => positionPopup(event, moreButton)}
	>
		<button
			onkeydown={popupKeys}
			class="popover-row"
			disabled={note.status === 'loading' || note.status === 'missing'}
			onclick={() => {
				closePopups();
				runCommand('rename');
			}}>Rename…</button
		>
		<button
			onkeydown={popupKeys}
			class="popover-row"
			aria-label="Download note"
			disabled={note.status === 'loading'}
			onclick={() => {
				closePopups();
				exportNote();
			}}>Download Note</button
		>
		<div class="popover-divider"></div>
		{#each [{ action: 'undo', label: 'Undo', shortcut: '⌘Z', enabled: notepadView.editor.undo }, { action: 'redo', label: 'Redo', shortcut: '⇧⌘Z', enabled: notepadView.editor.redo }] as item (item.action)}
			<button
				onkeydown={popupKeys}
				class="popover-row"
				disabled={!canFormat || !item.enabled}
				onclick={() => format(item.action)}
				><span>{item.label}</span><kbd>{item.shortcut}</kbd></button
			>
		{/each}
		<div class="popover-divider"></div>
		<button
			onkeydown={popupKeys}
			class="popover-row"
			disabled={note.status === 'loading' || note.status === 'missing'}
			onclick={() => {
				closePopups();
				runCommand('trash');
			}}>Move to Trash</button
		>
	</div>
	<div
		id="notepad-link"
		class="popover"
		popover="auto"
		role="group"
		aria-label="Add a link"
		bind:this={linkPopup}
		onbeforetoggle={(event) => positionPopup(event, linkButton)}
	>
		<form onsubmit={insertLink}>
			<label for="notepad-link-url">Link address</label>
			<input
				id="notepad-link-url"
				aria-label="Link URL"
				placeholder="https://example.com"
				bind:value={linkUrl}
				bind:this={linkInput}
			/>
			{#if linkError}<small role="alert">{linkError}</small>{/if}
			<div class="link-actions">
				<button
					onkeydown={popupKeys}
					type="button"
					onclick={() => {
						linkPopup.hidePopover();
						linkButton?.focus();
					}}>Cancel</button
				><button onkeydown={popupKeys} type="submit">Add Link</button>
			</div>
		</form>
	</div>
	<div class="body" class:with-sidebar={sidebar}>
		<NotesList
			path={note.path}
			visible={sidebar}
			onselect={openNote}
			onedit={() => focusEditor(true)}
			bind:this={notesList}
		/>
		<div class="document">
			{#if error || checkpointError}<div class="notice" role="alert">
					{error || checkpointError}<button
						onclick={() => {
							error = '';
							void notepadService.save();
						}}>Retry</button
					>
				</div>{/if}
			{#if note.status === 'conflict' || note.status === 'missing' || note.status === 'error'}
				<div class="notice" role="status">
					<span
						>{note.status === 'conflict'
							? 'This note changed elsewhere. Your draft is kept.'
							: note.status === 'missing'
								? 'This file is no longer here. You can keep a copy.'
								: note.error}</span
					>
					<div class="notice-actions">
						<button onclick={() => perform(() => notepadService.saveCopy())}>Save a copy</button>
						{#if note.status === 'conflict'}<button
								onclick={() => perform(() => notepadService.useFileVersion())}
								>Use file version</button
							>{/if}
						{#if note.status === 'error'}<button onclick={() => notepadService.save()}
								>Retry save</button
							>{/if}
					</div>
				</div>
			{/if}
			<div class="editor-content">
				{#if note.status === 'loading'}
					<p class="loading">Opening note...</p>
				{:else if sourceMode}
					<div class="source-label">{plain ? 'Plain text' : 'Markdown'}</div>
					{#key note.path}
						<textarea
							aria-label="Document source"
							data-testid="document-source"
							spellcheck="true"
							value={note.content}
							oninput={(event) => notepadService.edit(event.currentTarget.value)}
							onblur={() => notepadService.save()}
							{@attach (node) => {
								sourceEditor = node;
								if (pendingFocusPath === note.path) {
									node.focus();
									pendingFocusPath = undefined;
								}
								return () => {
									sourceEditor = undefined;
								};
							}}></textarea>
					{/key}
				{:else}
					{#key note.path}<RichEditor
							content={note.content}
							onready={() => {
								if (pendingFocusPath === note.path) {
									richEditor?.focus(true);
									pendingFocusPath = undefined;
								}
							}}
							onchange={(content) => notepadService.edit(content)}
							onerror={(message) => {
								error = message;
								notepadView.source = true;
							}}
							bind:this={richEditor}
						/>{/key}
				{/if}
			</div>
			<footer>
				<span class="save-status" data-testid="save-status">{saveStatus}</span>
				<span class="word-count">{words} {words === 1 ? 'word' : 'words'}</span>
				{#if !plain}<button
						aria-label={source ? 'Show formatted note' : 'Show Markdown source'}
						aria-pressed={source}
						title={source ? 'Show formatted note' : 'Show Markdown source'}
						onclick={() => (notepadView.source = !source)}
						>{source ? 'Formatted' : 'Markdown'}</button
					>{/if}
			</footer>
		</div>
	</div>
</section>

<style>
	.notepad {
		--note-paper: #fffefa;
		--note-soft: #f5f3ec;
		--note-line: #dedbd4;
		--note-accent: #936500;
		--note-selection: #f6dfa0;
		--note-selected-text: #47380f;
		--note-selected-secondary: #695a36;
		container-type: inline-size;
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: inherit;
		color: var(--app-text);
		background: var(--note-paper);
		font-family: var(--system-font-family);
	}
	:global(body.dark) .notepad {
		--note-paper: #242322;
		--note-soft: #2e2c28;
		--note-line: #41403b;
		--note-accent: #eac15d;
		--note-selection: #655321;
		--note-selected-text: #fff0bd;
		--note-selected-secondary: #e0d1a2;
	}
	.titlebar {
		height: var(--app-titlebar-height);
		flex: none;
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 0 12px 0 0;
		border-bottom: 1px solid var(--app-border);
		background: var(--app-chrome);
	}
	.traffic-space {
		width: 83px;
		flex: none;
	}
	.icon-button {
		flex: none;
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: var(--app-control-radius);
		color: var(--app-text-secondary);
	}
	svg {
		width: 18px;
		height: 18px;
	}
	button:hover:not(:disabled) {
		background: var(--app-hover);
	}
	button:focus-visible,
	input:focus-visible,
	textarea:focus-visible {
		outline: 2px solid var(--app-focus);
		outline-offset: -2px;
	}
	button:disabled {
		opacity: 0.4;
	}
	.document-title {
		min-width: 0;
		flex: 1;
		text-align: center;
		padding: 0 8px;
	}
	.name-button {
		max-width: 100%;
		padding: 2px 5px;
		border-radius: 3px;
		font-size: 12px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.document-title > span {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11px;
		line-height: 14px;
		color: var(--app-text-secondary);
	}
	.document-title form {
		display: flex;
		gap: 6px;
		justify-content: center;
		align-items: center;
		font-size: 12px;
	}
	.document-title input {
		min-width: 0;
		width: 180px;
		background: var(--note-paper);
		border: 1px solid var(--app-control-border);
		border-radius: 4px;
		padding: 5px;
	}
	.document-title form button {
		padding: 4px;
		border-radius: 4px;
	}
	.body {
		min-height: 0;
		flex: 1;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		position: relative;
	}
	.body.with-sidebar {
		grid-template-columns: 225px minmax(0, 1fr);
	}
	.document {
		min-height: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.editor-content {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.editor-content > :global(.rich-editor) {
		flex: 1;
	}
	.loading {
		font-size: 12px;
		line-height: 1.6;
		padding: 24px;
		color: var(--app-text-secondary);
	}
	.source-label {
		height: 38px;
		display: flex;
		align-items: center;
		padding: 0 22px;
		font-size: 11px;
		color: var(--app-text-secondary);
		border-bottom: 1px solid var(--note-line);
		background: var(--note-soft);
	}
	textarea {
		resize: none;
		width: 100%;
		flex: 1;
		min-height: 0;
		padding: 26px 30px 60px;
		border: 0;
		background: var(--note-paper);
		color: var(--app-text);
		font:
			12px/1.8 'SFMono-Regular',
			Consolas,
			monospace;
		cursor: text;
	}
	footer {
		height: 29px;
		flex: none;
		display: flex;
		align-items: center;
		gap: 14px;
		border-top: 1px solid var(--note-line);
		padding: 0 16px;
		font-size: 11px;
		color: var(--app-text-secondary);
	}
	.save-status {
		flex: 1;
	}
	footer button {
		color: var(--app-text-secondary);
		font-size: 11px;
		padding: 3px 5px;
		border-radius: 3px;
	}
	.notice {
		padding: 9px 15px;
		display: flex;
		flex-wrap: wrap;
		gap: 6px 12px;
		font-size: 11px;
		line-height: 1.5;
		background: var(--app-warning-bg);
		border-bottom: 1px solid var(--app-border);
		color: var(--app-warning);
	}
	.notice-actions {
		display: flex;
		gap: 12px;
	}
	.notice button {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.toolbar-formatting {
		display: flex;
		gap: 3px;
		align-items: center;
	}
	.text-style {
		font-size: 17px;
		letter-spacing: -0.6px;
	}
	.icon-button[aria-pressed='true'] {
		color: var(--note-selected-text);
		background: var(--note-selection);
	}
	.popover {
		position: fixed;
		margin: 0;
		width: 248px;
		max-width: calc(100vw - 16px);
		padding: 7px;
		border: 1px solid var(--app-border);
		border-radius: 9px;
		color: var(--app-text);
		background: var(--app-chrome);
		backdrop-filter: blur(16px);
		box-shadow:
			0 8px 28px #0003,
			0 1px 3px #0001;
		font: 13px/1.4 var(--system-font-family);
	}
	.popover-label {
		color: var(--app-text-secondary);
		font-size: 11px;
		padding: 4px 9px 6px;
	}
	.popover-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 20px;
		width: 100%;
		text-align: left;
		padding: 6px 9px;
		border-radius: 4px;
		min-height: 30px;
	}
	.popover-row.chosen,
	.popover-row[aria-pressed='true'] {
		background: var(--app-hover);
	}
	.popover-row.chosen::before {
		content: '✓';
		color: var(--note-accent);
	}
	.popover-row.chosen > span {
		flex: 1;
	}
	.popover-divider {
		height: 1px;
		background: var(--app-border);
		margin: 5px;
	}
	kbd {
		color: var(--app-text-secondary);
		font: inherit;
		font-size: 12px;
	}
	.marks {
		display: flex;
		gap: 6px;
		padding: 3px 5px;
	}
	.marks button {
		flex: 1;
		border-radius: var(--app-control-radius);
		background: var(--app-control);
		height: 30px;
		font-size: 16px;
	}
	.marks button[aria-pressed='true'] {
		color: var(--note-selected-text);
		background: var(--note-selection);
	}
	.popover form {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 6px;
	}
	.popover input {
		width: 100%;
		border: 1px solid var(--app-control-border);
		padding: 6px 8px;
		border-radius: var(--app-control-radius);
		background: var(--app-field);
	}
	.popover small {
		color: var(--app-danger);
	}
	.link-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.link-actions button {
		padding: 4px 8px;
		border-radius: 4px;
		background: var(--app-control);
	}
	@container (max-width: 560px) {
		.toolbar-formatting {
			gap: 0;
		}
		.toolbar-formatting .icon-button {
			width: 28px;
		}
		.document-title > span {
			display: none;
		}
		.name-button {
			font-size: 11px;
		}
	}
	@container (max-width: 700px) {
		.body.with-sidebar {
			grid-template-columns: 175px minmax(0, 1fr);
		}
	}
	@container (max-width: 560px) {
		.body.with-sidebar {
			display: block;
		}
		.with-sidebar .document {
			visibility: hidden;
			height: 100%;
		}
		.traffic-space {
			width: 77px;
		}
		.titlebar {
			gap: 1px;
			padding-right: 8px;
		}
		.document-title {
			padding: 0 3px;
		}
		textarea {
			padding: 20px;
		}
	}
</style>
