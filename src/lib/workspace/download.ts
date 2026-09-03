import { workspaceService } from './workspace';
import { workspaceBasename } from './path';
import { AppError } from '../errors';
import { absolutePath, defineTool, successfulResult } from '../webmcp/tool-utils';

// Finder and tools use the same browser download handoff. The workspace file stays intact.
export async function downloadWorkspaceFile(path: string, signal?: AbortSignal) {
	const entry = await workspaceService.stat(path);
	if (entry.kind !== 'file')
		throw new AppError(
			'NOT_A_FILE',
			'Download individual files; use packs_export to bundle folders.',
		);
	const bytes = await workspaceService.readBytes(entry.path);
	signal?.throwIfAborted();
	const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = workspaceBasename(entry.path);
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
	return {
		path: entry.path,
		filename: workspaceBasename(entry.path),
		bytes: bytes.byteLength,
		downloadRequested: true,
	};
}
export const downloadTools: WebMCP.ModelContextTool[] = [
	defineTool({
		name: 'files_download',
		title: 'Download workspace file',
		description:
			'Request a browser download of a saved workspace file, preserving original bytes and filename. Does not include unsaved editor drafts. Browser settings decide the destination; a requested download is not proof the host saved it.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			properties: { path: { type: 'string', description: 'Absolute saved workspace file path.' } },
			required: ['path'],
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const result = await downloadWorkspaceFile(absolutePath(input, 'path'), signal);
			return successfulResult(result, `Requested download of ${result.filename}.`);
		},
	}),
];
