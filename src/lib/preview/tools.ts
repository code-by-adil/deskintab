import { previewService } from './preview';
import {
	absolutePath,
	defineTool,
	optionalAbsolutePath,
	optionalBoolean,
	optionalInteger,
	optionalString,
	requiredString,
	successfulResult,
} from '../webmcp/tool-utils';

const path = {
	type: 'string',
	description: 'Absolute workspace PDF/PNG/JPEG path.',
};
const page = {
	type: 'integer',
	minimum: 1,
	description: 'Physical page, one-based; images use 1.',
};
export const previewTools: WebMCP.ModelContextTool[] = [
	defineTool({
		name: 'preview_read',
		title: 'Read source',
		description:
			'Read source beside Documents: PDF text/pages, revision, citation, selection. Omit path for current/last. includeImage max1600px/side; pageCount limits text. View textless scans. No OCR.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			properties: {
				path,
				page,
				includeImage: {
					type: 'boolean',
					default: false,
					description: 'PNG of image or first requested PDF page.',
				},
				pageCount: { type: 'integer', minimum: 1, maximum: 20, default: 1 },
				maxChars: { type: 'integer', minimum: 1, maximum: 100000, default: 20000 },
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const { image, ...source } = await previewService.read(
				{
					path: optionalAbsolutePath(input, 'path'),
					includeImage: optionalBoolean(input, 'includeImage'),
					...(input.page === undefined
						? {}
						: { page: optionalInteger(input, 'page', 1, 1, Number.MAX_SAFE_INTEGER) }),
					pageCount: optionalInteger(input, 'pageCount', 1, 1, 20),
					maxChars: optionalInteger(input, 'maxChars', 20000, 1, 100000),
				},
				signal,
			);
			return successfulResult(
				{ source },
				`Read ${source.path}, page ${source.page} of ${source.pages}. ${source.note}`,
				image ? [image] : [],
			);
		},
	}),
	defineTool({
		name: 'preview_search',
		title: 'Search sources',
		description:
			'Literal case-insensitive PDF search: excerpt/page, scannedPages, truncation, nextPage. Opens Preview; keeps same-source page. No images/OCR. Inspect with preview_reveal, quote with preview_read.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['query'],
			properties: {
				path,
				query: { type: 'string', minLength: 1, maxLength: 500 },
				startPage: { type: 'integer', minimum: 1, default: 1 },
				maxPages: { type: 'integer', minimum: 1, maximum: 50, default: 25 },
				limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const result = await previewService.search(
				requiredString(input, 'query', { maxLength: 500 }),
				{
					path: optionalAbsolutePath(input, 'path'),
					startPage: optionalInteger(input, 'startPage', 1, 1, Number.MAX_SAFE_INTEGER),
					maxPages: optionalInteger(input, 'maxPages', 25, 1, 50),
					limit: optionalInteger(input, 'limit', 50, 1, 100),
				},
				signal,
			);
			return successfulResult(
				result,
				`Found ${result.matches.length} matching pages in ${result.scannedPages} scanned pages.${result.nextPage ? ` Continue at page ${result.nextPage}.` : ''}`,
			);
		},
	}),
	defineTool({
		name: 'preview_reveal',
		title: 'Show source',
		description:
			'Show sources in Preview independently of Documents. Check preview_read revision with expectedRevision; changes show SOURCE_CHANGED. For clickable Documents Sources, files_write <report-path>.sources.json as {version:1,sources:[{id,label,path,page,quote?,revision?}]}, using preview_read citations. Max 50 unique IDs; quote/revision optional.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema: {
			type: 'object',
			required: ['path'],
			properties: {
				path,
				page,
				expectedRevision: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const source = await previewService.reveal(
				absolutePath(input, 'path'),
				optionalInteger(input, 'page', 1, 1, Number.MAX_SAFE_INTEGER),
				optionalString(input, 'expectedRevision', { maxLength: 71 }),
				signal,
			);
			return successfulResult(
				{ source },
				`Opened ${source.path} at page ${source.page} in Preview.`,
			);
		},
	}),
];
