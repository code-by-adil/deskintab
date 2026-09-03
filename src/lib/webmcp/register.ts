import { documentTools } from '../office/tools';
import { sheetTools } from '../office/sheets-tools';
import { previewTools } from '../preview/tools';
import { taskTools } from '../tasks/tools';
import { canvasTools } from '../canvas/tools';
import { activityTools } from '../activity/tools';
import { workspaceTools } from '../workspace/tools';
import { terminalTools } from '../terminal/tools';
import { desktopTools } from '../desktop/tools';
import { projectTools } from '../projects/tools';
import { homeTools } from '../home/tools';
import { inboxTools } from '../inbox/tools';
import { shortcutTools } from '../shortcuts/tools';
import { studioTools } from '../studio/tools';
import { packTools } from '../packs/tools';
import { workspaceService } from '../workspace/workspace';

const tools: WebMCP.ModelContextTool[] = [
	...desktopTools,
	...homeTools,
	...inboxTools,
	...shortcutTools,
	...studioTools,
	...packTools,
	...projectTools,
	...documentTools,
	...sheetTools,
	...previewTools,
	...activityTools,
	...taskTools,
	...canvasTools,
	...workspaceTools,
	...terminalTools,
];

let registrationController: AbortController | undefined;

export async function registerWebMCPTools() {
	await workspaceService.ready();
	const modelContext = document.modelContext;
	if (!modelContext?.registerTool) return () => {};

	registrationController?.abort();
	const controller = new AbortController();
	registrationController = controller;

	try {
		for (const tool of tools) {
			await modelContext.registerTool(tool, { signal: controller.signal });
		}
	} catch (error) {
		controller.abort();
		throw error;
	}

	return () => {
		controller.abort();
		if (registrationController === controller) registrationController = undefined;
	};
}
