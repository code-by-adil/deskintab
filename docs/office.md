# Documents

Documents edits ODT and DOCX files with ZetaOffice Writer's menus, formatting tools, page layout, tables, and sidebar. Notepad handles Markdown and plain text. The integration follows the upstream [full-office example](https://github.com/allotropia/zetajs/tree/main/examples/web-office), using ZetaJS 1.2.0 and LibreOffice UNO.

## Human workflow

Open Documents from the dock to create an ODT. Open ODT, DOCX, DOC, or RTF files from Finder or the Open dialog. Import copies a file from the computer into `/Documents`. DOC and RTF imports retain the original and create an editable ODT copy.

Changes autosave after a short idle period. Writer's Save, Save As, Open, New, and PDF export commands use the workspace. The outer toolbar offers the same actions and downloads to the computer. Export creates a new PDF, DOCX, or ODT and retains the editable source. Finder and `desktop_reveal` open PDFs in [Preview](preview.md) by default. Documents also has a read-only PDF viewer, used by its Open dialog and `desktop_reveal` with `target: "documents"`.

The Sources button lists references from `<document-path>.sources.json`. Each opens a source page in Preview while Writer stays open. References contain a page, optional quote, and optional SHA-256 source revision. A changed source shows a warning. Use file tools to create or update this manifest. Its links appear only in the Sources panel, not inside Writer text or exported PDFs.

To print, choose **Download → PDF (.pdf)**, open the downloaded file in a PDF viewer, and print there. The native Print, Print Directly, Printer Settings, Print Preview, preview-print, and mail-merge printing commands are disabled. Writer's normal page-layout editing view remains available. Ctrl/Cmd+P in Writer or the Documents window points to PDF download; in PDF preview it explains the existing Download PDF action. Export also explains how to save a PDF for printing. No printer integration or browser print dialog is provided.

Writer editing targets desktop browsers. Narrow document windows show a brief notice while keeping viewing and downloading available. Open, Save As, Export, and Insert Image dialogs scroll while keeping their action buttons visible. Short windows use tighter spacing. PDF previews retain page viewing, readable page text, and downloads without loading Writer. There is no separate mobile editor.

Insert Image in Writer's native toolbar/menu or the Documents toolbar opens the shared image picker. Choose a PNG/JPEG from Files or import one from the computer, up to 10 MiB. Imports are saved in `/Pictures`; a numbered filename preserves existing files with the same name. An optional description becomes the image's alternative description. The image is embedded as an inline object at the text cursor, after any selected text or at the end of a selected image's anchor, preserving that content. Images keep their aspect ratio and shrink to fit within 150 × 180 mm. Insertion and description form one native undo action. A document change while the picker is open rejects insertion with a prompt to reopen the picker.

Closing the app flushes pending changes. If a newer document operation arrives while that close is saving, the newer request takes precedence and the window remains open. Minimizing keeps the live editor. Reopening restores the last file from `/System/office-session.json`. File moves follow the open document. Saves compare the original file bytes with the workspace before replacing the file. A conflict keeps the live draft available for Save As. Closing the browser or a crash can interrupt a pending save.

## Implementation

```text
Documents controls ─┐
WebMCP tools ────────┼─ officeService ─ same-origin iframe ─ ZetaJS / UNO / Writer
Terminal docs ───────┘        │
                             └─ workspaceService ─ ZenFS / IndexedDB
```

Emscripten's filesystem holds temporary import/export files and is recreated with the iframe. Saves use the shared workspace mutation queue, persist to ZenFS before returning, and appear in Activity.

The editor pauses input while a service operation runs. Agent edits require a revision from a fresh read. Exact replacements check the expected match count. Failed style validation does not partially append blocks. The revision changes with modifications and editor sessions.

`files_read`, `files_write`, and `files_patch` reject binary office files. Use Files tools to organize or copy them. `files_search` searches office filenames, not their internal content; use `documents_read` or `docs text` to inspect that content.

## WebMCP tools

- `documents_create`: new ODT/DOCX from paragraph and table blocks. Paragraphs can specify Writer styles such as `Title`, `Heading 1`, and `Standard`.
- `documents_read`: bounded text, paragraph indices/styles, available paragraph styles, table names/cells, image count/metadata, the current text selection, and revision. Up to 50 images report their name, description up to 2,000 characters, width and height in millimeters. Selection reports `collapsed`, `text` up to 10,000 characters, and `truncated`; it is `null` when Writer has no active text cursor, for example while an image is selected. It visibly opens the file and saves pending edits before switching, so its read-only hint is false.
- `documents_edit`: one exact replacement, paragraph edit, table-cell edit, append, or `insert-image` operation, checked against `expectedRevision`.
- `documents_export`: new ODT, DOCX, or PDF selected by destination extension; refuses an existing destination.

`desktop_reveal` accepts target `documents` and infers it for Writer files. PDFs and PNG/JPEG images default to Preview, while ODS/XLSX default to Sheets. The full document schemas are defined in `src/lib/office/tools.ts`.

Example creation input:

```json
{
	"path": "/Documents/Status report.odt",
	"blocks": [
		{ "type": "paragraph", "text": "Status report", "style": "Title" },
		{ "type": "paragraph", "text": "Progress", "style": "Heading 1" },
		{ "type": "paragraph", "text": "The integration is ready for review." },
		{
			"type": "table",
			"rows": [
				["Item", "Status"],
				["Documents", "Ready"]
			]
		}
	]
}
```

Reads return up to 100,000 characters of body text, 500 paragraphs, and 20 tables with up to 400 cells each. Each paragraph is limited to 10,000 characters and each table cell to 5,000. Structured paragraph text, table-cell text, and image descriptions share a separate 100,000-character budget. Table cells report `truncated` when clipped; clipping any paragraph, cell, or image description also sets the document's `truncated` flag. The selection has its own 10,000-character limit. Office-document imports are limited to 50 MiB; image imports to 10 MiB. Structured input limits apply separately.

Image insertion embeds an existing workspace file. Use this `operation` with `documents_edit` or `docs edit`:

```json
{
	"type": "insert-image",
	"imagePath": "/Pictures/Chart.png",
	"position": "end",
	"description": "Completion rates for the three project milestones."
}
```

`position` defaults to `end`; `cursor` uses the visible Writer insertion point. The operation embeds a copy, so subsequent source-image moves or removal do not break the document. `documents_read` returns image metadata only. Image insertion uses LibreOffice's [GraphicProvider](https://api.libreoffice.org/docs/idl/ref/servicecom_1_1sun_1_1star_1_1graphic_1_1GraphicProvider.html) and [TextGraphicObject](https://api.libreoffice.org/docs/idl/ref/servicecom_1_1sun_1_1star_1_1text_1_1TextGraphicObject.html), with an [undo context](https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1document_1_1XUndoManager.html) grouping insertion and metadata.

## Terminal

`docs` is a browser command registered with `just-bash`, calling the same office service. The browser terminal does not execute native LibreOffice binaries.

```bash
docs --help
docs create /Documents/Report.odt /Documents/blocks.json
docs read /Documents/Report.odt
docs text /Documents/Report.odt | grep 'Progress'
docs edit /Documents/Report.odt REVISION /Documents/change.json
docs export /Documents/Report.odt /Documents/Report.pdf
```

Write JSON inputs with normal filesystem tools or shell redirection. The shared terminal adapter honors binary encodings for reads, writes, and appends, so base64-decoded images can be created without UTF-8 conversion. `REVISION` must be the numeric value returned by the most recent read. Use `terminal_start` for a cold launch or lengthy operation, then `terminal_wait`; the short command deadline remains eight seconds. Cancellation is checked before document operations and workspace writes. A synchronous UNO operation already executing cannot be preempted; an interrupted operation can leave a live unsaved draft, which remains visible in Documents.

## Runtime and hosting

`pnpm dev` and `pnpm build` run `pnpm office:prepare` first. The script downloads the official ZetaOffice runtime, checks pinned SHA-256 hashes, caches originals under `node_modules/.cache/zetaoffice`, and prepares ignored assets under `public/office/runtime`. No document is uploaded to the vendor. Runtime download requires network access during the first preparation; a verified local cache supports later builds.

The runtime's embedded build ID is `efaf0670b4d055f838a2849becb10f08aa06a257`. Pinned hashes identify the expected runtime bytes. An update requires reviewing and changing those hashes. A clean build fails if the CDN's `latest` alias supplies different bytes.

The WASM module and data pack are large. They load only when a Writer or Calc operation is requested and are excluded from service-worker precaching. Opening a PDF alone does not create a Writer iframe or request any Office assets. Gzip-compressed payloads are split into content-addressed pieces of at most 8 MiB, below Cloudflare's [25 MiB static-asset limit](https://developers.cloudflare.com/workers/platform/limits/#static-assets). The browser reassembles them through Emscripten's documented [`wasmBinary` and `getPreloadedPackage`](https://emscripten.org/docs/api_reference/module.html) hooks. First launch needs substantial network and memory capacity.

### Startup and recovery

The bootstrap checks the manifest and data-file metadata before starting Emscripten. The pinned upstream metadata XHR only handles HTTP 200; a failed request otherwise leaves a run dependency pending indefinitely. The checked metadata is supplied through a temporary same-origin blob URL using `Module.locateFile`, without modifying the upstream runtime. Invalid JSON, missing scripts, and startup exceptions enter the same visible error/retry flow.

The parent connects through boot/ready messages and the iframe load event. Its watchdog allows up to three minutes for assets, then one minute for the runtime to become ready. A failed startup removes the iframe and releases its workers. Closing or cancelling during startup aborts downloads and rejects pending startup work; late notifications cannot reopen the closed session. Retry creates a fresh engine. If a Writer launch fails while a PDF is displayed, the PDF and download remain available beside Retry.

Content-addressed compressed chunks are cached on demand in `desktop-office-assets-v1` CacheStorage. The current set is about 90.9 MB compressed. This cache holds runtime assets only. Startup removes entries outside the current manifest, falls back to ordinary fetches when cache storage is unavailable, and evicts a damaged package before retry. Browser eviction or quota limits can require downloading again. Startup revalidates the manifest and metadata, so cached chunks do not guarantee offline startup.

Decompression runs during download. Loading feedback reports a byte-based percentage, then shows "Starting Writer..." during native initialization. The iframe records `office:*` performance marks for bootstrap, assets, runtime initialization, bridge readiness, and the first document, so later regressions can be attributed to a phase. Closing still destroys the live engine; minimizing retains it.

The same preparation step supplies Noto Serif Bengali 2.003 regular and bold, plus Noto Sans SC 2.004 regular from the upstream China subset. The three files add 7.12 MiB compressed, 8.44 MiB unpacked. URLs are pinned to upstream commits and verified by SHA-256; downloads and compressed chunks use the existing runtime cache and transport. Font changes invalidate the preparation manifest. Browsers fetch the fonts from this app, with the other runtime assets, without contacting a font vendor.

The bootstrap uses Emscripten's documented [`preRun`](https://emscripten.org/docs/api_reference/module.html#Module.preRun) hook to install them under `/usr/share/fonts`, a directory already scanned by the pinned runtime's `fonts.conf`. Writer's native fallback and PDF export therefore see the same fonts, including when existing ODT/DOCX files name unavailable fonts. The document's chosen fonts and styles are preserved. Fonts must finish loading before Office starts; a failed download uses the existing visible error/retry flow.

The added fonts cover Bengali shaping, Simplified Chinese, and the tested common Traditional Chinese characters. Noto Sans SC has Chinese regional glyph forms and 30,890 Unicode mappings. It does not cover all Traditional Chinese, Japanese, Korean, or Unicode characters. Chinese bold/italic uses the engine's synthesis because only the regular face is supplied. PDFs embed the used font subsets; another editor opening an ODT/DOCX can still need its own suitable fonts.

Serve the desktop over HTTPS or localhost with:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Vite dev and preview set these headers. `public/_headers` carries them to Cloudflare static hosting. Any other host must configure equivalent headers. The loading screen reports missing assets or missing isolation and provides a retry button. The runtime requires WebAssembly threads, SharedArrayBuffer, and gzip DecompressionStream. Chromium is the verified target. PDF.js renders previews directly, with page navigation, readable page text, and downloads.

[Sheets](sheets.md) uses Calc through the same Office lifecycle service and pinned assets. Each open editor has its own iframe and live engine, so opening both uses more memory; they share only the immutable runtime cache and persistent ZenFS workspace, not an in-memory document model. Impress and a semantic API for every native Office feature are not included. Agent tools cover common workflows; the native UI has additional features.

## Source and licenses

See [`public/office/NOTICE.md`](../public/office/NOTICE.md) for upstream attribution, source references, and licenses. The original office binaries are not modified; compressed transport is reconstructed before execution.

## Verification

`tests/office.spec.ts` runs the actual WASM engine. Only tool registration is replaced in the test. It checks formatted creation, revision-checked agent edits, real keyboard edits, format signatures, DOCX reopening, terminal extraction, PDF preview, close/minimize/reload persistence, moves, and recoverable load failures. Run it with `pnpm exec playwright test tests/office.spec.ts`.

`tests/office-startup.spec.ts` adds fault injection for script/metadata failures, startup deadlines, cancellation and close races, cache fallback/recovery, repeated worker cleanup, and PDF-only loading. `tests/office-print-mobile.spec.ts` checks native print command states, PDF downloads and shortcuts, compact dialogs, and an overlapping close/open request. Run all Office suites with `pnpm exec playwright test tests/office*.spec.ts`.

See [the browser QA report](office-qa.md) for the deeper lifecycle/import tests, fixes, and remaining native UI, font, clipboard, and performance findings. Some native Writer commands still lack workspace integration. These tests cover the listed workflows.
