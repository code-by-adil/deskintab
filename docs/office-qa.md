# Documents browser QA, 3 September 2026

This report records the Office checks and follow-up fixes from 3 September 2026. The latest repository run recorded here passed 93 tests in 4.5 minutes. These counts describe those runs, not the current branch.

The checks used the actual ZetaOffice WASM engine, keyboard and file-picker interactions, the IndexedDB workspace, and PDF.js. Testing ran on macOS in Chromium through Playwright 1.62.1 and in the Codex in-app browser through CUA. Production previews used localhost with COOP/COEP headers. Most automated production checks blocked service workers; the manual browser retained its installed worker and exercised an update. Development regression tests ran separately.

## Recorded runs

| Pass                         | Result                                                                                                                                                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial QA                   | All 22 production scenarios passed in 4.8 minutes, plus manual native UI checks. The repository run passed 62 of 64 tests. Clipboard and an existing Notepad checkpoint test then passed together in isolation. This was not a clean 64-test run.                                             |
| Clipboard                    | The keyboard regression passed in 10 fresh sessions without a fixed delay or retry. All 7 Documents tests passed, including immediate switch/close saves, cancelled startup, invalid imports, export/reopen/persistence, and conflict preservation.                                           |
| Image insertion              | Both image regressions, the byte-preservation regression, and the production workflow passed. A wider Documents/Terminal run passed 14 of 15 tests. One Writer test timed out on first creation, then passed alone in 22.2 seconds. Cold-start reliability remained unresolved at this point. |
| Bengali and Chinese fonts    | Both new font regressions passed, including failed download/retry. All 12 Documents tests passed. Built font chunks matched the pinned source hashes after decompression.                                                                                                                     |
| Startup                      | All 17 startup tests passed. The repository suite then passed 90 of 90 in 4.6 minutes, including the 12 Office tests, image insertion, fonts, clipboard, and conflicts. No source changed during that final run. Two additional production tests passed.                                      |
| Printing and compact windows | All 93 repository tests passed in 4.5 minutes, including 3 new regressions in `tests/office-print-mobile.spec.ts`. The production check passed with no uncaught page exceptions.                                                                                                              |

The recorded follow-ups also passed type checking and production builds. The initial, font, and printing passes recorded successful formatting checks; the initial and printing passes also passed `git diff --check`. Svelte autofixer found no issues in the initial, startup, and printing checks. Its suggestions concerned existing bindings and window effects.

## Coverage

| Area                 | What was exercised                                                                                                                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle            | Dock launch, new document, save, Save As, duplicate destination rejection, dialog cancellation, close/reopen, minimize/restore, maximize/restore, dragging, and reload persistence. Ten repeated close/reopen cycles checked retained text and released Office workers. |
| Rapid edits          | Immediate type-and-switch and type-and-close, agent edits after human edits, active file and parent-folder renames, and retained drafts after failed saves.                                                                                                             |
| Import and roundtrip | External DOCX with title, bold text, multilingual text, table, image, header, footer, and page break. RTF conversion retained the original and created an editable ODT. The downloaded DOCX was reopened and inspected as an archive.                                   |
| Agent tools          | Create/read/edit/export, paragraph styles, replacement counts, named table cells, append, stale revisions, invalid styles, concurrency, cancellation, shared file visibility, Terminal extraction, and Activity records.                                                |
| Human editing        | Native bold, italic, underline, font size, Find, undo/redo, clipboard reads/writes, save/open shortcuts, PDF export, and File/Window Close.                                                                                                                             |
| PDF                  | Exported two-page document, independent three-page PDF, page navigation, readable text, download, return to Writer, malformed PDF recovery, and cold PDF opening.                                                                                                       |
| Recovery             | Missing documents, missing runtime manifest, Retry, malformed DOCX, empty/mislabeled ODT, duplicate import, invalid PDF/save destination, and cancelled startup.                                                                                                        |
| Layout               | Initial checks at 1440×1000, 768×700, and 390×844. Later dialog checks added 320×568, 640×360, and 390×450. Inputs and action buttons remained reachable; these checks did not certify mobile editing.                                                                  |

The DOCX roundtrip retained its image, bold run, table content, header, footer, page break, and Unicode text. Font shaping and rendered glyphs were checked separately below.

## Save, startup, and input fixes

| Bug                                          | Correction and evidence                                                                                                                                                                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Immediate switching could lose typed text    | The desktop's clean flag could lag behind the worker. Save now queries the worker's revision and modified state before skipping serialization. Immediate switch-back and close/reopen retained the text.                                                               |
| Close waited for a stalled startup           | With the runtime manifest request held, closing rejects startup waiters and cancels queued work. The window closes without waiting for the download or creating the requested file.                                                                                    |
| Empty or mislabeled imports were accepted    | LibreOffice accepted empty ODTs and plain text named `.odt`. The workspace now checks signatures before import/open. Invalid ZIP-based DOCX also returns a recoverable error and preserves the previous document.                                                      |
| Installed caches mixed bridge versions       | An old cached script caused `Unknown office operation` during saves. The iframe, bootstrap, and worker share a content-derived version; Office public files are excluded from app precaching. Creation and save then worked with an older service worker still active. |
| Initial typing could land in a toolbar       | Opening a Writer model now focuses its component window. Background reads/saves stopped generating synthetic resize events. Cold typing and native undo/redo passed the isolated regression.                                                                           |
| A late Close could remove a newly opened PDF | Close now yields if a newer Office operation arrived during its save. A test pauses the close-time state query, queues PDF opening, resumes Close, and checks that the PDF stays visible. Document processing still runs in WASM.                                      |

Window → Close, File → Close, and the desktop close control all save before closing. Documents is included in Vite's dependency-discovery entries.

The clipboard investigation found asynchronous selection changes in the test sequence. In 12 unpaced repetitions, Enter replaced the still-selected original text with a newline before paste ran. Paste inserted the correct clipboard content. Ten repetitions with a 40 ms ArrowRight keypress passed. A separate read check with input paused did not reproduce loss caused by the iframe's `inert` state.

`documents_read` reports bounded selection fields `collapsed`, `text`, and `truncated` through UNO's [XTextCursor](https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1text_1_1XTextCursor.html). The permanent regression waits for Select All and ArrowRight to produce the expected selection, then checks the complete text after Enter and paste. Native clipboard handling did not change. Arbitrary unpaced key sequences remain outside this result.

## Image insertion and fonts

Writer's Insert → Image menu and toolbar button open the Files/computer-import picker. `documents_edit` and `docs edit` use the same insertion logic. Imports create numbered copies in `/Pictures` on filename collisions. Insertion and the optional description form one native undo action. Reads return image metadata and a null text selection when an image is selected. Inserting in that state preserves the selected image.

Regressions covered Files insertion, real PNG/JPEG imports, duplicate names, selected text, undo/redo, missing/corrupt/unsupported/oversized images, a changed revision, and switching documents while the picker was open. Images survived close/reopen and DOCX export/reopen. After the source files moved to Trash, exported PDF pixels still contained the blue fixture, confirming that insertion embedded the image.

The terminal workflow found a binary encoding bug. `base64 -d > image.png` converted a binary string to UTF-8. The adapter now passes the requested encoding to ZenFS. A regression checked all 256 byte values through creation, copying by redirection, appending, and hexadecimal reads. The production workflow then created an image in Terminal, inserted it with `docs edit`, and rendered its PDF. The picker was checked at 1440×1000 and 390×844, including the native menu, toolbar, and real file chooser in the in-app browser.

The runtime added Noto Serif Bengali 2.003 regular/bold and Noto Sans SC 2.004 regular. These unmodified OFL 1.1 fonts are pinned by source commit and SHA-256, served locally through compressed runtime assets, and loaded before Writer. They add 7.12 MiB compressed. Fallback preserves document fonts and paragraph styles.

Visual checks covered Bengali conjuncts `ক্ষ`, `জ্ঞ`, `শ্র`, and `ত্র`; reph; vowel signs `কি কী কু কূ কৃ কে কৈ কো কৌ`; Simplified Chinese; a common Traditional Chinese sample; mixed Bengali/Chinese/Latin paragraphs; and accented Latin/Arabic controls. PDFs embedded all three added faces. A Python check matched embedded Bengali glyph outlines and sequences against HarfBuzz shaping with the original regular/bold fonts. The tested sequences matched exactly.

Browser tests covered ODT/DOCX close/reopen, PDF drawing/fonts, and failed font download/retry. They disabled PDF system-font fallback, checked embedded font programs, required shaped conjunct clusters, and rejected missing non-whitespace glyphs. Production testing at `http://127.0.0.1:5194/` included native paste, undo/redo, DOCX export/reopen, and PDF viewing at 1440×1100 and 390×844. The in-app browser imported and rendered the multilingual DOCX through its file chooser.

Coverage remains limited to the tested Bengali and upstream Chinese subset. Chinese bold/italic is synthesized from the regular face. Other Unicode characters and regional Chinese typography were not comprehensively checked.

## Startup and performance

The old metadata loader hung when `soffice.data.js.metadata` returned HTTP 503. `runDependencies` stayed at 1, `Module.calledRun` remained unset, and readiness never resolved. The bootstrap now fetches and validates metadata before supplying it through `Module.locateFile`. Dock and agent launches both have asset/runtime deadlines and Retry creates a fresh engine. The earlier image-test timeout reportedly received HTTP 200 assets, so this investigation did not establish that it had the same cause.

PDF-only viewing made no Office requests and mounted no Writer iframe. New and Back to document started Writer on demand. A failed launch left the PDF readable and downloadable beside Retry. Boot/ready messages handled missed iframe-load callbacks. Cancellation and Close aborted pending work, removed the iframe, and ignored late notifications. Cross-frame errors retained their useful messages in the UI.

The 17 startup tests covered missing bootstrap/runtime/worker scripts, metadata HTTP errors and invalid JSON, stalled workers/downloads, missed load callbacks, denied cache access, corrupt cached data, PDF-to-Writer retry, cancellation, and Close during asset/runtime/worker startup. Deadline tests advanced the browser clock. These cases covered confirmed failures, not every possible upstream WASM deadlock.

The old preview build downloaded about 82.2 MB of compressed chunks on every reopen. Caching content-addressed chunks and streaming decompression removed those downloads in all 19 measured warm reopens. Every close released the live engine and workers.

The controlled comparison used the same machine, Chromium/Playwright 1.62.1, a 1440×1000 viewport, and blocked service workers. Both builds included the image/font changes. Only the later build included the startup changes. Each sequence created a small ODT, closed it, and reopened that file. Timings include tool completion and document import.

| Local measurement               | Before                | After                  |
| ------------------------------- | --------------------- | ---------------------- |
| First creation with empty cache | 4.49 s                | 4.62 s                 |
| Existing-file reopen median     | 4.48 s over 5 reopens | 2.61 s over 19 reopens |
| Existing-file reopen range      | 4.29 to 4.93 s        | 2.42 to 6.69 s         |
| Warm compressed chunk transfer  | 82.2 MB               | 0 MB                   |

Median reopening time fell 42%. Eighteen updated reopens took 2.42 to 2.82 seconds. The 6.69-second outlier made no chunk requests and showed slower local asset/native initialization. It remains in the reported range. Median updated phases took 0.47 seconds for cached assets and decompression, 1.19 seconds for native initialization, and 0.63 seconds to import the document. The remaining time included host and bridge work.

With CDP simulating 20 Mbps downloads and 60 ms latency, the before build took 40.57 seconds cold and 37.54/37.05 seconds for two reopens. The updated build took 40.06 seconds cold and 3.44/3.06 seconds for two reopens. The mean of those two warm samples fell about 91%. This was browser network emulation, not a field benchmark. The roughly 90.9 MB compressed first-use payload remained the main cold-start cost.

Two production tests checked PDF-only viewing and recovery. A one-page fixture rendered in 244/120/98 ms at widths of 1440/768/390 pixels, with no Office requests. At 390 pixels, an injected metadata failure left Download, Retry, and Close reachable. Retry opened a working document; keyboard input survived immediate close/reopen. Closing its dirty document took 1.82 seconds while saving.

With CDP CPU throttling at 4×, four launches across reloads took 11.01 seconds cold and 8.78/8.82/9.22 seconds cached. Text persisted, cached launches made no chunk requests, and there were no uncaught page exceptions. Clean windows closed in 149 to 302 ms; all Office workers were gone within 3.01 to 3.16 seconds. This simulated slower CPU execution, not a physical low-end or mobile device.

The production in-app browser also opened the multilingual DOCX, exported a PDF, closed Writer, viewed the PDF without an Office iframe, and returned to Writer. Keyboard input survived close/reopen. The installed service worker updated through the app's Update control before this check.

## Printing and compact windows

The UNO dispatcher disables Print, PrintDefault, PrinterSetup, PrintPreview, PrintPagePreview, and MailMergePrintDocuments through [FeatureStateEvent](https://api.libreoffice.org/docs/idl/ref/structcom_1_1sun_1_1star_1_1frame_1_1FeatureStateEvent.html) and ignores their dispatches. Command names were checked against the pinned Writer menus/toolbars. PrintLayout editing, Save, and PDF export remain enabled.

Ctrl/Cmd+P in Writer or the outer Documents window opens Download with PDF focused. PDF preview shows a dismissible explanation pointing to Download PDF. Users print the downloaded file in a PDF viewer.

Narrow Writer windows show an editing notice. Shared dialogs scroll while keeping their footer buttons visible; short viewports use less padding. Tests checked the image-description input and Cancel/Import buttons, rather than only the outer dialog bounds.

The three printing regressions checked all six disabled commands before and after reopening, enabled Save/PDF export, Control-P and Meta-P, and a real PDF download signature. They also covered Open, Save As, Export, Insert Image, cancellation, validation errors, Escape, PDF-only viewing/download, and the close/open race. Dialog sizes included 390×844, 320×568, 640×360, and 390×450.

Production testing used Chromium/Playwright at `http://127.0.0.1:5196/` and the Codex in-app browser. Screenshots confirmed disabled Print/Print Preview/Printer Settings menu entries and Command-P opening PDF download. Physical printing and physical mobile touch, IME, and virtual keyboards were not tested.

## Remaining limitations

| Finding                          | Consequence                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Large first-use download         | About 90.9 MB compressed plus native initialization. Cache eviction requires another download. Minimize/restore retains the live engine.                                                                                                                                                                                                                               |
| Cramped narrow-screen editing    | Shell and dialogs fit 390 pixels, but native controls move into overflow menus and page-width text becomes small. Desktop Chromium remains the practical editing target.                                                                                                                                                                                               |
| Stale lazy assets after rebuilds | Repeated local builds left an open page referring to a missing PDF import chunk. Update/restart recovered it and the PDF then rendered. Seamless updates of a live editor were not established.                                                                                                                                                                        |
| Runtime diagnostics              | Qt/soffice logged `QRect`, `QObject::connect ... invalid nullptr parameter`, and `__syscall_mprotect` diagnostics during successful workflows. One font run logged `Blocking on the main thread is very dangerous` from `_emscripten_check_blocking_allowed`. These were distinguished from uncaught application exceptions; responsiveness remains a runtime concern. |

The passes did not verify Safari/Firefox, physical mobile touch or IME, encrypted/signed documents, macros, mail merge, cross-tab collaboration, every native Writer dialog, or a representative corpus of complex office files. Legacy import testing used RTF; it did not include a binary DOC fixture.

## Evidence and rerunning

Permanent regressions are in [`tests/office.spec.ts`](../tests/office.spec.ts), [`tests/office-startup.spec.ts`](../tests/office-startup.spec.ts), and [`tests/office-print-mobile.spec.ts`](../tests/office-print-mobile.spec.ts).

```bash
pnpm exec playwright test tests/office*.spec.ts
pnpm test:e2e
```

Keep the tested server running unchanged during a browser run. Do not rebuild or restart it mid-test.

The original temporary evidence locations are listed below. Temporary files may no longer be present.

| Directory                       | Logs and artifacts                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/tmp/os-webmcp-office-qa`      | `deep-confirmed.log`, `regression-final.log`, `isolated-final.log`, `imported.png`, `viewport-390.png`, `roundtrip.docx`, traces, fixtures, and exploratory tests.                                                                                                                                                         |
| `/tmp/os-webmcp-office-fixes`   | `probe.log`, `navigation.log`, `human-timing.log`, `clipboard-regression.log`, and diagnostic scripts.                                                                                                                                                                                                                     |
| `/tmp/os-webmcp-office-images`  | `image-regression-4.log`, `binary-regression.log`, `production-verified.log`, `regression-final.log`, `isolated-writer.log`, `picker-final.png`, `picker-mobile.png`, `pdf-final.png`.                                                                                                                                     |
| `/tmp/os-webmcp-office-fonts`   | `office-suite.log`, `font-regression.log`, `production-final.log`, `shaping.log`, `writer-production.png`, `pdf-production.png`, `pdf-mobile.png`, `Languages.pdf`, `Production.pdf`.                                                                                                                                      |
| `/tmp/os-webmcp-office-startup` | `fault-before.log`, `metadata-stall-before.png`, `startup-final.log`, `full-suite-final.log`, `local-open-before.json`, `local-open-after.json`, `network-before.json`, `network-after.json`, `production.log`, test scripts, `pdf-1440.png`, `pdf-390.png`, `retry-390.png`, `retry-desktop.png`, `writer-recovered.png`. |
| `/tmp/os-webmcp-office-print`   | `full-suite-final.log`, `production-final.log`, test scripts, `print-route.png`, `mobile-editor.png`, `mobile-dialog.png`, `short-dialog.png`, `mobile-pdf.png`, `Print-check.pdf`.                                                                                                                                        |
