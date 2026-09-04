# DeskInTab — two-minute submission film

Draft treatment, 4 September 2026. This is a production plan, not a record of completed filming.

## The story

**An agent does useful work in a computer you share. You inspect the evidence, make a decision, and continue from the same files.**

Follow a small product team deciding what to ship next from customer interviews. Use the fictional Harbor reader project already featured in the README screenshots. Keep the story understandable without knowing anything about WebMCP: interviews become a recommendation, the person chooses a scope, and the agent updates the actual work.

The audience should remember three things:

1. The tool calls change real, visible apps.
2. The results are editable files, not just a chat answer.
3. Human decisions and project context stay with the work.

Record broad app coverage, but do not give every app equal time in the final film. The cause-and-effect chain matters more than the number of tools. Use App Studio as a brief surprise: the analysis becomes something the person can search and explore.

## What was checked for this plan

This section records the initial planning pass. The subsequently authorized catalog fix is deployed and native WebMCP works on production. See [rehearsal results](submission-video-rehearsal.md) and [release verification](release.md) for current evidence; the original blocker below is resolved.

- Read AGENTS.md, README, the WebMCP contract, and app guides for Projects, Home, Inbox, Shortcuts, App Studio, Documents, Sheets, Canvas, Preview, Tasks, Review, and workspace packs.
- Inspected registration/catalog code, Studio and Terminal tool implementations, metadata tests, and the personal-computer workflow test. These tests call registered callbacks; they are not evidence that native client discovery currently works.
- Inspected the live desktop and the three existing README screenshots. The screenshots are visual references, not newly recorded video. The Terminal reference still shows the historical Deskstead name, so record current footage rather than reusing it as proof of the present build.
- Attempted native WebMCP discovery in Codex's in-app browser. It failed: “WebMCP is disabled for this page because the site’s WebMCP configuration exceeds supported limits.” The same limitation is recorded in docs/release.md. No successful app-tool execution or end-to-end live workflow was verified in this planning pass.
- The contract and registration test expect 89 tools; README still says 70. Avoid a tool-count claim in the video. The exact client constraint causing the failure has not been established; the local 57,500-byte metadata test is not a verified client limit.
- Checked current Devpost submission requirements and judging criteria through its connector. The video requirement is a public YouTube video under three minutes, with audio covering the app and its WebMCP use. A two-minute cut fits. The criteria reward WebMCP leverage, coherent execution, specific impact, and creativity/ambition.
- Checked Remotion documentation via the installed skill, web, and Context7. Studio WebMCP can inspect compositions/sequences/selections and control playback, seeking and guides. Build the actual edit in Remotion source; do not assume every editing operation is exposed as a Studio tool.

Sources: [challenge](https://webmcp.devpost.com/), [Remotion Studio WebMCP](https://www.remotion.dev/docs/ai/webmcp), [Remotion sequences](https://www.remotion.dev/docs/sequence), [OpenAI Site Tools](https://learn.chatgpt.com/docs/webmcp).

## Before filming

Native WebMCP invocation in the intended recording client was the blocking prerequisite. It is now verified after the authorized catalog fix. Keep using the real native tools for filming: do not record direct service calls or test callbacks and label them native WebMCP.

Once that works:

1. Make a dedicated, clearly fictional demo dataset. Do not touch unrelated workspace files. Inspect whether Harbor already exists before choosing paths. The new production origin currently opens the starter Launch folder; the Harbor screenshot assets do not establish that Harbor data exists there.
2. Prepare a clean source-only starting state and export a workspace pack. Keep a separate completed-work pack after rehearsal. Packs contain saved files, not running jobs, open windows, or history snapshots. Do not reset by clearing the user's site data.
3. Rehearse the exact story using native WebMCP. Check every report statement, formula, source link, and saved decision against the source material. Stop and revise the script if any proposed effect fails.
4. Warm Writer, Calc, and Canvas before the take. Office has a substantial cold start; minimize warm editors when appropriate. Cut loading delays, but do not suggest a cold launch is instantaneous.
5. Check a short screen-recording sample for legibility, motion, cursor visibility, and dropped frames. Continuous desktop video capture has not been tested in this planning pass. macOS capture permission or the recording picker may need the user's participation.
6. Hide unrelated chats, notifications, accounts, and personal files from the recording region. Mute system/startup sounds. Use original or permission-cleared wallpaper and music; release notes flag unresolved media attribution. This plan does not clear those rights.

No recording, app modifications, deployment, or publication was performed for this plan.

## Demo material

Harbor is a fictional reading app. Its users want to read saved articles without a connection, find saved articles faster, and know when downloads are ready. The team has to choose a focused first release.

Prepare interview notes plus a CSV of feedback. Preserve exact quotes and source links. Define whether counts mean people, interviews, or mentions and use that definition consistently. Do not copy the counts from old screenshots without constructing and checking the corresponding source records. Any effort estimate must be supplied as a fictional team estimate, not portrayed as something derived from interviews.

Suggested outputs, under an unused Harbor demo project folder:

- `Research/Interviews.md` and `Research/Feedback.csv`: source material.
- `Reader feedback.xlsx`: counts, a simple formula, and a linked chart.
- `Findings.json` and a `.app.json` explorer: searchable findings with source paths.
- `Delivery plan.excalidraw` and a PNG export: three or four labeled steps.
- `Release brief.docx`: a short, styled recommendation with a compact table and the exported visual assets.
- `Release brief.pdf`: the final shareable export.
- `Launch.tasks.json`: tasks for the analysis and next actions, linked to outputs.
- `Harbor.project.json`: objective, source links, checkpoint, question, saved answer, and next action.

An Inbox request can link the inputs and final outputs without duplicating them. Home preferences and a saved shortcut can be prepared before the main take. They should influence the actual work, not become unrelated demonstrations.

## Two-minute edit

| Time      | Picture and action                                                                                                                                                                                         | What it proves                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 0:00–0:07 | Open on the actual desktop with an attractive report/diagram result, then establish the clean starting view. Small DeskInTab title, no long logo animation.                                                | This is a working place, with an outcome worth watching.                                              |
| 0:07–0:15 | Wider view: Codex conversation beside DeskInTab. Brief look at the shared project folder.                                                                                                                  | The person and agent share one desktop and files.                                                     |
| 0:15–0:35 | Show the Harbor request, source notes, and a brief animated request card. Show native discovery/read calls and one short Terminal search with its real result visible. Home/Inbox may appear briefly here. | The recommendation starts from actual source material; WebMCP connects the agent to app capabilities. |
| 0:35–0:48 | Sheets creates the feedback workbook and linked chart. Keep one formula/result legible. Show the saved filename.                                                                                           | Supporting analysis is a real editable workbook.                                                      |
| 0:48–1:00 | App Studio opens the feedback explorer. Filter one theme, then open an original interview in Notepad.                                                                                                      | A reusable interactive result with traceable evidence.                                                |
| 1:00–1:17 | Canvas diagram appears; cut to the formatted release brief in Documents. Show the diagram or chart inserted into the report.                                                                               | Several apps contribute to one useful artifact.                                                       |
| 1:17–1:41 | Projects shows the unresolved scope question. The person answers “Offline reading first; search next.” The agent reads the saved answer, revises the report, and updates linked tasks.                     | Human judgment actually changes the work. This is the emotional center of the film.                   |
| 1:41–1:55 | Brief Activity/Review inspection, then the finished PDF in Preview beside the editable report. Show saved project links/next action.                                                                       | Results are inspectable, editable, shareable, and saved for continuation.                             |
| 1:55–2:00 | Calm end frame with the actual desktop, DeskInTab name, and live URL.                                                                                                                                      | “One desktop. Shared work. Something you can pick up and continue.”                                   |

The voiceover is approximately 226 words. Record conversationally with pauses; the time blocks are edit targets, not instructions to rush. Adjust picture timing to the real recording. Keep the total at 120 seconds, including the closing card.

## Tool-call shot list

These are capture intentions, not a runnable script. Discover current tool schemas first; obtain all paths, IDs, and revisions from actual results. Do not hard-code revision tokens or submit all calls at once. A scene is complete only after checking the visible result and saved content.

| Beat     | Tools to rehearse                                                                                                               | Evidence to capture                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Orient   | `desktop_get_context`, `desktop_describe_tool`, `home_get_context`, relevant skill/read tools, `inbox_read`, `projects_read`    | A recognizable request and source folder; concise genuine tool result.                                            |
| Inspect  | `files_list`, `files_read`, `files_search`, `terminal_run`                                                                      | Source lines and command output shown in the visible Terminal.                                                    |
| Analyze  | `sheets_create`, `sheets_read`, `sheets_edit`, `sheets_chart`, `sheets_export`                                                  | Cells, formula result, linked chart, saved XLSX, exported chart PNG.                                              |
| Explore  | `files_write` for checked findings, `studio_create`, `studio_query`                                                             | Same findings searchable by the person; original source opens.                                                    |
| Diagram  | `canvas_edit`, `canvas_read`, `canvas_export`                                                                                   | Editable shapes and connectors, then the exported snapshot.                                                       |
| Write    | `documents_create`, `documents_read`, `documents_edit`                                                                          | Styled report, supporting table, embedded chart/diagram, saved DOCX.                                              |
| Ask      | `projects_start` as needed, `projects_checkpoint`                                                                               | A real waiting checkpoint with evidence links and one clear question.                                             |
| Decide   | Human uses Projects' Answer UI; then `projects_read`                                                                            | Saved human answer, not an agent silently deciding on their behalf.                                               |
| Continue | Appropriate checkpoint/new-run operation, `documents_edit`, `tasks_list`, `tasks_update`, `projects_checkpoint`, `inbox_update` | The answer changes the brief; preparation tasks complete with output links; future build work remains unfinished. |
| Finish   | `documents_export`, `preview_reveal`, `activity_list`, `review_list`, `activity_navigate`                                       | Current PDF, actual recorded changes, durable handoff.                                                            |

Use the semantic tools for Office work. A raw text write with a `.docx` extension is not an Office document. A Terminal scene should show a genuinely useful search or transformation, not decorative shell output. Long commands use `terminal_start`/`terminal_wait`; output is final, not streamed.

## App coverage and what to leave out

| App               | Role in the film                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Finder            | Establish the shared sources and resulting files.                                                            |
| Notepad           | Read an original interview opened from a finding.                                                            |
| Terminal          | Show source inspection and a useful cross-file operation.                                                    |
| Sheets            | Editable analysis and a linked chart.                                                                        |
| App Studio        | A short, memorable searchable-evidence result. Describe it as an explorer, not arbitrary generated software. |
| Canvas            | A simple editable delivery plan feeding the report.                                                          |
| Documents         | The main tangible deliverable.                                                                               |
| Preview           | Final PDF and optional source inspection.                                                                    |
| Projects          | The human decision and saved continuation context.                                                           |
| Tasks             | Show real completed preparation and remaining work.                                                          |
| Activity / Review | Short proof that changes can be inspected. Record recovery separately as optional coverage.                  |
| Home              | Brief setup/context; no settings tour.                                                                       |
| Inbox             | Source/request intake at the beginning, linked results at the end.                                           |
| Shortcuts         | Optional pickup showing a reusable procedure; preparation does not run an agent.                             |
| Calculator        | Optional utility pickup, not part of the two-minute narrative.                                               |
| Wallpapers        | Art direction only; do not spend story time switching themes.                                                |
| Workspace packs   | Useful for recording checkpoints and optional backup coverage, not a main plot point.                        |

If the cut feels crowded, shorten Home/Inbox setup and move Shortcuts, recovery, and packs to supplemental footage. Next, shorten the explorer/Canvas inserts. Protect the readable tool-to-result moment, editable report, and human decision. Do not solve pacing by making every app unreadably fast.

## Recording approach

Use one continuous master recording per coherent pass, with chapter timestamps. Broad exploratory testing comes before the clean take. Keep an untouched master and record pickups separately; do not keep rehearsing accidental errors inside the only master take.

Capture the native Codex tool activity and the real DeskInTab browser in the same desktop recording. A browser-only recording misses the requested Codex evidence. Use a dedicated clean recording region; avoid personal desktop content. Target a 16:9 master at 2560×1440 or higher if the machine records smoothly, then deliver 1920×1080 at 30 fps. Prefer a stable, readable 1080p capture over a stuttering high-resolution one.

Use the split view to establish trust, then crop into the relevant app or tool result. The desktop normally gets roughly two thirds of the picture; a cropped tool card can appear briefly for important actions. Do not leave two tiny unreadable interfaces on screen for two minutes.

For each useful action capture:

1. Two or three seconds of the before state.
2. The real tool invocation and completion.
3. The visible result, held long enough to read.
4. A concise capture-log entry with clip name, timestamp, tool, affected file, and verification result.

Remove waits and repeated reads in the edit. Keep several clear tool-call/result pairs at normal speed. Label accelerated passages “Sped up” or use an opening note such as “Recorded workflow, edited for time.” Preserve causal order when combining shots.

## Animated prompts and honest continuity

The user's suggested prompt animation is useful. Use it as editorial context, not a fake Codex transcript. Match the actual instructions used for that take. If wording is condensed, present a clearly designed “Request” card rather than pretending it is a captured native chat message.

Main request:

> Review the Harbor interviews. Recommend the first release, with an editable analysis, feedback explorer, and short brief. Save the work and ask me about anything that needs a decision.

Optional short chapter cards:

- “Show the evidence behind the recommendation.”
- “Turn the findings into a release brief.”
- “Offline reading first. Put search next.”

These should represent instructions actually supplied or authorized for the recording, not claim independent prompts happened when they did not. Prefer one main request and one human answer; five separate requests would fragment the story.

Most capture can happen in this main task. Reading the saved brief again here proves persistence/readback, not independence from the earlier conversation. The default script therefore says the work is ready for the next session. To strengthen this into an actual fresh-agent demonstration, record a separate session that receives only the project path and reads the saved brief/evidence. Do not substitute a page reload or a renamed agent label for that test. Creating that separate Codex task is a later user-directed step.

## Remotion edit

Keep production files separate from the Svelte application's dependencies. Once recording starts, use a small dedicated Remotion project with named scenes and a simple clip manifest containing source file, in/out frames, crop, caption, and actual capture timestamp.

- Use the real footage for all app behavior and tool results.
- Use Remotion for trim timing, controlled crops/zooms, request cards, short labels, captions, and voiceover synchronization.
- Use Studio WebMCP for inspection and review: select a composition, seek to a frame, inspect sequences/selection/geometry, and check errors. Perform source edits for changes not exposed as tools.
- Preserve the desktop's dark chrome, warm wallpaper palette, whitespace, and restrained motion. No spinning windows, stock robot imagery, fake progress, or typing animation on top of every action.
- Keep on-screen labels short: “Shared files,” “Editable workbook,” “Your decision,” “Saved handoff.” Do not turn the film into a schema tutorial.
- Fit voiceover after a rough picture edit, then trim to the actual voice delivery. Create accurate captions from the final take and keep them away from the UI evidence.
- Use silence or very quiet original/licensed instrumental music. No need for a sound effect on every tool call.
- Review the export at normal laptop size and at reduced playback size, with and without audio. Check that the request, recommendation, human answer, and changed result are all understandable.

## Claims to keep precise

- Files persist locally in this browser. Do not imply cloud sync or that agent-read data never reaches its provider.
- A live chart recalculates in Sheets. An exported chart or Canvas PNG embedded in a report is a snapshot; later source edits require a new export/insertion.
- Projects records checkpoints and answers. It does not launch an agent, schedule work, or automatically synchronize Tasks.
- Studio creates configured data explorers, not arbitrary executable apps.
- Activity is a record of actions; a saved checkpoint is agent-reported, not independent proof of correctness.
- No claim that every native Office feature or every tool was tested during this planning pass.

## Production handoff

1. Resolve and verify the native WebMCP recording blocker.
2. Prepare and rehearse the fictional Harbor source-to-decision workflow.
3. Capture master footage and optional pickups in the main task.
4. Assemble a silent/timing rough cut with the draft narration as reference.
5. The user records the voiceover in docs/submission-video-voiceover.md and the human Answer interaction.
6. Edit to the actual voice, add captions, inspect the Remotion preview, and render the two-minute MP4 when requested.
7. Obtain final user approval before public upload or submission. The published video must have audio and be public on YouTube for this challenge.
