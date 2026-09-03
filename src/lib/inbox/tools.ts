import { openApp } from '../../state/apps.svelte';
import {
	inboxDocument,
	inboxService,
	INBOX_STATES,
	decodeInboxUploads,
	type InboxChanges,
	type InboxCreateInput,
} from './inbox';
import { absolutePath, defineTool, requiredString, successfulResult } from '../webmcp/tool-utils';
import { objectValue } from '../workspace/json-document';

const path = {
	type: 'string',
	maxLength: 2048,
	description: 'Absolute .inbox.json outside System/Trash.',
};
const editable = {
	title: { type: 'string', minLength: 1, maxLength: 160 },
	request: { type: 'string', minLength: 1, maxLength: 6000 },
	state: {
		type: 'string',
		enum: INBOX_STATES,
		description: 'new: unprocessed; filed: saved project required; done: saved output required.',
	},
	projectPath: {
		type: ['string', 'null'],
		maxLength: 2048,
		description: 'Existing .project.json path; null removes link.',
	},
	outputPaths: {
		type: 'array',
		maxItems: 20,
		uniqueItems: true,
		items: { type: 'string', maxLength: 2048 },
		description: 'Existing files; replaces all output links.',
	},
};
async function show(path: string) {
	openApp('inbox');
	try {
		if (inboxDocument.snapshot().path !== path) await inboxDocument.open(path);
		else await inboxDocument.refresh();
		return {};
	} catch (error) {
		return { displayWarning: error instanceof Error ? error.message : String(error) };
	}
}
export const inboxTools: WebMCP.ModelContextTool[] = [
	defineTool({
		name: 'inbox_list',
		title: 'List requests',
		description:
			'List 200 Inbox requests max, new first, with attachments, projects, warnings/truncation. Read paths with inbox_read. No writes.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		async execute() {
			const result = await inboxService.list();
			return successfulResult(result, `Found ${result.requests.length} Inbox requests.`);
		},
	}),
	defineTool({
		name: 'inbox_read',
		title: 'Read request',
		description:
			'Read request/revision, inputs, bookmark, project/output existence. Read contents with file tools/Terminal. URLs are unfetched. Use revision for inbox_update.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path'],
			properties: { path },
			additionalProperties: false,
		},
		async execute(input) {
			const result = await inboxService.read(absolutePath(input, 'path'));
			return successfulResult(result, `Read ${result.data.title}.`);
		},
	}),
	defineTool({
		name: 'inbox_create',
		title: 'Collect request',
		description:
			'Save/open a new Inbox request with notes, unfetched bookmark, and 20 files max. utf8 or padded base64; 10 MB/file, 25 MB total. Rejects duplicate names/overwrites. No agent starts.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['title', 'request'],
			properties: {
				title: editable.title,
				request: editable.request,
				projectPath: editable.projectPath,
				note: {
					type: 'string',
					maxLength: 100000,
					description: 'Source text saved beside the request as Notes.md.',
				},
				sourceUrl: {
					type: ['string', 'null'],
					maxLength: 2048,
					description: 'Unfetched http(s) bookmark without credentials.',
				},
				files: {
					type: 'array',
					maxItems: 20,
					items: {
						type: 'object',
						required: ['name', 'content', 'encoding'],
						additionalProperties: false,
						properties: {
							name: {
								type: 'string',
								minLength: 1,
								maxLength: 200,
								description: 'Filename without folder separators.',
							},
							content: { type: 'string', maxLength: 13333336 },
							encoding: { type: 'string', enum: ['utf8', 'base64'] },
						},
					},
				},
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const result = await inboxService.create(
				{ ...input, files: decodeInboxUploads(input.files) } as InboxCreateInput,
				{ actor: 'agent', signal },
			);
			return successfulResult(
				{ ...result, ...(await show(result.path)) },
				`Added ${result.data.title} to Inbox with ${result.data.attachments.length} imported files.`,
			);
		},
	}),
	defineTool({
		name: 'inbox_update',
		title: 'Update request',
		description:
			'Update/open at current revision; arrays replace. filed needs a project, done an output. Links neither move nor verify files. Rejects stale writes/drafts.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path', 'expectedRevision', 'changes'],
			properties: {
				path,
				expectedRevision: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
				changes: {
					type: 'object',
					minProperties: 1,
					properties: editable,
					additionalProperties: false,
				},
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const result = await inboxService.update(
				absolutePath(input, 'path'),
				requiredString(input, 'expectedRevision', { maxLength: 71 }),
				objectValue(input.changes) as InboxChanges,
				{ actor: 'agent', signal },
			);
			return successfulResult(
				{ ...result, ...(await show(result.path)) },
				`Saved ${result.data.title} as ${result.data.state}.`,
			);
		},
	}),
];
