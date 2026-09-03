<script lang="ts">
	import { FitAddon } from '@xterm/addon-fit';
	import { Terminal } from '@xterm/xterm';
	import '@xterm/xterm/css/xterm.css';
	import { subscribeToDesktopCommands } from '🍎/lib/desktop/commands';
	import { terminalService, type TerminalJob } from '🍎/lib/terminal/terminal';

	let terminal: Terminal | null = null;
	let input = '';
	let busy = false;
	let cwd = $state('/Projects/Launch');
	let activeJobs = $state(0);
	let commandHistory: string[] = [];
	let historyIndex = 0;
	let historyDraft = '';
	const rendered: Record<string, { revision: number; status: TerminalJob['status'] }> = {};

	function printable(value: string) {
		return value.replace(/\r?\n/g, '\r\n');
	}

	function prompt() {
		const cwd = terminalService.cwd.replace('/Projects', '~');
		return `\x1b[38;5;39mguest@deskstead\x1b[0m:\x1b[38;5;75m${cwd}\x1b[0m $ `;
	}

	function isFinished(status: TerminalJob['status']) {
		return ['completed', 'failed', 'cancelled', 'timed_out'].includes(status);
	}

	function replaceInput(nextInput: string) {
		if (!terminal) return;
		if (input.length) terminal.write(`\x1b[${input.length}D`);
		terminal.write(`\x1b[0K${nextInput}`);
		input = nextInput;
	}

	function browseHistory(direction: -1 | 1) {
		if (!commandHistory.length) return;
		if (direction === -1) {
			if (historyIndex === commandHistory.length) historyDraft = input;
			historyIndex = Math.max(0, historyIndex - 1);
		} else {
			historyIndex = Math.min(commandHistory.length, historyIndex + 1);
		}
		replaceInput(
			historyIndex === commandHistory.length ? historyDraft : commandHistory[historyIndex],
		);
	}

	function updateActiveJobs() {
		activeJobs = terminalService
			.list()
			.filter((job) => job.status === 'queued' || job.status === 'running').length;
	}

	function renderRun(run: TerminalJob, historical = false, appendPrompt = true) {
		if (!terminal || rendered[run.id]?.revision === run.revision) return;
		const previous = rendered[run.id];
		const firstRender = !previous;
		rendered[run.id] = { revision: run.revision, status: run.status };

		if (firstRender && (run.actor !== 'human' || historical)) {
			if (!historical) terminal.write('\r\n');
			const label = run.actor === 'agent' ? '\x1b[38;5;75magent\x1b[0m' : 'guest';
			terminal.write(
				`${label}@deskstead:${run.cwd.replace('/Projects', '~')} $ ${run.command}\r\n`,
			);
		}
		if (!isFinished(run.status)) {
			if (run.background && previous?.status !== run.status) {
				terminal.write(`\x1b[38;5;244m[job ${run.id.slice(0, 8)}] ${run.status}\x1b[0m\r\n`);
			}
			updateActiveJobs();
			return;
		}

		if (run.stdout) terminal.write(printable(run.stdout));
		if (run.stderr) terminal.write(`\x1b[38;5;203m${printable(run.stderr)}\x1b[0m`);
		if (run.background || run.status !== 'completed' || (!run.stdout && !run.stderr)) {
			terminal.write(
				`\x1b[38;5;244m[job ${run.id.slice(0, 8)}] ${run.status} (exit ${run.exitCode})\x1b[0m\r\n`,
			);
		}
		busy = false;
		cwd = terminalService.cwd;
		updateActiveJobs();
		if (appendPrompt) terminal.write(prompt());
	}

	function renderNewRuns() {
		for (const run of terminalService.list()) renderRun(run);
		updateActiveJobs();
	}

	function attachTerminal(node: HTMLElement) {
		const fitAddon = new FitAddon();
		const instance = new Terminal({
			cursorBlink: true,
			fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
			fontSize: 12.5,
			lineHeight: 1.3,
			scrollback: 1_500,
			theme: {
				background: '#1d1e22',
				foreground: '#f1f1f2',
				cursor: '#f1f1f2',
				selectionBackground: '#4c72a4',
				black: '#1d1e22',
				red: '#ff6b68',
				green: '#68d391',
				yellow: '#f6c85f',
				blue: '#69a7ff',
				magenta: '#c58af9',
				cyan: '#62d6e8',
				white: '#f1f1f2',
			},
		});
		terminal = instance;
		instance.loadAddon(fitAddon);
		instance.open(node);
		fitAddon.fit();
		instance.write('\x1b[1mDeskstead Terminal\x1b[0m\r\n');
		instance.write(
			'\x1b[38;5;244mShared workspace · commands stay inside this desktop\x1b[0m\r\n\r\n',
		);

		void terminalService.ready().then(() => {
			cwd = terminalService.cwd;
			const history = terminalService.list();
			commandHistory = history.filter((run) => run.actor === 'human').map((run) => run.command);
			historyIndex = commandHistory.length;
			for (const run of history) renderRun(run, true, false);
			updateActiveJobs();
			instance.write(prompt());
		});

		const dataSubscription = instance.onData((data) => {
			if (busy) return;
			if (data === '\x1b[A') {
				browseHistory(-1);
				return;
			}
			if (data === '\x1b[B') {
				browseHistory(1);
				return;
			}
			if (data === '\r') {
				const command = input.trim();
				instance.write('\r\n');
				input = '';
				if (!command) {
					instance.write(prompt());
					return;
				}
				if (commandHistory.at(-1) !== command) commandHistory.push(command);
				historyIndex = commandHistory.length;
				historyDraft = '';
				busy = true;
				void terminalService.run(command, 'human').catch((error) => {
					instance.write(`\x1b[38;5;203m${printable(String(error))}\x1b[0m\r\n`);
					busy = false;
					instance.write(prompt());
				});
				return;
			}
			if (data === '\u007F') {
				if (!input) return;
				input = input.slice(0, -1);
				instance.write('\b \b');
				return;
			}
			if (data === '\u0003') {
				input = '';
				instance.write('^C\r\n' + prompt());
				return;
			}
			if (data === '\u000C') {
				instance.clear();
				instance.write(prompt() + input);
				return;
			}
			if (data >= ' ' && data !== '\u007F') {
				input += data;
				instance.write(data);
			}
		});

		const unsubscribe = terminalService.subscribe(renderNewRuns);
		const unsubscribeCommands = subscribeToDesktopCommands(({ target, command }) => {
			if (target !== 'terminal' || command !== 'clear') return;
			instance.clear();
			instance.write(prompt() + input);
		});
		const observer = new ResizeObserver(() => fitAddon.fit());
		observer.observe(node);

		return () => {
			observer.disconnect();
			unsubscribe();
			unsubscribeCommands();
			dataSubscription.dispose();
			instance.dispose();
			terminal = null;
		};
	}
</script>

<section class="terminal-shell">
	<header class="app-window-drag-handle">
		<div class="traffic-space" aria-hidden="true"></div>
		<div><strong>guest — bash</strong><span>{cwd}</span></div>
		<div class="session-status"><i></i>{activeJobs > 0 ? `${activeJobs} active` : 'local'}</div>
	</header>
	<div class="terminal-surface" data-testid="terminal-surface" {@attach attachTerminal}></div>
</section>

<style>
	.terminal-shell {
		display: grid;
		grid-template-rows: 3.15rem 1fr;
		height: 100%;
		overflow: hidden;
		border-radius: inherit;
		background: #1d1e22;
		color: white;
	}
	header {
		display: flex;
		align-items: center;
		padding: 0 0.85rem;
		border-bottom: 1px solid #101114;
		background: #292a2f;
	}
	.traffic-space {
		width: 4.25rem;
		flex: none;
	}
	header > div:nth-child(2) {
		margin: auto;
		text-align: center;
	}
	header strong,
	header span {
		display: block;
	}
	header strong {
		font-size: 0.75rem;
		font-weight: 600;
	}
	header span {
		margin-top: 0.1rem;
		color: #8f9097;
		font:
			0.6rem ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
	}
	.session-status {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.35rem;
		width: 4.25rem;
		color: #9a9ba2;
		font-size: 0.62rem;
	}
	.session-status i {
		width: 0.42rem;
		height: 0.42rem;
		border-radius: 50%;
		background: #53ca71;
		box-shadow: 0 0 0 2px rgba(83, 202, 113, 0.15);
	}
	.terminal-surface {
		min-width: 0;
		min-height: 0;
		padding: 0.7rem 0.75rem 0.65rem;
	}
	.terminal-surface :global(.xterm) {
		height: 100%;
	}
	.terminal-surface :global(.xterm-viewport) {
		scrollbar-color: #55565d transparent;
	}
</style>
