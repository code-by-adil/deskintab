<script lang="ts">
	import { untrack } from 'svelte';
	import { CrepeBuilder } from '@milkdown/crepe/builder';
	import { listItem } from '@milkdown/crepe/feature/list-item';
	import { placeholder } from '@milkdown/crepe/feature/placeholder';
	import {
		commandsCtx,
		editorViewCtx,
		editorViewOptionsCtx,
		serializerCtx,
	} from '@milkdown/kit/core';
	import { uploadPlugin } from '@milkdown/kit/plugin/upload';
	import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
	import { closeHistory, undo, redo } from '@milkdown/kit/prose/history';
	import { Plugin, AllSelection, Selection } from '@milkdown/kit/prose/state';
	import {
		toggleStrongCommand,
		toggleEmphasisCommand,
		wrapInHeadingCommand,
		turnIntoTextCommand,
		wrapInBlockTypeCommand,
		bulletListSchema,
		orderedListSchema,
		listItemSchema,
		toggleLinkCommand,
	} from '@milkdown/kit/preset/commonmark';
	import { $prose as prosePlugin, replaceAll } from '@milkdown/kit/utils';
	import '@milkdown/crepe/theme/common/prosemirror.css';
	import '@milkdown/crepe/theme/common/reset.css';
	import '@milkdown/crepe/theme/common/list-item.css';
	import '@milkdown/crepe/theme/common/placeholder.css';
	import '@milkdown/crepe/theme/frame.css';
	import { emptyFormatting, notepadView } from '🍎/lib/workspace/notepad-view.svelte';
	import { notifyNoteEditor, type NoteSelection } from '🍎/lib/workspace/notepad-editor';

	let {
		content,
		onchange,
		onerror,
		onready,
	}: {
		content: string;
		onchange: (content: string) => void;
		onerror: (message: string) => void;
		onready: () => void;
	} = $props();

	let builder: CrepeBuilder | undefined;
	let ready = $state(false);
	let applying = false;
	let lastContent = '';

	function mountEditor(element: HTMLElement) {
		let disposed = false;
		lastContent = untrack(() => content);
		const instance = new CrepeBuilder({ root: element, defaultValue: lastContent })
			.addFeature(listItem, {
				checkBoxCheckedIcon:
					'<input class="notepad-check" type="checkbox" checked aria-label="Complete item" tabindex="0">',
				checkBoxUncheckedIcon:
					'<input class="notepad-check" type="checkbox" aria-label="Complete item" tabindex="0">',
			})
			.addFeature(placeholder, { text: 'Start writing...', mode: 'doc' });
		builder = instance;
		instance.editor
			.config((ctx) => {
				ctx.update(editorViewOptionsCtx, (options) => ({
					...options,
					handleDOMEvents: {
						keydown(view, event) {
							const target = event.target;
							if (
								!(target instanceof HTMLInputElement) ||
								!target.classList.contains('notepad-check') ||
								![' ', 'Enter'].includes(event.key)
							)
								return false;
							event.preventDefault();
							const position = view.state.doc.resolve(view.posAtDOM(target, 0));
							for (let depth = position.depth; depth > 0; depth--) {
								const item = position.node(depth);
								if (item.type.name !== 'list_item') continue;
								view.dispatch(
									view.state.tr.setNodeMarkup(position.before(depth), undefined, {
										...item.attrs,
										checked: !item.attrs.checked,
									}),
								);
								break;
							}
							return true;
						},
					},
					attributes: {
						role: 'textbox',
						'aria-label': 'Document editor',
						'aria-multiline': 'true',
						'data-testid': 'document-editor',
						spellcheck: 'true',
					},
				}));
			})
			.use(
				prosePlugin(
					(ctx) =>
						new Plugin({
							view: () => ({
								update(view, previous) {
									if (disposed) return;
									const { state } = view;
									// AllSelection starts at the document boundary. Read its first
									// text block so menus still reflect the selected text's style.
									const fromPosition = state.selection.$from.depth
										? state.selection.$from
										: state.doc.resolve(Math.min(1, state.doc.content.size));
									const marks = state.storedMarks ?? fromPosition.marks();
									let list: 'bullet' | 'ordered' | 'checklist' | '' = '';
									for (let depth = fromPosition.depth; depth > 0; depth--) {
										const node = fromPosition.node(depth);
										if (node.type.name === 'list_item' && node.attrs.checked != null) {
											list = 'checklist';
											break;
										}
										if (node.type.name === 'bullet_list') {
											list = 'bullet';
											break;
										}
										if (node.type.name === 'ordered_list') {
											list = 'ordered';
											break;
										}
									}
									notepadView.editor = {
										ready,
										list,
										bold: marks.some((mark) => mark.type.name === 'strong'),
										italic: marks.some((mark) => mark.type.name === 'emphasis'),
										heading:
											fromPosition.parent.type.name === 'heading'
												? fromPosition.parent.attrs.level
												: 0,
										undo: undo(state),
										redo: redo(state),
									};
									if (applying || state.doc.eq(previous.doc)) return;
									// Milkdown's markdownUpdated event is debounced. Capture the
									// transaction now so a quick close cannot miss the last keystroke.
									lastContent = ctx.get(serializerCtx)(state.doc);
									onchange(lastContent);
								},
							}),
						}),
				),
			);
		// The default upload plugin creates temporary blob URLs. A notepad
		// should not pretend those are durable file attachments.
		void instance.editor
			.remove(uploadPlugin)
			.then(() => instance.create())
			.then(() => {
				if (disposed) {
					void instance.destroy();
					return;
				}
				ready = true;
				notepadView.editor.ready = true;
				instance.editor.action((ctx) => {
					const view = ctx.get(editorViewCtx);
					view.dispatch(view.state.tr);
				});
				onready();
				notifyNoteEditor();
			})
			.catch((error) => {
				if (!disposed)
					onerror(error instanceof Error ? error.message : 'The editor could not load.');
			});
		return () => {
			disposed = true;
			ready = false;
			notepadView.editor = emptyFormatting();
			if (instance.editor.status === 'Created') void instance.destroy();
			builder = undefined;
		};
	}

	$effect(() => {
		if (!ready || !builder || content === lastContent) return;
		applying = true;
		lastContent = content;
		try {
			builder.editor.action((ctx) => {
				const view = ctx.get(editorViewCtx);
				// Keep external edits in the existing history, separate from typing
				// on either side, so one Undo reverses just the external edit.
				view.dispatch(closeHistory(view.state.tr));
				replaceAll(content)(ctx);
				view.dispatch(closeHistory(view.state.tr));
			});
		} finally {
			applying = false;
		}
		notifyNoteEditor();
	});

	export function getSnapshot(): {
		ready: boolean;
		content: string;
		selection: NoteSelection | null;
	} {
		if (!ready || !builder) return { ready: false, content: lastContent, selection: null };
		const selection = builder.editor.action((ctx) => {
			const { doc, selection } = ctx.get(editorViewCtx).state;
			if (selection.empty) return null;
			const { from, to } = selection;
			return {
				text: doc.textBetween(from, to, '\n', '\ufffc'),
				before: doc.textBetween(Math.max(0, from - 200), from, '\n', '\ufffc'),
				after: doc.textBetween(to, Math.min(doc.content.size, to + 200), '\n', '\ufffc'),
			};
		});
		return { ready: true, content: lastContent, selection };
	}

	export function selectAll() {
		if (!ready || !builder) return;
		builder.editor.action((ctx) => {
			const view = ctx.get(editorViewCtx);
			view.focus();
			view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
		});
	}

	export function focus(atEnd = false) {
		if (!ready || !builder) return;
		builder.editor.action((ctx) => {
			const view = ctx.get(editorViewCtx);
			if (atEnd)
				view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).scrollIntoView());
			view.focus();
		});
	}

	export function command(action: string, value = 0, href = '') {
		if (!ready || !builder) return;
		builder.editor.action((ctx) => {
			const commands = ctx.get(commandsCtx);
			ctx.get(editorViewCtx).focus();
			if (action === 'bold') commands.call(toggleStrongCommand.key);
			if (action === 'italic') commands.call(toggleEmphasisCommand.key);
			if (action === 'undo') commands.call(undoCommand.key);
			if (action === 'redo') commands.call(redoCommand.key);
			if (action === 'heading') {
				if (value) commands.call(wrapInHeadingCommand.key, value);
				else commands.call(turnIntoTextCommand.key);
			}
			if (action === 'bullet')
				commands.call(wrapInBlockTypeCommand.key, { nodeType: bulletListSchema.type(ctx) });
			if (action === 'ordered')
				commands.call(wrapInBlockTypeCommand.key, { nodeType: orderedListSchema.type(ctx) });
			if (action === 'checklist')
				commands.call(wrapInBlockTypeCommand.key, {
					nodeType: listItemSchema.type(ctx),
					attrs: { checked: false },
				});
			if (action === 'link') commands.call(toggleLinkCommand.key, { href });
		});
	}
</script>

<div class="rich-editor">
	<div class="writing-area"><div {@attach mountEditor}></div></div>
</div>

<style>
	.rich-editor {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	.writing-area {
		overflow: auto;
		flex: 1;
		min-height: 0;
		overscroll-behavior: contain;
		cursor: text;
	}
	.writing-area > div {
		min-height: 100%;
	}
	.writing-area :global(.milkdown) {
		--crepe-font-default: var(--system-font-family);
		--crepe-font-title: var(--system-font-family);
		--crepe-font-code: 'SFMono-Regular', Consolas, monospace;
		--crepe-color-background: var(--note-paper);
		--crepe-color-on-background: var(--app-text);
		--crepe-color-surface: var(--app-chrome);
		--crepe-color-surface-low: var(--note-soft);
		--crepe-color-on-surface: var(--app-text);
		--crepe-color-on-surface-variant: var(--app-text-secondary);
		--crepe-color-outline: var(--app-text-secondary);
		--crepe-color-primary: var(--note-accent);
		--crepe-color-secondary: var(--note-selection);
		--crepe-color-on-secondary: var(--note-selected-text);
		--crepe-color-inverse: var(--app-text);
		--crepe-color-on-inverse: var(--note-paper);
		--crepe-color-inline-code: var(--app-danger);
		--crepe-color-error: var(--app-danger);
		--crepe-color-hover: var(--app-hover);
		--crepe-color-selected: var(--note-selection);
		--crepe-color-inline-area: var(--note-soft);
		--crepe-base-font-size: 14px;
		min-height: 100%;
	}
	.writing-area :global(.ProseMirror) {
		padding: 30px clamp(22px, 7%, 60px) 90px;
		min-height: 340px;
		line-height: 1.7;
		overflow-wrap: anywhere;
	}
	.writing-area :global(.ProseMirror h1) {
		font-size: 25px;
		font-weight: 650;
		line-height: 1.3;
		margin: 24px 0 14px;
		letter-spacing: -0.6px;
	}
	.writing-area :global(.ProseMirror h2) {
		font-size: 20px;
		font-weight: 600;
		margin: 22px 0 8px;
	}
	.writing-area :global(.ProseMirror h3) {
		font-size: 16px;
		font-weight: 600;
		margin: 18px 0 6px;
	}
	.writing-area :global(.ProseMirror > :first-child) {
		margin-top: 0;
	}
	.writing-area :global(.ProseMirror p) {
		line-height: 1.7;
		padding: 3px 0;
		margin: 0 0 9px;
	}
	.writing-area :global(.ProseMirror li p) {
		margin: 0;
	}
	.writing-area :global(.ProseMirror strong) {
		font-weight: 700;
	}
	.writing-area :global(.ProseMirror em) {
		font-style: italic;
	}
	.writing-area :global(.ProseMirror blockquote) {
		padding-left: 18px;
		color: var(--app-text-secondary);
		margin: 12px 0;
	}
	.writing-area :global(.ProseMirror blockquote::before) {
		width: 3px;
		border-radius: 1px;
	}
	.writing-area :global(.ProseMirror table) {
		width: 100%;
		border-collapse: collapse;
		margin: 14px 0;
		font-size: 13px;
	}
	.writing-area :global(.ProseMirror td),
	.writing-area :global(.ProseMirror th) {
		border: 1px solid var(--note-line);
		padding: 6px 10px;
	}
	.writing-area :global(.ProseMirror th) {
		background: var(--note-soft);
		font-weight: 600;
	}
	.writing-area :global(.ProseMirror pre) {
		overflow: auto;
		margin: 14px 0;
		padding: 12px;
		background: var(--note-soft);
	}
	.writing-area :global(.milkdown-list-item-block .label-wrapper) {
		height: 30px;
	}
	.writing-area :global(.milkdown-list-item-block .label-wrapper svg) {
		width: 18px;
		height: 18px;
	}
	.writing-area :global(.notepad-check) {
		appearance: none;
		width: 17px;
		height: 17px;
		border: 1.5px solid var(--app-text-tertiary);
		border-radius: 50%;
		background: transparent;
		display: grid;
		place-content: center;
		cursor: pointer;
	}
	.writing-area :global(.notepad-check:checked) {
		background: var(--note-accent);
		border-color: var(--note-accent);
	}
	.writing-area :global(.notepad-check:checked::after) {
		content: '';
		width: 8px;
		height: 4px;
		border-left: 1.5px solid var(--note-paper);
		border-bottom: 1.5px solid var(--note-paper);
		transform: translateY(-1px) rotate(-45deg);
	}
	@media (forced-colors: active) {
		.writing-area :global(.notepad-check) {
			appearance: auto;
		}
	}

	.writing-area :global(.notepad-check:focus-visible) {
		outline: 2px solid var(--app-focus);
		outline-offset: 2px;
	}
</style>
