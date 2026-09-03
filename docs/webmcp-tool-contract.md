# WebMCP tool contract

Deskstead registers 70 tools with `document.modelContext.registerTool()` in the top-level page. The tools call the same TypeScript services as the visible apps. Mutations return the saved result after updating the desktop. If an app cannot display a completed save, the result includes a display warning so the agent can distinguish the save from the display failure.

One tab owns the saved workspace at a time. A browser Web Lock is acquired before mounting IndexedDB. A second tab shows a close-and-reload message and registers no tools. Agents should connect to the open desktop or reopen the workspace after its previous tab closes.

The implementation uses the [WebMCP specification](https://webmachinelearning.github.io/webmcp/), [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api), [Chrome best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices), and [OpenAI Site Tools guidance](https://learn.chatgpt.com/docs/webmcp). These were checked on September 3, 2026. Tools stay registered while the desktop is mounted because the whole workspace remains available across app switches. Each registration uses a lifecycle `AbortSignal`; each execution receives its own cancellation signal.

## Available tools

| Tool                    | Effect                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `home_get_context`      | Reads saved working preferences, a bounded skill catalog, and a brief for a fresh agent.               |
| `home_save_preferences` | Creates or revision-checks the saved Home preferences.                                                 |
| `home_list_skills`      | Lists saved skill names, descriptions, paths, and malformed-file warnings.                             |
| `home_read_skill`       | Reads one saved skill's instructions and revision.                                                     |
| `home_save_skill`       | Creates or revision-checks a skill instruction file.                                                   |
| `inbox_list`            | Discovers incoming requests, attachment counts, states, and project links.                             |
| `inbox_read`            | Reads a request, revision, source files, bookmark, and output links.                                   |
| `inbox_create`          | Collects a request, notes, and actual uploaded file bytes in a new Inbox folder.                       |
| `inbox_update`          | Revision-checks request changes, project filing, and completed output links.                           |
| `shortcuts_list`        | Discovers saved reusable procedures.                                                                   |
| `shortcuts_read`        | Reads a procedure, required inputs, source links, and revision.                                        |
| `shortcuts_create`      | Creates a reusable procedure with input and output guidance.                                           |
| `shortcuts_update`      | Revision-checks changes to a saved procedure.                                                          |
| `shortcuts_prepare`     | Saves a work order with Home preferences and prepares a paused Project run.                            |
| `studio_list`           | Discovers saved data explorer applications.                                                            |
| `studio_read`           | Reads an app's configuration, data revision, and source status.                                        |
| `studio_create`         | Creates and opens a persistent explorer for selected JSON data fields.                                 |
| `studio_update`         | Revision-checks an app's data and display settings.                                                    |
| `studio_open`           | Opens a saved explorer with search, filtering, and allowed source links.                               |
| `packs_export`          | Saves a portable binary-safe pack of user files, omitting System, Trash, and earlier packs.            |
| `packs_inspect`         | Validates a pack and reports destination collisions without importing.                                 |
| `packs_import`          | Imports missing files; optionally preserves conflicting regular files in /Imports before restoring.    |
| `projects_list`         | Discovers saved projects, reported progress, and unanswered decisions, with per-file warnings.         |
| `projects_read`         | Reads a saved resume brief, latest run, decisions, evidence, linked tasks, and project revision.       |
| `projects_create`       | Creates a project file with an objective, lasting context, and optional references.                    |
| `projects_update`       | Revision-checks changes to lasting context, references, or an existing task-list association.          |
| `projects_start`        | Records a named work session and ordered plan based on the previous saved run.                         |
| `projects_checkpoint`   | Saves reported progress, evidence, a next action, or a question for the latest unfinished run.         |
| `projects_answer`       | Records an answer and makes a waiting run ready to continue after its last question is resolved.       |
| `documents_create`      | Creates a styled ODT/DOCX in the shared workspace and opens Writer.                                    |
| `documents_read`        | Opens Writer and reads bounded text, styles, paragraphs, tables, text selection, and revision.         |
| `documents_edit`        | Applies a revision-guarded change and saves it.                                                        |
| `documents_export`      | Exports a new ODT, DOCX, or PDF.                                                                       |
| `sheets_create`         | Creates an ODS/XLSX workbook with named sheets, numbers, text, and formulas.                           |
| `sheets_read`           | Reads a bounded cell range, calculated values, formulas, errors, selection, charts, and revision.      |
| `sheets_edit`           | Edits or formats a range at a fresh revision, recalculates, and saves.                                 |
| `sheets_chart`          | Creates a native column chart linked to workbook cells.                                                |
| `sheets_export`         | Exports a new ODS/XLSX/PDF or a named chart as PNG for Documents.                                      |
| `notes_get_context`     | Reads the current Notepad draft, revision, save status, and selected passage.                          |
| `preview_read`          | Reads page text, selection and citation; optionally attaches source image or PDF-page pixels.          |
| `preview_search`        | Searches bounded PDF page text and returns page-numbered excerpts with continuation.                   |
| `preview_reveal`        | Opens an exact source page, optionally checking the revision captured in a citation.                   |
| `tasks_list`            | Reads a task list, file revision, evidence/output links, and optional status/text filters.             |
| `tasks_create`          | Adds a task, creating the list if absent; requires a revision for existing lists.                      |
| `tasks_update`          | Updates or removes a stable task ID at an exact list revision.                                         |
| `canvas_read`           | Reads an editable scene, revision, and the current visible scene's selected IDs.                       |
| `canvas_edit`           | Creates or edits objects, embeds workspace images, and reconnects arrows with revision checks.         |
| `canvas_export`         | Exports a revision-checked scene as a new PNG without replacing its editable source.                   |
| `files_list`            | Lists one folder.                                                                                      |
| `files_stat`            | Returns metadata for one path.                                                                         |
| `files_read`            | Reads saved text with a revision covering the entire file.                                             |
| `files_write`           | Creates a text file or replaces it with a required revision check.                                     |
| `files_patch`           | Replaces exact text, with match-count and optional revision checks.                                    |
| `files_search`          | Searches names and text beneath a folder.                                                              |
| `files_mkdir`           | Creates a folder and missing parents.                                                                  |
| `files_move`            | Moves or renames a file or folder.                                                                     |
| `files_copy`            | Copies a file or folder.                                                                               |
| `files_trash`           | Moves an item to `/Trash`. Restore it with `files_move`.                                               |
| `terminal_run`          | Runs one short Bash command and returns its final result.                                              |
| `terminal_start`        | Starts a job and returns its ID immediately.                                                           |
| `terminal_wait`         | Waits briefly for a job revision or final result.                                                      |
| `terminal_cancel`       | Cancels a queued or running job.                                                                       |
| `terminal_jobs`         | Lists recent job metadata. Read a job's output with `terminal_wait`.                                   |
| `activity_list`         | Lists recent human and agent activity.                                                                 |
| `review_list`           | Lists saved file changes, explicit work summaries, and recovery limits.                                |
| `review_read`           | Reads project/task/canvas change summaries or text differences, current token, and restoration checks. |
| `review_restore`        | Restores snapshot bytes to a new copy or revision-checked original; preserves replaced contents.       |
| `review_session`        | Creates or revision-checks an explicitly grouped work summary with results and open questions.         |
| `desktop_reveal`        | Brings an app forward or shows a workspace path to the user.                                           |
| `desktop_get_context`   | Reads the active app, visible files, selections, and draft status without opening or saving.           |

## Current desktop context

Use `desktop_get_context({})` for requests about "this project", "this task", "the selected file", or "the change I am reviewing". It returns `activeApp`, `openApps`, and `context` for visible apps. Closed and minimized apps have null context. The app ID for Notepad remains `textedit`; its context key is `notepad`. Review uses the `activity` app and `context.review.tab`.

Finder returns `selectedPath`. Tasks returns `selectedTaskId`, saved list revision, filters, and dirty/stale draft status. Review returns the selected version or work-summary ID. Canvas returns selected element IDs and pending-edit state. Notes and Preview return their current selections. Documents and Sheets provide the file path and a `selectionTool` name for the app read that retrieves editor selection. Context reads never mount editors, restore sessions, save drafts, or change focus. Read the relevant app content and revision before editing.

Projects returns `path`, `revision`, `projectId`, `selectedRunId`, `view`, `draft`, and `busy` in `context.projects`. View is `overview`, `handoff`, `work`, or `context`; a draft reports its path, base revision, and dirty/stale state. The selected run may be historical, so read `projects_read` for the latest saved run before writing a checkpoint.

`tasks_list({})` resolves the remembered list after reload. If no current file exists, it returns null path/revision, empty tasks, and bounded list discovery. It never creates a default list. Canvas reads also resolve the remembered file, while Preview reads resolve its remembered file and page.

`projects_read({})` resolves the open or remembered project after reload. A missing file returns `PROJECT_NOT_FOUND`; use `projects_list({})` to discover available paths. Both reads leave files, app focus, and Activity unchanged. Opening Projects without a saved project does not create one.

Home, Inbox, Shortcuts, and App Studio appear in desktop context while visible. The latter three include the open file path, revision, pending-edit flag, and read-tool name. `workingPreferences` is an independent saved Home orientation, capped at 8,000 characters; `truncated` indicates when to call `home_get_context` for the full brief. This read does not create default preferences or save drafts.

## Results and errors

Tasks and Canvas use [canonical task files](tasks.md) and [editable Excalidraw scenes](canvas.md), not extra databases. `desktop_reveal` infers `tasks` for `.tasks.json` and `canvas` for `.excalidraw` or legacy `.canvas.json`; explicit `textedit` still allows source inspection. `tasks_list` is a pure saved-file read. `canvas_read` flushes completed human edits, refuses active gestures, and can return a rendered PNG with `includeImage:true`; its read-only hint is false. Neither read tool creates a default file. Mutating tools show the app and return a SHA-256 revision, plus `entry.versionId` when Review captures the save. Canvas agent edits to the mounted scene enter its session-local native undo history. Dirty human work remains visible on conflict; in-place Review restoration also checks pending edits.

Projects uses one canonical `.project.json` file through `WorkspaceJson`. `desktop_reveal` and Finder open that file in `projects`. Its mutations return `path`, a SHA-256 `revision`, the saved `brief`, and a workspace `entry` with Review `versionId` or `recoveryWarning` when present. Start and checkpoint add the `run`, and decision writes add the `decision`. Read adds `briefText`. Discover project versions with `review_list({ path })`. Review shows readable project, run, step, and decision changes, and supports restoring a `.project.json` copy. In-place restoration and agent project writes reject unsaved Projects forms with `OPEN_DRAFT`.

Notepad retains the `textedit` target identifier for existing `desktop_reveal` callers. Agents edit its Markdown and text files with the file tools. Renames and moves from Finder, WebMCP, and Terminal follow the open document. Human saves compare their last read content before writing. Conflicting drafts remain recoverable in the same filesystem and can be saved as copies in Notepad.

Successful calls return a short text summary and structured data with `ok: true`. Recoverable failures return `ok: false`, a stable error code, a specific message, and a correction hint when one is useful. The shared tool wrapper rejects non-object inputs, unknown top-level keys, and missing required fields. Individual parsers check field types and application rules. The shared optional-field readers default only when a value is omitted. Some application fields, such as task dates and links, also accept `null` to clear a value.

Pure read tools carry `readOnlyHint: true`. `documents_read` and `sheets_read` use false because opening a file can save pending edits. Documents also converts DOC and RTF imports to ODT. Tools that return workspace or terminal content, including `terminal_cancel`, carry `untrustedContentHint: true`. `terminal_run` forwards each execution's cancellation signal into `just-bash`.

Tool definitions live with their apps. `webmcp/register.ts` combines the tool lists and manages registration. `desktop_reveal`, Finder, and result links share the desktop file-opening command, including file-type routing and Notepad readiness.

See [the Documents integration](office.md) for office formats, semantic operations, bounded reads, conflicts, and the `docs` terminal command. Text tools reject office binaries; ordinary file move/copy/trash tools still apply.

See [the Sheets integration](sheets.md) for the spreadsheet schemas, explicit formula cells, revision checks, charts, and export limits. `desktop_reveal` infers Sheets for ODS/XLSX or accepts `target: "sheets"`. Reads preserve the human selection; deliberate cell edits select their target range. Spreadsheet content is inspected with `sheets_read`, not `files_read` or `docs read`.

See [Preview and Sources](preview.md) for page-aware PDF reading, PNG/JPEG pixels, search continuation, selection context, and revision-checked references. `preview_read` can attach a PNG of an image or the requested PDF page with `includeImage:true`. `desktop_reveal` infers Preview for PDF/PNG/JPEG or accepts `target: "preview"`. Preview tools carry `readOnlyHint: false` because they open the visible app and save its current-page checkpoint. They do not edit the source bytes. The Sources panel in Documents reads a JSON sidecar written using `files_write`; updating an existing sidecar requires its fresh file revision.

## Personal workspace workflow

Start with `home_get_context` to read working preferences and available skill instructions. Read a relevant skill with `home_read_skill`; saving instructions does not install software or connect an MCP server. The [Home guide](home.md) describes profile fields and edit revisions.

Use `inbox_list` and `inbox_read` to find incoming work, then use the existing file and app tools to inspect its attachments. `inbox_create` accepts UTF-8 text or base64 binary files. A saved source URL is only a bookmark. Filing a request requires an existing project, and completion requires saved output links. See [Inbox](inbox.md).

`shortcuts_prepare` requires the current shortcut revision, a project path, and a new Markdown work-order path. Supply either a current project revision or new-project details. It saves the procedure, input links, request, and Home orientation in the work order and appends a paused run to the project. No agent is launched. An agent that accepts the work can read the project and start its own run based on that prepared session. See [Shortcuts](shortcuts.md).

App Studio manifests end in `.app.json`. First save a JSON array through Files, then call `studio_create` with the data path, selected columns, display settings, and allowed source files. The fixed renderer provides cards, tables, search, and a filter. Manifest text and data cannot execute uploaded code. Source buttons open only selected workspace files. See [App Studio](studio.md).

`packs_export` creates a new `.desktop-pack.json` in the workspace. `packs_inspect` validates an existing pack and reports collisions. `packs_import` repeats that preflight inside the shared mutation queue. Existing identical files are retained. Different contents block the default import; explicit `conflictMode: "preserve"` moves conflicting regular files into `/Imports/Conflicts-<id>/` before restoring original paths. Open drafts, live office editors, folder conflicts, and symlinks remain blocked. The result reports imported paths, preserved-file mappings, collisions, or failure cleanup and restored originals. Review history, open app state, and running jobs are not portable. See [Workspace packs](workspace-packs.md).

## Project continuity

Use `projects_list` to find work needing an answer, then `projects_read` to recover context. The brief contains the latest run, its ordered steps and evidence, every unanswered decision, the ten most recently answered decisions, and up to twenty linked tasks. It includes omission counts for older answers and additional tasks. Full run history stays in the project file. Discovery inspects at most 100 candidate files and reports both `truncated` and per-file `warnings`.

Every change to an existing project needs `expectedRevision`. `projects_start` requires the previous run to be paused or complete and its ID in `basedOn`. `projects_checkpoint` changes only the latest unfinished run. Step status is `pending`, `in-progress`, `done`, or `skipped`. Run status is `working`, `waiting`, `paused`, or `completed`. Pausing requires a next action; completion requires a summary, completed or skipped steps, and no open decisions belonging to the run. Arrays supplied to an update or checkpoint replace their saved contents.

Add `decision: { question, options? }` to a checkpoint to request an answer and mark the run waiting. `projects_answer` records the user's supplied or authorized answer. After the last answer, a waiting run becomes paused. That transition does not update its checkpoint time or resume execution. A session's agent name is a saved label, not proof of who made every later edit. These tools record project context in the same browser workspace; they do not launch agents, send notifications, or synchronize devices. HTTP and HTTPS references are stored links. Local evidence must exist when attached and reports its current existence when read.

| Error               | Recovery                                                                            |
| ------------------- | ----------------------------------------------------------------------------------- |
| `PROJECT_NOT_FOUND` | Discover project paths with `projects_list` or create a new project.                |
| `FILE_CHANGED`      | Read the current brief and revision, then adapt the edit.                           |
| `OPEN_DRAFT`        | Save or discard the human Projects draft before an agent write or in-place restore. |
| `RUN_ACTIVE`        | Pause or complete the previous run before starting another.                         |
| `HANDOFF_CHANGED`   | Read the latest run and pass its ID as `basedOn`.                                   |
| `RUN_NOT_CURRENT`   | Checkpoint the latest run; older handoffs remain saved.                             |
| `RUN_COMPLETED`     | Start a new run based on the completed one.                                         |
| `DECISION_ANSWERED` | Keep the saved answer; record changed guidance in context or ask a new question.    |

See [Projects](projects.md) for exact input fields, a complete handoff example, evidence rules, and file limits. Agent labels, notes, and verification claims remain untrusted reported content.

## Shared note editing

See [Activity and Review](review.md) for the four review tools, capture boundaries, file and session revisions, and storage limits. File saves return `entry.versionId` when captured; `activity_list` includes version/session links when available. Use `review_list` to discover snapshots from Office saves. Projects, Tasks, and Canvas return app-level change summaries; `includeRawDiff:true` also returns their raw JSON differences. Other text review is line-based. Binary review uses metadata and restore-as-copy inspection. Review does not reconstruct missing snapshots or undo arbitrary shell commands.

`files_search` excludes `/Trash` and its contents by default. Set `includeTrash: true` to search discarded material, including when `path` is `/Trash`. The result echoes `includeTrash` so its scope is explicit. Folder scopes match complete path segments: `/Notes` does not include `/Notes Archive`. Finder uses the same search, including discarded files when the user searches inside Trash.

`notes_get_context` reads the current or last-opened note without opening or saving it. It returns `path`, `title`, bounded `content`, `totalChars`, `truncated`, `revision`, `saveStatus`, `hasUnsavedChanges`, `isOpen`, `isFocused`, `editorReady`, `editorVisible`, `mode`, and `selection`. The default content limit is 20,000 characters, configurable up to 200,000 with `maxChars`. The revision covers the complete live draft even when the response is truncated. `files_read` reads saved text instead and returns the revision of the entire saved file, including when reading only a range of lines.

Selections in formatted mode contain rendered `text` with up to 200 characters of context `before` and `after`. These are not Markdown offsets. Match the intended passage against the returned Markdown, retaining syntax such as bold marks and links. For repeated passages, include surrounding text in `files_patch.find` so the replacement is unique. Markdown and plain-text modes additionally return `sourceStart` and `sourceEnd`, zero-based UTF-16 offsets into the full source. An empty selection or a closed editor returns `selection: null`. Selected text is also bounded by `maxChars`, with its own `truncated` flag.

For an agent edit:

1. Read `notes_get_context` for "this note" or a selected passage. Use `files_read` when the path is already known and saved text is sufficient.
2. Send a focused `files_patch` with `expectedRevision`, or `files_write` with complete content and `expectedRevision`. Whole-file replacements require a revision; new files can use `createOnly: true` to reject name collisions. `createOnly` and `expectedRevision` cannot be combined.
3. File tools finish ordinary pending Notepad saves before applying an edit. They recheck the live draft inside the shared mutation queue. A changed file returns `FILE_CHANGED`; an unresolved or newly changed draft returns `NOTE_DRAFT_CONFLICT`. Read again and adapt the edit instead of retrying an old replacement.
4. Successful writes return the saved `revision`, `saved: true`, `displayed`, and the tracked note's `saveStatus` and `hasUnsavedChanges`. If human input arrives while the file is committing, the new draft is retained and reported separately. A display failure is reported as `displayError` alongside the successful save, so the agent does not repeat a completed mutation.
5. Use `desktop_reveal` to show the result. For Notepad it waits for the requested file and the formatted or source editor to be ready, then returns `editorReady`, `mode`, and `saveStatus`. In a narrow window, it also dismisses the notes list so the editor is visible.

Revisions are SHA-256 digests of the complete text, stable across reloads. The comparison and file mutation run in the same queue used by Terminal. These checks protect edits made through the guarded tools; Bash remains a direct filesystem interface, with Notepad's existing draft recovery handling external conflicts. There is no automatic merge or separate note storage.

External changes to an open formatted note are separate undoable edits. Undo reverses the external change before earlier human typing; Redo reapplies it. Edits typed afterward form their own history event. This history belongs to the mounted formatted editor and does not persist across closing the editor or switching notes or source mode.

## Terminal jobs

`terminal_run` remains the direct path for commands expected to finish within eight seconds. Longer work uses a page-owned job:

1. `terminal_start` returns a job ID, status, and revision without waiting for completion.
2. `terminal_wait` accepts the last observed revision and waits up to 30 seconds for newer state. A wait timeout leaves the job running.
3. `terminal_cancel` aborts queued or running work.
4. `terminal_jobs` lets an agent recover IDs and inspect recent work. It returns command, status, revision, timing, and exit metadata without repeating stdout or stderr. Use `terminal_wait` with a discovered ID to retrieve output, including from a completed job.

Jobs move through `queued`, `running`, `completed`, `failed`, `cancelled`, or `timed_out`. Their maximum runtime is five minutes. `just-bash` returns output when execution finishes rather than streaming it incrementally, so running jobs expose status and the final revision exposes `stdout`, `stderr`, and `exitCode`. Cancelling a `terminal_wait` call cancels only that wait. It does not cancel the job.

Jobs belong to the current page session. Reloading the page stops in-memory execution; completed filesystem changes remain in IndexedDB.

## Evaluation

The Playwright suite executes registered callbacks against the live app and checks the visible result in Finder, Notepad, Terminal, and Activity. The contract tests check malformed inputs, annotations, registration cleanup, and bounded job discovery. Notepad tests cover ready-on-return opening, selections among repeated passages, unsaved drafts, stale and competing edits, Terminal conflicts, and persistence after reload.

Project tests cover an agent checkpoint, a human answer, and a fresh page session continuing from the saved brief. They also exercise conflicting revisions, human draft protection, missing evidence, malformed-file discovery, visible project selection, and semantic Review recovery. The workflow tests invoke tools explicitly; they do not prove that a model selects them without guidance.

[`tests/webmcp-evals.json`](../tests/webmcp-evals.json) contains model-routing cases in the [GoogleChromeLabs evaluation format](https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/webmcp-evals). Prompts supply concrete paths and requested content; continuation cases include prior tool responses with fixture revisions or job IDs. These fixtures test how an agent uses returned information. They are not a browser smoke script and do not create those jobs or files. Runtime correctness and agent tool selection need separate runs, as described in [Chrome's evaluation guide](https://developer.chrome.com/docs/ai/webmcp/evals). Passing callback tests does not establish that a model chooses the right tools.
