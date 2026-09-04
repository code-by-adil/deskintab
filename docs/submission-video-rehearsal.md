# Submission video rehearsal — 4 September 2026

## Published recording

The final narrated demo was published publicly on YouTube on 4 September 2026: [DeskInTab — A Shared Desktop for Humans and AI](https://youtu.be/42DKX0ZmOdk). The source export is `video/harbor-demo-voiceover.mp4`, 164.7 seconds with audio. Video renders, original recordings, and editing intermediates remain local.

The recording follows source inspection, Terminal data extraction, spreadsheet formulas and chart export, a formatted document and PDF, task updates, reload persistence, and Canvas. It does not claim a human approval or fresh-agent handoff. The sections below preserve the earlier rehearsal history; their remaining-capture notes describe the state at that time.

## Full revised rehearsal — completed

The revised source-to-deliverables workflow completed on production, approximately 07:39–07:44 Bangladesh time, using native WebMCP calls in the main Codex task. This was a functional rehearsal, not a video recording or an error-free clean take. The user removed the fictional approval gate; no human approval is claimed.

Workspace: `/Projects/Harbor Full Rehearsal`. Earlier rehearsal files were preserved.

Verified sequence:

1. Prepared a fictional client brief in DOCX/PDF and copied the existing sixteen fictional interview records into a new Research folder.
2. Opened the source folder in Finder and read the PDF in Preview.
3. Used `terminal_start` / `terminal_wait` to run `docs text` on the DOCX, save extracted text, and search the four-day constraint. Opened the generated text in Notepad.
4. Used Terminal `jq` pipelines to convert the fixture CSV to JSON and aggregate themes with interview IDs. Checked all sixteen IDs, themes, and exact quotes against the original CSV. The fixture parser assumes quoted fields without embedded commas; it is not a general CSV converter.
5. Created `Outputs/Reader priorities.ods` from the actual Terminal output, with Summary and Evidence sheets. Readback verified 16 interviews, six build days for all features, and four days for the recommendation. Styled the table, created a linked bar chart, exported `Reader needs.png`, and closed Sheets after saving.
6. Added source paths to the evidence using Terminal and created `Outputs/Reader voices.app.json`. Filtering yielded eight offline-reading records; searching “flight” yielded one. The visible Open source action opened the original interview note.
7. Created `Outputs/Release brief.docx` and inserted the chart exported by Sheets. Resized its image to 120 × 69.22 mm. The text presents a recommendation, not an approved or implemented release.
8. Used a Terminal job to run `docs export` from DOCX to PDF. Preview verified one page and the expected source-backed text; the embedded chart was visibly present.
9. Completed the deliverable-preparation task; left implementation as todo. Saved a completed Projects run with four done steps, linked evidence, and no open decisions. Saved a completed Review work summary.
10. Reloaded the desktop, refreshed the native browser connection, and verified the completed project and functioning explorer. The PDF remained one page with the exact same saved revision.
11. Exported `/Exports/Harbor full rehearsal completed.desktop-pack.json` (37 files, 13 folders across the workspace, including earlier work). This is a saved workspace pack, not a video or a clean source-only reset.

Corrections discovered in this pass:

- One initial Terminal pipeline had incorrectly escaped quotes; corrected it and verified the resulting data. Use the corrected command for recording and `&&` between dependent steps so a failed earlier operation is not masked by a later successful command.
- `docs` operations can bring Documents forward; reveal Terminal again when showing the completed command history.
- Following reload, a fresh tab/tool handle was needed after stale-registration responses. The existing saved data and native tools worked after reconnecting.
- This pass used ODS and closed Sheets immediately after chart export. It did not establish that the earlier repeated-autosave issue was fixed.
- Narrow-viewport framing still needs a recording sample. This pass did not repeat Canvas, the optional pickup already demonstrated in the first rehearsal.

The full revised functional rehearsal is complete. Remaining production work is a clean capture, cuts/trim, voiceover, and final export—not another fictional decision.

## Earlier exploratory rehearsal

This was a live native-WebMCP rehearsal in Codex's main task, not a recording. No footage or voiceover has been captured. Production: https://deskintab.dgkhan08.workers.dev/.

## Starting state

Created a separate `/Projects/Harbor Rehearsal` folder after checking existing workspace contents. All interviews and effort estimates are explicitly fictional. Existing Launch files were preserved.

The source-only workspace pack is `/Exports/Harbor rehearsal start.desktop-pack.json`. It contains the workspace files present at export, including starter files; it is not an isolated Harbor-only archive. Importing it does not delete later outputs. Use a separate recording workspace or unused target names for the clean take; do not clear the person's site data.

## Verified sequence

1. Inbox request and Projects context save and survive the deployment reload.
2. Read `Research/Feedback.csv` and `Research/Team brief.md`; open `Research/Interviews.md` in formatted Notepad.
3. Start a Projects run with four meaningful steps.
4. Terminal: `cut -d, -f2 Research/Feedback.csv | tail -n +2 | sort | uniq -c` returns 3 download-status, 5 search, and 8 offline-reading requests. Reveal Terminal before running the command in the clean take so its execution is visible.
5. Sheets: save `Reader priorities.xlsx` with Summary and Interviews sheets. Readback confirms formulas for 16 interviews, 6 days for all features, and 4 days for the proposed release. Format headings and create a linked bar chart. Export `Reader requests.png`.
6. App Studio: save exact source-derived quotes in `Findings.json`, create `Feedback.app.json`, filter to eight offline-reading records, then search “flight” for one result. The visible Open source button opens the original interview note.
7. Canvas: save `Release sketch.excalidraw`, revise overflowing labels, fit the view, and export `Release sketch refined.png`. The earlier `Release sketch.png` is an unrefined rehearsal output, not the final capture asset.
8. Documents: save `Release brief.docx`; read back the complete text, table, and revision. Export `Release brief DRAFT.pdf`. Preview confirms exactly one page and the expected source-backed text.
9. Tasks: completed analysis links to the workbook; scope review remains in progress; implementation remains todo.
10. Projects: save a waiting checkpoint with deliverable links and the human question: should offline reading plus download status ship first, with search next release?

The human decision and post-answer continuation are not yet verified. Do not describe this as a completed fresh-agent handoff. The current task retains its earlier context.

A working Review summary records these verified outputs and the known history issue. `/Exports/Harbor rehearsal awaiting decision.desktop-pack.json` preserves this intermediate state (22 files, 10 folders); it is not a completed or approved release pack.

## Corrections for the clean take

- Warm Office before recording. The cold Sheets call hit the browser's roughly 20-second evaluation timeout, but the operation continued and saved the workbook. A read-only file check and workbook read verified completion; do not blindly retry a timed-out creation.
- App Studio title/filter fields must be included in selected columns. The corrected manifest includes `title`, `theme`, and `quote`.
- Writer style names are case-sensitive. `Text Body` was rejected; the reported available style is `Text body`. Omitting the body style used `Standard` successfully. `Title`, `Subtitle`, and `Heading 1` worked.
- Fit Canvas before showing it. Use the refined shorter labels with font family 2 at 18px. Keep the selection cleared for the final shot.
- At the observed 841px-wide browser viewport, the workbook's floating chart overlaps some cells. Capture the table and exported chart in separate shots, or use a wider recording layout. Do not treat this rehearsal layout as final framing.
- Use named, sequential tool calls and visible outcomes. Keep failed trial calls out of the clean take, without fabricating successful calls or replacing captured application behavior with animation.
- Keep the proposal and PDF labeled draft until the person answers. Never mark the implementation task complete during a planning demonstration.

## Additional issue observed

After chart creation/export, the open workbook repeatedly saved without further user edits. Activity recorded roughly one `Document updated` entry per second as `human`, and Review reached its 100-version cap; a later DOCX-filtered review returned no versions. Closing Sheets stopped the visible session. The cause is not established and no fix is included in the catalog change. Do not use this history as accurate evidence of human actions or film the Review ending as clean until this behavior is investigated. The editable workbook and its checked values were saved successfully.

## Remaining capture work

Receive the real scope answer, persist it in Projects, reread the saved brief, revise the DOCX/table, export a new final PDF, complete only the review task, and link the outputs to Inbox. Then inspect Activity/Review and export a completed-work pack. Record a short legibility/audio sample before the master take. Editing and voiceover follow the verified capture.
