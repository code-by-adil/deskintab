# Tasks

Tasks stores each list in a `.tasks.json` workspace file. People edit tasks in the list and inspector; agents use the same saved data through WebMCP. Markdown checklists remain separate.

Each task has a stable UUID, title, status of `todo`, `in-progress`, or `done`, optional calendar date, notes, and optional absolute `sourcePath` and `outputPath`. Opening a source or output link opens the file in its workspace app. Creation and changed links require existing files. If a linked file later moves or disappears, `tasks_list` reports its absence; the user can repair the link without losing the task. Links are not automatically rewritten on file moves.

## Human workflow

Open Tasks, or double-click a `.tasks.json` file in Finder. Use New List to choose its workspace path and title. New Task opens the inspector; Save Task commits the title, date, status, notes, and evidence links. Filters select All, To do, In progress, or Done. Open source and Open output inspect the referenced work.

The first app launch creates `/Documents/My tasks.tasks.json`. The last-opened path is checkpointed in `/System/tasks-session.json`. Saved content persists after reload; unsaved inspector drafts are session-local. Save before reloading the browser.

An agent can update saved tasks while a human inspector has a draft. The draft is retained, marked stale, and cannot overwrite the new version. Save or discard the draft before navigating to another task or closing the app. Review refuses in-place restoration over a pending inspector edit. Saving or deleting a task records a file version in [Review](review.md), subject to its retention limits.

## Tools

```js
// Create a list with its first evidence-linked task.
tasks_create({
	path: '/Projects/Launch/launch.tasks.json',
	listTitle: 'Launch plan',
	title: 'Prepare sponsor brief',
	status: 'in-progress',
	dueDate: '2026-09-04',
	sourcePath: '/Projects/Launch/meeting-notes.md',
});

tasks_list({ path: '/Projects/Launch/launch.tasks.json' });

// Use the returned ID and full list revision.
tasks_update({
	path: '/Projects/Launch/launch.tasks.json',
	id: '<task-id>',
	expectedRevision: '<revision-from-tasks_list>',
	changes: { status: 'done', outputPath: '/Documents/Sponsor brief.odt' },
});
```

`tasks_list` optionally filters by status and a case-insensitive title/notes query. It returns title, path, revision, and tasks with `sourceExists` / `outputExists`. An unset link has a null existence value. It does not create or open files. With no path, it reads the current list or the remembered list, even before Tasks opens after reload. If that file is missing, it returns `path:null`, `revision:null`, empty tasks, `missingPath`, and up to 100 `availableLists`. `listsTruncated` reports whether more lists exist. Supplying a missing path returns an error.

Use `desktop_get_context` to identify the task selected in the visible Tasks window. `context.tasks` reports the selected task ID, list revision, filters, and whether the inspector has a dirty or stale draft. Minimized and closed windows return null context. This read does not save the draft. Read `tasks_list` before changing saved data.

`tasks_create` requires `expectedRevision` when appending to an existing file. `tasks_update` accepts partial `changes`; null clears dates and links. `remove:true` deletes the identified task. Mutations return the saved `data`, task, revision, and workspace entry. Removal returns a null task.

## Format and bounds

```json
{
	"format": "webmcp-tasks",
	"version": 1,
	"title": "Launch plan",
	"tasks": []
}
```

Maximum 250 tasks and 1 MB per file. List titles allow 120 characters; task titles 200; notes 5,000. Due dates must be real `YYYY-MM-DD` calendar dates, not timestamps. The service generates `createdAt` and `updatedAt` timestamps. Unsupported/malformed JSON is reported without replacing the file; repair in Notepad or recover a prior version.

Calendar accounts, recurring schedules, notifications, task dependencies, and Markdown synchronization are unsupported.
