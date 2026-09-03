<script lang="ts">
	import { onMount } from 'svelte';
	import { createCalculatorState, inputCalculator } from '🍎/lib/calculator';
	import { subscribeToDesktopCommands } from '🍎/lib/desktop/commands';
	import { apps } from '🍎/state/apps.svelte';

	const calculator = $state(createCalculatorState());
	let keyboardRoot: HTMLElement;
	let copyMessage = $state('');
	let copyTimer: ReturnType<typeof setTimeout>;

	const keys = [
		{ key: 'clear', label: 'Clear', text: 'AC', kind: 'utility', hint: 'Clear all (Esc)' },
		{
			key: 'sign',
			label: 'Toggle sign',
			text: '±',
			kind: 'utility',
			hint: 'Change sign (Option −)',
		},
		{ key: 'percent', label: 'Percent', text: '%', kind: 'utility', hint: 'Percent (%)' },
		{ key: 'divide', label: 'Divide', text: '÷', kind: 'operation', hint: 'Divide (/)' },
		{ key: '7', label: '7', text: '7', kind: 'number' },
		{ key: '8', label: '8', text: '8', kind: 'number' },
		{ key: '9', label: '9', text: '9', kind: 'number' },
		{ key: 'multiply', label: 'Multiply', text: '×', kind: 'operation', hint: 'Multiply (*)' },
		{ key: '4', label: '4', text: '4', kind: 'number' },
		{ key: '5', label: '5', text: '5', kind: 'number' },
		{ key: '6', label: '6', text: '6', kind: 'number' },
		{ key: 'subtract', label: 'Subtract', text: '−', kind: 'operation', hint: 'Subtract (−)' },
		{ key: '1', label: '1', text: '1', kind: 'number' },
		{ key: '2', label: '2', text: '2', kind: 'number' },
		{ key: '3', label: '3', text: '3', kind: 'number' },
		{ key: 'add', label: 'Add', text: '+', kind: 'operation', hint: 'Add (+)' },
		{ key: '0', label: '0', text: '0', kind: 'number' },
		{ key: '.', label: 'Decimal', text: '.', kind: 'number' },
		{ key: 'equals', label: 'Equals', text: '=', kind: 'operation', hint: 'Equals (Enter)' },
	];

	function input(key: string) {
		copyMessage = '';
		inputCalculator(calculator, key);
	}

	async function copyResult() {
		clearTimeout(copyTimer);
		try {
			await navigator.clipboard.writeText(calculator.display);
			copyMessage = 'Copied';
		} catch {
			copyMessage = 'Could not copy';
		}
		copyTimer = setTimeout(() => (copyMessage = ''), 2000);
	}

	function handleKeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
			event.preventDefault();
			void copyResult();
			return;
		}
		if (event.metaKey || event.ctrlKey) return;
		if (event.altKey) {
			if (event.code !== 'Minus') return;
			event.preventDefault();
			input('sign');
			return;
		}
		const shortcuts: Record<string, string> = {
			'+': 'add',
			'-': 'subtract',
			'*': 'multiply',
			'/': 'divide',
			'=': 'equals',
			Enter: 'equals',
			Escape: 'clear',
			c: 'clear',
			C: 'clear',
			'%': 'percent',
			Backspace: 'backspace',
			Delete: 'backspace',
		};
		const key = /^\d$/.test(event.key) || event.key === '.' ? event.key : shortcuts[event.key];
		if (!key) return;
		event.preventDefault();
		input(key);
	}

	onMount(() => {
		// The window can mount before this lazy-loaded app. Focus when its input exists.
		if (apps.active === 'calculator' && !apps.minimized.calculator) keyboardRoot.focus();
		const unsubscribe = subscribeToDesktopCommands(({ target, command }) => {
			if (target !== 'calculator') return;
			if (command === 'clear') input('clear');
			if (command === 'copy-result') void copyResult();
		});
		return () => {
			unsubscribe();
			clearTimeout(copyTimer);
		};
	});
</script>

<!-- The application handles calculator shortcuts; individual controls remain native buttons. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
	class="calculator"
	data-keyboard-root
	tabindex="-1"
	role="application"
	aria-label="Calculator keyboard input"
	bind:this={keyboardRoot}
	onkeydown={handleKeydown}
>
	<header class="app-window-drag-handle">
		<div class="tools">
			<button aria-label="Copy result" title="Copy result (⌘C / Ctrl+C)" onclick={copyResult}>
				<svg
					width="14"
					height="14"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="1.3"
					aria-hidden="true"
				>
					<rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
					<path
						d="M10.5 3.5V3A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5"
					/>
				</svg>
			</button>
			<button
				aria-label="Delete last digit"
				title="Delete last digit (Backspace)"
				onclick={() => input('backspace')}
			>
				<svg
					width="17"
					height="14"
					viewBox="0 0 19 16"
					fill="none"
					stroke="currentColor"
					stroke-width="1.3"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M6.5 2H16a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 16 14H6.5L1 8Z" />
					<path d="m8 5 6 6m0-6-6 6" />
				</svg>
			</button>
		</div>
	</header>

	<div class="display-panel">
		<span class="copy-message" role="status">{copyMessage}</span>
		<output
			class="display"
			aria-label="Result"
			aria-live="polite"
			data-testid="calculator-display"
			style:--display-length={calculator.display.length}>{calculator.display}</output
		>
	</div>

	<div class="keypad">
		{#each keys as key (key.key)}
			<button
				class={[key.kind, { zero: key.key === '0', selected: calculator.operation === key.key }]}
				aria-label={key.label}
				aria-pressed={key.kind === 'operation' && key.key !== 'equals'
					? calculator.operation === key.key
					: undefined}
				title={key.hint}
				onclick={() => input(key.key)}>{key.text}</button
			>
		{/each}
	</div>
</section>

<style>
	.calculator {
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		display: grid;
		grid-template-rows: 2rem 4.5rem minmax(0, 1fr);
		border-radius: inherit;
		overflow: hidden;
		background: rgb(38 38 40 / 94%);
		backdrop-filter: blur(24px);
		color: #fff;
		font-family: var(--system-font-family);
	}

	header {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		padding: 0 0.5rem 0 4.5rem;
	}

	.tools {
		display: flex;
		gap: 0.125rem;
	}

	.tools button {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.3rem;
		color: #d1d1d4;
	}

	.tools svg {
		display: block;
		flex-shrink: 0;
	}

	.tools button:hover {
		background: rgb(255 255 255 / 12%);
		color: #fff;
	}

	.display-panel {
		container-type: inline-size;
		position: relative;
		min-width: 0;
		display: flex;
		align-items: flex-end;
		padding-bottom: 0.625rem;
	}

	.display {
		display: block;
		width: 100%;
		padding: 0 1rem;
		box-sizing: border-box;
		font-size: min(3rem, calc((100cqi - 2rem) / var(--display-length) / 0.65));
		font-weight: 300;
		font-variant-numeric: tabular-nums;
		line-height: 1.15;
		text-align: right;
		white-space: nowrap;
		user-select: text;
	}

	.copy-message {
		position: absolute;
		top: 0;
		right: 1rem;
		font-size: 0.65rem;
		color: #d1d1d4;
	}

	.keypad {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		grid-template-rows: repeat(5, minmax(0, 1fr));
		gap: 1px;
		background: #29292b;
		border-top: 1px solid #29292b;
	}

	.keypad button {
		display: grid;
		place-items: center;
		min-width: 0;
		min-height: 0;
		padding: 0;
		border: 0;
		border-radius: 0;
		color: #fff;
		font-family: inherit;
		font-size: 1.5rem;
		font-weight: 400;
		line-height: 1;
		touch-action: manipulation;
	}

	.number {
		background: #5c5c60;
	}
	.utility {
		background: #3e3e42;
	}
	.keypad .operation {
		background: #d87900;
		font-size: 1.875rem;
	}
	.keypad .selected {
		background: #fff3df;
		color: #a65300;
	}
	.keypad .zero {
		grid-column: span 2;
	}
	.keypad button:hover {
		filter: brightness(1.16);
	}
	.keypad button:active {
		filter: brightness(1.35);
	}
	button:focus-visible {
		outline: 2px solid white;
		outline-offset: -4px;
	}
	.calculator:focus-visible {
		outline: none;
	}

	:global(.tl-container.calculator) {
		top: 0.7rem;
		left: 0.7rem;
	}
</style>
