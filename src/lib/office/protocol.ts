import type { DocumentReadInput } from './inputs';
import type { DocumentBlock, DocumentOperation, OfficeFormat } from './office';
import type { prepareOfficeImage } from './image';
import type { RangeInput, SheetChart, SheetOperation, WorkbookSheet } from './sheets-inputs';

type Revision = { revision: number };
type Text = { text: string; truncated: boolean };
type PagedText = Text & { totalCharacters?: number; nextTextOffset?: number | null };
export type DocumentRead = Revision &
	Text & {
		page?: {
			scope: string;
			offset: number;
			nextOffset: number | null;
			total: number;
			textOffset: number;
		};
		totals: { characters: number; paragraphs: number; tables: number; images: number };
		selection: (Text & { collapsed: boolean }) | null;
		imageCount: number;
		images: {
			name: string;
			description: string;
			truncated: boolean;
			nextTextOffset?: number | null;
			widthMm: number;
			heightMm: number;
		}[];
		paragraphs: (PagedText & {
			index: number;
			style: string;
			nextRunTextOffset?: number | null;
			runs?: {
				start: number;
				end: number;
				type: string;
				bold: boolean;
				italic: boolean;
				underline: boolean;
				fontSize: number;
				fontName: string;
				color: number;
				link: string;
			}[];
		})[];
		styles: string[];
		tables: {
			name: string;
			truncated: boolean;
			cellCount?: number;
			cells: (PagedText & { cell: string })[];
		}[];
	};
export type WorkbookRead = Revision & {
	sheet: string;
	range: string;
	selection: { sheet: string; range: string } | null;
	sheets: string[];
	cells: {
		cell: string;
		type: 'empty' | 'number' | 'formula' | 'text';
		text: string;
		value: number | null;
		formula: string | null;
		error: number;
		visible: boolean;
		format?: {
			bold: boolean;
			italic: boolean;
			fontSize: number;
			fontName: string;
			wrap: boolean;
			merged: boolean;
		};
	}[][];
	truncated: boolean;
	charts: { name: string; ranges: string[] }[];
};

type Commands = {
	open: {
		input: { bytes: Uint8Array; extension: string; app: 'documents' | 'sheets' };
		result: Revision;
	};
	create: {
		input: { blocks: DocumentBlock[]; app: 'documents' | 'sheets'; sheets?: WorkbookSheet[] };
		result: Revision;
	};
	read: { input: DocumentReadInput; result: DocumentRead };
	select: {
		input: { expectedRevision: number; index: number; start: number; end: number };
		result: Revision & { selection: DocumentRead['selection'] };
	};
	'sheet-select': {
		input: { expectedRevision: number; sheet?: string; range: string };
		result: Revision & { selection: WorkbookRead['selection'] };
	};
	state: { input: undefined; result: Revision & { modified: boolean } };
	'mark-saved': { input: Revision; result: Revision };
	serialize: { input: { format: OfficeFormat }; result: Revision & { bytes: Uint8Array } };
	edit: {
		input: {
			expectedRevision: number;
			operation: DocumentOperation;
			image?: Awaited<ReturnType<typeof prepareOfficeImage>>;
		};
		result: Revision;
	};
	'sheet-read': { input: RangeInput; result: WorkbookRead };
	'sheet-edit': {
		input: { expectedRevision: number; operation: SheetOperation };
		result: Revision;
	};
	'sheet-chart': {
		input: { expectedRevision: number; chart: SheetChart };
		result: Revision & { chart: { name: string; sheet: string; range?: string } };
	};
	'sheet-export-chart': {
		input: { sheet: string; name: string };
		result: { bytes: Uint8Array };
	};
};

// This is the application protocol after bootstrap has copied exported bytes
// out of the worker's temporary filesystem. UNO objects stay in the worker.
export type OfficeBridge = {
	ready: Promise<void>;
	request<C extends keyof Commands>(
		command: C,
		...args: Commands[C]['input'] extends undefined ? [] : [input: Commands[C]['input']]
	): Promise<Commands[C]['result']>;
	dispose(): void;
};
