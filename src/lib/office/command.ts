import { defineCommand } from 'just-bash/browser';
import { officeService } from './office';
import { normalizeWorkspacePath } from '../workspace/path';

const help = `docs — office documents in the shared desktop
  docs read PATH [SCOPE.json]    paged structured JSON including revision
  docs text PATH                 extracted text for pipes and searches
  docs create PATH BLOCKS.json    create ODT/DOCX from paragraph/table blocks
  docs edit PATH REVISION OP.json apply a focused change from a JSON file
  docs export SOURCE DESTINATION export ODT, DOCX, or PDF
Use terminal_start for the first operation while Office loads.
`;

export const documentsCommand = defineCommand('docs', async (args, ctx) => {
	try {
		const [action, input, output, operationFile] = args;
		if (!action || action === '--help' || action === 'help')
			return { stdout: help, stderr: '', exitCode: 0 };
		if (!input) throw new Error('Provide a workspace path. See docs --help.');
		const path = normalizeWorkspacePath(input, ctx.cwd);
		ctx.signal?.throwIfAborted();
		let result: unknown;
		if (action === 'read' || action === 'text') {
			const scope =
				action === 'text'
					? { scope: 'text' }
					: output
						? JSON.parse(await ctx.fs.readFile(normalizeWorkspacePath(output, ctx.cwd)))
						: {};
			const document = await officeService.read(path, ctx.signal, scope);
			if (action === 'text') {
				let text = document.text,
					offset = document.page?.nextOffset;
				while (offset != null) {
					const page = await officeService.read(path, ctx.signal, {
						scope: 'text',
						offset,
						expectedRevision: document.revision,
					});
					text += page.text;
					offset = page.page?.nextOffset;
				}
				return { stdout: text + '\n', stderr: '', exitCode: 0 };
			}
			result = document;
		} else if (action === 'create' && output) {
			const blocks = JSON.parse(await ctx.fs.readFile(normalizeWorkspacePath(output, ctx.cwd)));
			result = await officeService.newDocument(path, blocks, 'agent', ctx.signal);
		} else if (action === 'edit' && output && operationFile) {
			const revision = Number(output);
			const operation = JSON.parse(
				await ctx.fs.readFile(normalizeWorkspacePath(operationFile, ctx.cwd)),
			);
			result = await officeService.edit(path, revision, operation, 'agent', ctx.signal);
		} else if (action === 'export' && output)
			result = await officeService.exportDocument(normalizeWorkspacePath(output, ctx.cwd), {
				actor: 'agent',
				source: path,
				signal: ctx.signal,
			});
		else throw new Error('Unknown command or missing argument. See docs --help.');
		return { stdout: JSON.stringify(result) + '\n', stderr: '', exitCode: 0 };
	} catch (error) {
		return {
			stdout: '',
			stderr: `docs: ${error instanceof Error ? error.message : String(error)}\n`,
			exitCode: 1,
		};
	}
});
