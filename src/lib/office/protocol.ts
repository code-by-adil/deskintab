import type { DocumentBlock, DocumentOperation, OfficeFormat } from './office';
import type { prepareOfficeImage } from './image';
import type { RangeInput, SheetChart, SheetOperation, WorkbookSheet } from './sheets-inputs';

type Revision = { revision: number };
type Text = { text: string; truncated: boolean };
export type DocumentRead = Revision &
	Text & {
		selection: (Text & { collapsed: boolean }) | null;
		imageCount: number;
		images: {
			name: string;
			description: string;
			truncated: boolean;
			widthMm: number;
			heightMm: number;
		}[];
		paragraphs: (Text & { index: number; style: string })[];
		styles: string[];
		tables: { name: string; truncated: boolean; cells: (Text & { cell: string })[] }[];
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
	read: { input: undefined; result: DocumentRead };
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
		result: Revision & { chart: { name: string; sheet: string; range: string } };
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
