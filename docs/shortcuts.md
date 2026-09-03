# Shortcuts

Shortcuts saves procedures that a person or agent can use again. Each `.shortcut.json` file contains a title, description, procedure, input checklist, template and source paths, and expected output. New shortcuts default to `/Shortcuts`. Finder and Terminal can inspect the same ordinary files.

Open Shortcuts, choose **New shortcut**, describe the procedure, and save it. Use **Prepare work** when there is new material to process. Choose an existing project or create one, supply input files or notes, and choose a new Markdown work-order path.

Preparation saves a copy of the procedure, the supplied input links and notes, the input checklist, and the current Home brief in that Markdown file. It then adds one paused work session to the project. Every step is pending. The project links to both the work order and the reusable shortcut, so a fresh agent can find the request through `projects_read`.

No agent starts when preparation finishes. The result offers **Open work order**, **Open project**, and **Copy project brief**. Give the brief to an agent, which can start a new reported session based on the prepared run. Updating the shortcut or Home later does not rewrite an earlier work order.

## Agent tools

| Tool                | Purpose                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| `shortcuts_list`    | Find up to 100 saved shortcuts and report malformed files. Does not create files.  |
| `shortcuts_read`    | Read the full procedure, revision, and source-file existence.                      |
| `shortcuts_create`  | Save a new shortcut without replacing an existing file.                            |
| `shortcuts_update`  | Revise fields using the exact current revision. Arrays replace their saved values. |
| `shortcuts_prepare` | Save a work order and append a paused project session.                             |

`shortcuts_prepare` takes the shortcut `path` and `expectedRevision`, a `projectPath`, `inputPaths`, `inputText`, and `workOrderPath`. For an existing project, supply `projectRevision` from `projects_read`. To create a project at that path, supply `newProject` with `title`, `objective`, and optional `context` instead.

The result includes `status: "prepared"`, `workOrderPath`, `projectPath`, `runId`, `projectRevision`, and `briefText`. It does not claim execution. The existing project must have no working or waiting run and fewer than 100 saved sessions.

## Validation and recovery

Template and input links must point to existing workspace files outside System and Trash. A shortcut with required inputs needs at least one file or nonempty input notes. The checklist remains descriptive: the agent must verify that the supplied material actually satisfies it.

Edits require the saved revision. Agent edits cannot replace a shortcut with unsaved human edits, and preparing work cannot overwrite an open project draft. Malformed shortcut files stay untouched and appear as warnings in the list. Source files that disappear remain visible as missing in `shortcuts_read`; preparation rejects those links.

Work orders use a new path and never overwrite earlier results. Preparation writes the work order before linking it into the project. If the project changes during those writes, the error reports the saved work-order path. Read that file and the current project before retrying. File changes use the workspace's existing saved versions and Activity recovery.

Shortcuts are instructions, not installed software. They cannot install an MCP server, add an execution runtime, or schedule unattended work. All files remain in the current browser workspace and can travel through workspace packs.
