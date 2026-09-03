import { AppError } from '../errors';
import { workspaceService } from '../workspace/workspace';
import { normalizeWorkspacePath } from '../workspace/path';
import { isPreviewPath, previewService } from './preview';

export type SourceReference = {
	id: string;
	label: string;
	path: string;
	page: number;
	quote?: string;
	revision?: string;
};
export const sourceManifestPath = (reportPath: string) => `${reportPath}.sources.json`;
export async function readSources(reportPath: string): Promise<SourceReference[]> {
	const path = sourceManifestPath(reportPath);
	if (!(await workspaceService.exists(path))) return [];
	const entry = await workspaceService.stat(path);
	if (entry.size > 100000)
		throw new AppError('INVALID_SOURCES', 'The sources file must be under 100,000 bytes.');
	let data: unknown;
	try {
		data = JSON.parse(await workspaceService.readText(path));
	} catch {
		throw new AppError('INVALID_SOURCES', 'The sources file must contain valid JSON.');
	}
	const invalid = (): never => {
		throw new AppError(
			'INVALID_SOURCES',
			'Use {version:1,sources:[{id,label,path,page,quote?,revision?}]} with up to 50 unique references to workspace PDFs/images.',
		);
	};
	if (
		!data ||
		typeof data !== 'object' ||
		!('version' in data) ||
		data.version !== 1 ||
		!('sources' in data) ||
		!Array.isArray(data.sources) ||
		data.sources.length > 50
	)
		invalid();
	const ids = new Set<string>();
	return (data as { sources: unknown[] }).sources.map((value) => {
		if (!value || typeof value !== 'object') invalid();
		const ref = value as Record<string, unknown>;
		if (
			typeof ref.id !== 'string' ||
			!ref.id.trim() ||
			ref.id.length > 40 ||
			ids.has(ref.id) ||
			typeof ref.label !== 'string' ||
			!ref.label.trim() ||
			ref.label.length > 200 ||
			typeof ref.path !== 'string' ||
			!ref.path.startsWith('/') ||
			ref.path.length > 2048 ||
			!isPreviewPath(ref.path) ||
			!Number.isInteger(ref.page) ||
			Number(ref.page) < 1
		)
			invalid();
		if (ref.quote !== undefined && (typeof ref.quote !== 'string' || ref.quote.length > 5000))
			invalid();
		if (
			ref.revision !== undefined &&
			(typeof ref.revision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(ref.revision))
		)
			invalid();
		ids.add(ref.id as string);
		return {
			id: ref.id as string,
			label: ref.label as string,
			path: normalizeWorkspacePath(ref.path as string),
			page: ref.page as number,
			...(ref.quote ? { quote: ref.quote as string } : {}),
			...(ref.revision ? { revision: ref.revision as string } : {}),
		};
	});
}
export function revealSource(reference: SourceReference) {
	return previewService.reveal(reference.path, reference.page, reference.revision);
}
