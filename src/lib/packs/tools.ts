import {
	absolutePath,
	defineTool,
	optionalAbsolutePath,
	optionalEnum,
	successfulResult,
} from '../webmcp/tool-utils';
import { packService } from './packs';

const path = {
	type: 'string',
	minLength: 1,
	maxLength: 2048,
	description: 'Absolute .desktop-pack.json path.',
};

export const packTools: WebMCP.ModelContextTool[] = [
	defineTool({
		name: 'packs_export',
		title: 'Export workspace pack',
		description:
			'Save files/binary/empty folders at exact paths in a new .desktop-pack.json, default /Exports. Max5000 entries/32MiB decoded. Excludes System/Trash/packs/drafts/recovery/jobs; rejects symlinks. Download from Finder. No upload/sync.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: { type: 'object', properties: { path }, additionalProperties: false },
		async execute(input, { signal }) {
			const result = await packService.exportPack({
				path: optionalAbsolutePath(input, 'path'),
				actor: 'agent',
				signal,
			});
			return successfulResult(
				result,
				`Saved ${result.files} files and ${result.directories} folders in ${result.path}. Download it from Finder to keep a copy outside this browser.`,
			);
		},
	}),
	defineTool({
		name: 'packs_inspect',
		title: 'Inspect workspace pack',
		description:
			'Inspect .desktop-pack.json contents/bytes/conflicts. Identical files stay; preserve retains differences. Resolve folder/symlink conflicts manually. No writes. Upload host packs or select in Home.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path'],
			properties: { path },
			additionalProperties: false,
		},
		async execute(input) {
			const result = await packService.inspect(absolutePath(input, 'path'));
			return successfulResult(
				result,
				result.canImport
					? `Ready to import ${result.filesToCreate} files and ${result.directoriesToCreate} folders; ${result.existingFiles} identical files will be kept.`
					: `Import blocked by ${result.collisions.length} conflicting paths. No files changed.`,
			);
		},
	}),
	defineTool({
		name: 'packs_import',
		title: 'Import workspace pack',
		description:
			'Restore exact paths; merge folders/skip identical files. Default stop blocks conflicts. User-requested preserve moves differences to /Imports/Conflicts-<id>/<original-path>. Folder/symlink/draft conflicts block. Failure removes new items/restores originals where possible. Check status, preservedFiles and remainingPaths. Executes nothing.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path'],
			properties: {
				path,
				conflictMode: {
					type: 'string',
					enum: ['stop', 'preserve'],
					description: 'Default stop; preserve backs up conflicts in Imports.',
				},
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const result = await packService.importPack(absolutePath(input, 'path'), {
				actor: 'agent',
				signal,
				conflictMode: optionalEnum(input, 'conflictMode', ['stop', 'preserve'] as const),
			});
			return successfulResult(
				{ ...result, ok: result.status === 'imported' },
				result.status === 'imported'
					? `Imported ${result.createdFiles.length} files and ${result.createdDirectories.length} folders. Kept ${result.skippedFiles} identical files and preserved ${result.preservedFiles.length} originals in Imports.`
					: result.status === 'blocked'
						? `Import blocked by ${result.collisions.length} conflicts. No files changed.`
						: `Import failed. Removed ${result.rolledBack.length} created items; ${result.remainingPaths.length} paths need inspection. ${result.error}`,
			);
		},
	}),
];
