import { mount } from 'svelte';
import Desktop from './components/Desktop/Desktop.svelte';
import './css/global.css';
import { workspaceService } from './lib/workspace/workspace';
import { registerWebMCPTools } from './lib/webmcp/register';
import { notepadService } from './lib/workspace/notepad';
import { AppError } from './lib/errors';

async function startDesktop() {
	await workspaceService.ready();
	await notepadService.ready();
	const protectPendingDraft = (event: BeforeUnloadEvent) => {
		if (!notepadService.hasPendingWrites) return;
		event.preventDefault();
		event.returnValue = '';
	};
	window.addEventListener('beforeunload', protectPendingDraft);
	const desktop = mount(Desktop, {
		target: document.getElementById('root')!,
	});
	const unregisterTools = await registerWebMCPTools();
	if (import.meta.hot)
		import.meta.hot.dispose(() => {
			unregisterTools();
			window.removeEventListener('beforeunload', protectPendingDraft);
		});
	return desktop;
}

function showStartupError(error: unknown) {
	const panel = document.createElement('main');
	panel.setAttribute('aria-labelledby', 'workspace-startup-title');
	panel.style.cssText =
		'height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:32px;text-align:center;background:var(--app-surface);color:var(--app-text)';
	const title = document.createElement('h1');
	title.id = 'workspace-startup-title';
	title.textContent =
		error instanceof AppError ? error.message : 'The workspace could not be opened.';
	title.style.cssText = 'font-size:22px;line-height:1.3;font-weight:600;max-width:560px';
	const description = document.createElement('p');
	description.textContent =
		error instanceof AppError && error.hint ? error.hint : 'Reload to try again.';
	description.style.cssText =
		'font-size:14px;line-height:1.6;max-width:480px;color:var(--app-text-secondary)';
	const reload = document.createElement('button');
	reload.type = 'button';
	reload.textContent = 'Reload';
	reload.style.cssText =
		'padding:9px 22px;border-radius:7px;background:var(--app-accent);color:white;font-size:14px;font-weight:500';
	reload.addEventListener('click', () => location.reload());
	panel.append(title, description, reload);
	document.getElementById('root')!.replaceChildren(panel);
}

export default startDesktop().catch(showStartupError);
