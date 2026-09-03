import { tick } from 'svelte';
import { apps_config } from '../../configs/apps/apps-config';
import { desktopGetContext } from '../webmcp/desktop-context';
import { revealDesktop, revealTargets } from './files';
import {
	defineTool,
	optionalAbsolutePath,
	optionalEnum,
	successfulResult,
} from '../webmcp/tool-utils';

export const desktopTools: WebMCP.ModelContextTool[] = [
	defineTool({
		name: 'desktop_get_context',
		title: 'Desktop context',
		description:
			'Read Home brief, app/windows, files, selections, drafts, project/run IDs. Closed/minimized context is null. No UI/save changes. Read each app for contents/fresh revision; Documents/Sheets name their selection tool.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		async execute() {
			await tick();
			return successfulResult(
				await desktopGetContext(),
				'Read the desktop and current selections.',
			);
		},
	}),
	defineTool({
		name: 'desktop_reveal',
		title: 'Open app or file',
		description:
			'Bring an app forward or open a file in its matching app. target overrides file-type routing. Use preview_reveal for a specific source page.',
		annotations: { readOnlyHint: false, untrustedContentHint: false },
		inputSchema: {
			type: 'object',
			properties: {
				target: {
					type: 'string',
					enum: revealTargets,
					description: 'App to bring forward; textedit means Notepad.',
				},
				path: {
					type: 'string',
					description: 'Absolute workspace path; omit target for file-type routing.',
				},
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const result = await revealDesktop({
				target: optionalEnum(input, 'target', revealTargets),
				path: optionalAbsolutePath(input, 'path'),
				signal,
			});
			const title = apps_config[result.target].title;
			return successfulResult(
				result,
				result.entry
					? `Opened ${result.entry.path} in ${title}.`
					: `Brought ${title} to the front.`,
			);
		},
	}),
];
