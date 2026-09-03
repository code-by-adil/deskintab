import { discoveryTool } from './catalog';
import { defineTool, requiredString, successfulResult } from './tool-utils';
import { AppError } from '../errors';
import { documentTools } from '../office/tools';
import { sheetTools } from '../office/sheets-tools';
import { previewTools } from '../preview/tools';
import { taskTools } from '../tasks/tools';
import { canvasTools } from '../canvas/tools';
import { activityTools } from '../activity/tools';
import { workspaceTools } from '../workspace/tools';
import { terminalTools } from '../terminal/tools';
import { navigationTools } from '../desktop/navigation-tools';
import { utilityTools } from '../desktop/utility-tools';
import { downloadTools } from '../workspace/download';
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
	...navigationTools,
	...utilityTools,
	...downloadTools,
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

const describeTool = defineTool({
	name: 'desktop_describe_tool',
	title: 'Read tool details',
	description:
		'Get full tool usage, side effects, parameter guidance and defaults before using unfamiliar tools.',
	annotations: { readOnlyHint: true, untrustedContentHint: false },
	inputSchema: {
		type: 'object',
		required: ['name'],
		properties: { name: { type: 'string', maxLength: 100 } },
		additionalProperties: false,
	},
	execute(input) {
		const name = requiredString(input, 'name', { maxLength: 100 });
		const tool = tools.find((tool) => tool.name === name);
		if (!tool) throw new AppError('TOOL_MISSING', 'Use a tool name from the desktop registry.');
		const { execute: _execute, ...definition } = tool;
		return successfulResult({ tool: definition }, `Read ${name} usage.`);
	},
});

let registrationController: AbortController | undefined;

export async function registerWebMCPTools() {
	await workspaceService.ready();
	const modelContext = document.modelContext;
	if (!modelContext?.registerTool) return () => {};

	registrationController?.abort();
	const controller = new AbortController();
	registrationController = controller;

	try {
		for (const tool of [...tools, describeTool]) {
			await modelContext.registerTool(discoveryTool(tool), { signal: controller.signal });
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
