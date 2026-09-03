// View state shared by Notepad's toolbar and the desktop menu bar.
// Documents and persistence remain owned by notepadService.
export const emptyFormatting = () => ({
	ready: false,
	bold: false,
	italic: false,
	heading: 0,
	list: '' as 'bullet' | 'ordered' | 'checklist' | '',
	undo: false,
	redo: false,
});

export const notepadView = $state({
	editor: emptyFormatting(),
	sidebar: true,
	source: false,
	plain: false,
});
