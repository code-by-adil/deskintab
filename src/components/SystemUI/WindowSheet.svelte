<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		labelledby,
		busy = false,
		returnFocus,
		onclose,
		children,
	}: {
		labelledby: string;
		busy?: boolean;
		returnFocus?: Element | null;
		onclose: () => void;
		children: Snippet;
	} = $props();

	function controls(node: HTMLElement) {
		return [
			...node.querySelectorAll<HTMLElement>(
				'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
			),
		].filter((control) => control.getClientRects().length && !control.closest('[inert]'));
	}

	function focusSheet(node: HTMLDialogElement) {
		const previous = returnFocus ?? document.activeElement;
		(controls(node)[0] ?? node).focus();
		return () => {
			// The parent removes inert during the same update that closes this sheet.
			queueMicrotask(() => {
				const focused = document.activeElement;
				if (
					(focused === document.body || node.contains(focused)) &&
					previous instanceof HTMLElement &&
					previous.isConnected
				)
					previous.focus();
			});
		};
	}

	function keydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			if (!busy) onclose();
			return;
		}
		if (event.key !== 'Tab') return;
		const node = event.currentTarget as HTMLDialogElement;
		const items = controls(node);
		const first = items[0];
		const last = items.at(-1);
		if (!first) {
			event.preventDefault();
			node.focus();
		} else if (
			event.shiftKey &&
			(document.activeElement === first || document.activeElement === node)
		) {
			event.preventDefault();
			last?.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function prepareForSubmit(event: SubmitEvent) {
		// A submitter that becomes disabled gives up focus. Keep keyboard events in the sheet.
		const sheet = event.currentTarget as HTMLDialogElement;
		if (sheet.contains(document.activeElement)) sheet.focus({ preventScroll: true });
	}
</script>

<div class="sheet-backdrop">
	<dialog
		class="sheet"
		open
		tabindex="-1"
		aria-labelledby={labelledby}
		onkeydown={keydown}
		onsubmitcapture={prepareForSubmit}
		{@attach focusSheet}
	>
		{@render children()}
	</dialog>
</div>

<style>
	.sheet-backdrop {
		position: absolute;
		inset: var(--sheet-top, var(--app-titlebar-height)) 0 0;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: var(--sheet-backdrop-padding, 22px 16px);
		background: var(--app-overlay);
		overflow: auto;
		z-index: 5;
	}
	.sheet {
		position: relative;
		display: flex;
		flex-direction: column;
		width: min(100%, var(--sheet-width, 470px));
		box-sizing: border-box;
		max-height: 100%;
		overflow: hidden;
		margin: 0;
		padding: var(--sheet-padding, 19px);
		border: 1px solid var(--app-control-border);
		border-radius: 9px;
		color: var(--app-text);
		background: var(--app-chrome);
		box-shadow: 0 12px 36px #0003;
	}
	.sheet :global(h2) {
		flex: none;
		font-size: 15px;
		font-weight: 600;
		margin: 0 0 17px;
	}
	.sheet :global(form) {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.sheet :global(.sheet-body) {
		min-height: 0;
		overflow: auto;
		padding: 4px;
		margin: -4px;
	}
	.sheet :global(label) {
		display: block;
		font-size: 12px;
		margin-bottom: 7px;
	}
	.sheet :global(input:not([type='checkbox'])),
	.sheet :global(select),
	.sheet :global(textarea) {
		display: block;
		width: 100%;
		box-sizing: border-box;
		min-height: var(--app-control-height);
		border: 1px solid var(--app-control-border);
		border-radius: var(--app-control-radius);
		padding: 6px 9px;
		background: var(--app-field);
		color: var(--app-text);
		font: inherit;
		font-size: 12px;
	}
	.sheet :global(label > input:not([type='checkbox'])),
	.sheet :global(label > select),
	.sheet :global(label > textarea) {
		margin-top: 7px;
	}
	.sheet :global(footer) {
		flex: none;
		padding-block: 8px;
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 18px;
	}
	.sheet :global(footer button) {
		border: 1px solid var(--app-control-border);
		border-radius: var(--app-control-radius);
		min-width: 65px;
		min-height: var(--app-control-height);
		padding: 4px 12px;
		color: var(--app-text);
		background: var(--app-control);
		font-size: 12px;
		box-shadow: 0 1px 1px #0001;
	}
	.sheet :global(footer button:hover:not(:disabled)) {
		background: color-mix(in srgb, var(--app-control), var(--app-text) 7%);
	}
	.sheet :global(footer button.primary) {
		color: var(--app-accent-text);
		background: var(--app-accent);
		border-color: transparent;
	}
	.sheet :global(footer button.primary:hover:not(:disabled)) {
		background: color-mix(in srgb, var(--app-accent), var(--app-accent-text) 10%);
	}
	.sheet :global(:is(button, input, select, textarea):focus-visible) {
		outline: 2px solid var(--app-focus);
		outline-offset: 2px;
	}
	@container (max-width: 500px) {
		.sheet-backdrop {
			padding: 12px 9px;
		}
	}
	@media (max-height: 500px) {
		.sheet-backdrop {
			padding: 8px;
		}
		.sheet {
			padding: 12px;
		}
		.sheet :global(h2) {
			margin-bottom: 8px;
		}
		.sheet :global(footer) {
			margin-top: 8px;
			padding-block: 2px;
		}
	}
</style>
