# Sheets

Sheets edits ODS/XLSX workbooks with ZetaOffice Calc. People use its grid, formula bar, sheet tabs, and formatting controls. Agents use six WebMCP tools that edit the same live workbook and save it to the workspace.

## Human workflow

Open Sheets from the green dock icon to start a blank ODS workbook. Finder routes `.ods` and `.xlsx` files into Sheets. The Open dialog browses the shared workspace or imports a copy from the computer, up to 50 MiB. The outer toolbar offers New, Open, Save, Save As, Export, Chart, and downloads.

Normal keyboard editing, formulas, formatting and native undo/redo work in Calc. Human changes autosave after a short idle period. Close flushes pending edits and releases the engine; minimize retains it. Reopen restores the path recorded in `/System/sheets-session.json`. Moving a workbook follows its open editor. Saves compare the original bytes before replacing a file; conflicts retain the live draft for Save As. Browser shutdown or a crash can still interrupt an unsaved edit.

Choose Chart, then select a sheet, rectangular data range, unique chart name, and optional title. Include series names in the first row and category labels in the first column. The inserted column chart links to those cells. Changing source values recalculates it. Native Calc can further edit the chart. Download → Export Chart to Files creates a PNG snapshot; Documents can insert that file as an embedded image.

Export creates a new ODS, XLSX or PDF while retaining the editable source. Export refuses existing destinations. Download sends the selected format to the host browser. Print uses PDF download; native printer commands are disabled. Sheets supports chart insertion. Insert Image is disabled.

## WebMCP contract

| Tool            | Input and result                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sheets_create` | `path` and 1 to 8 named `sheets`, each with a rectangular `values` matrix. Creates, opens and saves an ODS/XLSX; returns the workspace entry.                                                                                         |
| `sheets_read`   | Optional `path`, `sheet`, `range`. Defaults to the open workbook, active sheet, and `A1:J30`. Returns `workbook` with path, revision, sheet names, requested range, cells, human selection, chart names/source ranges and truncation. |
| `sheets_edit`   | `path`, fresh `expectedRevision`, and one operation for cells, formatting, sheets, rows/columns, sorting, filtering or merging. Recalculates, selects the edited range, and saves before returning.                                   |
| `sheets_chart`  | `path`, fresh `expectedRevision`, optional `sheet`, `range`, unique `name`, optional `title`. Creates, updates or removes a linked chart and saves.                                                                                   |
| `sheets_export` | `path`, new `destination`. Extension selects ODS/XLSX/PDF; PNG also requires `sheet` and `chart` names from a read. Returns the saved entry.                                                                                          |

Cells accept numbers, literal strings, `null` to clear, or a formula object. A string beginning with `=` stays text; formulas are never inferred from imported prose. Example creation:

```json
{
	"path": "/Projects/Event/Budget.ods",
	"sheets": [
		{
			"name": "Budget",
			"values": [
				["Item", "Quantity", "Total"],
				["Venue", 2, { "formula": "=B2*150" }],
				["Catering", 30, { "formula": "=B3*10" }],
				["Total", null, { "formula": "=SUM(C2:C3)" }]
			]
		}
	]
}
```

Read `Budget!A1:C4`, then use its returned revision to change attendance:

```json
{
	"path": "/Projects/Event/Budget.ods",
	"expectedRevision": 123,
	"operation": { "type": "cells", "sheet": "Budget", "range": "B3", "values": [[50]] }
}
```

Replace `123` with the revision from your read. Stale revisions return `DOCUMENT_CHANGED`; read again and adapt to the human's changes. A `format` operation accepts `bold`, `background`/`color` as `#RRGGBB`, a Calc `numberFormat` such as `#,##0.00` or `0%`, and `autoFit: true` to fit the affected columns after formatting. Column widths are otherwise preserved by edits. The matrix must exactly match the cell range.

Each returned cell has its address, type, displayed `text`, numeric `value` where applicable, `formula` or null, and native formula `error` code. Zero means no error. For a formula that returns text, use `text`; its numeric `value` does not represent the result. Reads return only the requested range. `selection` describes the human's active range and sheet; it is null for selections such as chart objects. Reads of a different sheet do not change the active sheet or selection.

Each operation accepts at most 200 rows, 50 columns, and 2,000 cells; 10,000 characters of input text per cell; 2,000 characters per formula; 100,000 total input characters per matrix. Sheet names are unique, 1 to 31 characters, without `[]:*?/\`. Cell reads cap each text/formula string at 5,000 characters and the combined payload strings at 100,000, with `truncated: true` when shortened. Chart listings return at most 50 charts. Read adjacent ranges to inspect larger workbooks.

Formula input accepts local workbook calculations, including cross-sheet references such as `=Budget.C4`. The tool rejects common external-link/network expressions. This check applies to tool inputs. Imported workbooks may contain other formulas. Macro execution and external-link updating are disabled on document load by the shared Office bridge. Network data connectors, macros, and external workbook refresh are unsupported. Excel compatibility is incomplete.

## Budget-to-report demo

1. Create a workbook with an attendance assumption, ticket revenue and costs calculated by formulas.
2. Create a linked column chart from a labels-and-values range.
3. Let the person change attendance in the native grid. Read the new calculated figures and revision with `sheets_read`.
4. Export the chart to a new workspace PNG with `sheets_export`.
5. Create a report with `documents_create`; read its revision, then use `documents_edit` with `{"type":"insert-image","imagePath":"/Pictures/Budget.png"}`.
6. Export the report to PDF and reveal it. Finder and Activity show the workbook, chart and report as normal shared files.

The chart inside the workbook is live. The PNG embedded in Documents is a snapshot and must be re-exported/reinserted when a report should reflect newer numbers.

## Implementation and verification

`src/lib/office/sheets-tools.ts` owns tool schemas, `sheets-inputs.ts` owns runtime validation, and `sheetsService` uses the same `OfficeService` lifecycle/save/conflict logic as Writer. `public/office/sheets-thread.js` implements native UNO cell, formatting, chart and PNG operations. Svelte renders the app and delegates to that service. Calc evaluates formulas; ZenFS persists the workbook.

Each open Office app has its own iframe, engine, and temporary import/export files. Both reuse the same immutable asset cache. Opening both apps therefore costs more memory than opening one; cold startup still loads the substantial existing Office runtime. Full editing targets desktop Chromium. Narrow screens retain toolbar and dialog access, with an editing notice. There is no separate mobile spreadsheet interface. See [Office runtime and hosting](office.md#runtime-and-hosting) for preparation, hosting headers, caching, fonts and licensing.

`tests/sheets.spec.ts` runs the actual WASM engine, replacing only tool registration. It covers formulas, revision rejection, invalid inputs, formatting, native keyboard input and undo/redo, close/reopen, multi-sheet calculations, human chart creation, updated PNG exports, report embedding and file persistence. The implementation also had an in-app browser check using discovered WebMCP tools.

The integration was checked against official [ZetaJS examples](https://github.com/allotropia/zetajs/tree/main/examples), LibreOffice [XCell](https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1table_1_1XCell.html), [SheetCellRange](https://api.libreoffice.org/docs/idl/ref/servicecom_1_1sun_1_1star_1_1sheet_1_1SheetCellRange.html), [XSpreadsheetView](https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1sheet_1_1XSpreadsheetView.html), [XTableCharts](https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1table_1_1XTableCharts.html), and [GraphicExportFilter](https://api.libreoffice.org/docs/idl/ref/servicecom_1_1sun_1_1star_1_1drawing_1_1GraphicExportFilter.html). Tools follow the [WebMCP imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api). The browser suite checks these operations against the pinned runtime.

## Workbook structure and navigation

The expanded operations and examples are specified in [the tool contract](webmcp-tool-contract.md#office-continuation-and-structural-editing). `sheets_select` reveals an exact sheet/range at a fresh read revision. `sheets_read` includes row visibility and optional cell formatting.

Sheet edits use [XSpreadsheets](https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1sheet_1_1XSpreadsheets.html), filtering uses [XSheetFilterable](https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1sheet_1_1XSheetFilterable.html), and merging uses [XMergeable](https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1util_1_1XMergeable.html). Sorting uses the native `DataSort` command with explicit scalar arguments from [Calc's command contract](https://github.com/LibreOffice/core/blob/master/sc/sdi/scalc.sdi), because the pinned WASM build does not bind sequences of sort-field structs. It operates on the selected range and keeps formatting with content.
