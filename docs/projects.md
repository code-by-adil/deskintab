# Projects

Projects keeps enough context for a person or a fresh agent session to continue unfinished work. Each project has a lasting objective and context, a history of reported work sessions, questions and answers, and links to the actual work. It saves all of this in one `.project.json` file in the shared workspace.

## On the desktop

Open Projects from the dock or open a `.project.json` file in Finder. The overview puts projects with unanswered decisions first. Create a project with a title and objective, then add context, references, or a link to an existing Tasks list. Opening the app does not create sample data.

The Handoff view shows the selected session's outcome, next action, evidence, and questions. Answer records your decision for the next agent. Work shows the ordered steps and checkpoint save time. Context holds facts and constraints that should outlive a session. Use the session selector to inspect earlier work, or Copy resume brief to take the latest saved context to another conversation.

Start work records an agent or person name, a session objective, and an ordered plan. Update checkpoint lets you revise the steps and save progress, a summary, the next action, evidence, and an optional question. References and evidence have separate target, label, and detail fields. Local links open in their matching desktop apps; external links open their URL.

Progress is reported by whoever saves the checkpoint. Answering the last question changes a waiting session to paused, ready to continue. It does not launch an agent or claim the previous agent has resumed. Projects does not run steps or send notifications.

## Agent workflow

Discover projects with `projects_list`, then read `projects_read` before changing one. Keep lasting guidance in `projects_update.changes.context`. Record current work through `projects_start` and `projects_checkpoint`. Start a fresh session from the latest saved run ID after the previous session is paused or complete.

All mutating tools open the saved project. Their structured result includes `path`, `revision`, `brief`, and the workspace `entry`, including a Review `versionId` or `recoveryWarning` when present. Start and checkpoint also return `run`; a checkpoint that asks a question returns `decision`; answer returns the saved `decision`. Read adds a plain Markdown `briefText`. The TypeScript service also returns the full parsed `data` for the UI. Tool reads omit that full run history.

| Tool                  | Required inputs                                                         | Optional inputs                                                                        |
| --------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `projects_list`       | None                                                                    | None                                                                                   |
| `projects_read`       | None                                                                    | `path`                                                                                 |
| `projects_create`     | `path`, `title`, `objective`                                            | `context`, `taskListPath`, `references`                                                |
| `projects_update`     | `path`, `expectedRevision`, `changes`                                   | Fields inside `changes`: `title`, `objective`, `context`, `taskListPath`, `references` |
| `projects_start`      | `path`, `expectedRevision`, `agent`, `objective`, `steps`               | `basedOn`, required when a previous run exists                                         |
| `projects_checkpoint` | `path`, `runId`, `expectedRevision`, plus at least one checkpoint field | `status`, `summary`, `nextAction`, `steps`, `evidence`, `decision`                     |
| `projects_answer`     | `path`, `decisionId`, `expectedRevision`, `answer`                      | None                                                                                   |

`references` and `evidence` are arrays of `{ label, target, detail }`, with all three fields strings. Creation and changed evidence require existing local files. Targets may also be HTTP or HTTPS URLs without credentials. Projects stores those URLs without fetching them. Reads add `exists: true` or `false` to local evidence and `exists: null` to external references. A moved or deleted file leaves a visible missing link; it does not erase the checkpoint.

`projects_start.steps` is an array of titles. The service generates stable step IDs, starts the first step, and leaves the rest pending. A checkpoint's `steps` replaces the ordered plan with `{ id, title, status }` records. Preserve IDs when editing existing steps. Step status is `pending`, `in-progress`, `done`, or `skipped`; at most one step may be in progress.

Run status is `working`, `waiting`, `paused`, or `completed`. A paused run needs a `nextAction`. A waiting run needs an unanswered decision. Completion requires an outcome in `summary`, every step done or skipped, and no unanswered decision belonging to that run. The checkpoint tool changes only the latest unfinished run. Use a new session to continue a completed run.

`decision` is `{ question, options? }`, with an optional array of suggested answers. Saving it sets the run to waiting. Answers may use free text and need not match an option. Record the user's supplied or authorized answer with `projects_answer`. Saved answers cannot be overwritten by that tool. Put changed guidance in project context or ask a new decision.

### Example handoff

The calls below use tool names as notation, not page-global JavaScript functions. Each variable holds the tool response's `structuredContent`. Replace the source path with a file that exists in the workspace.

```js
const created = projects_create({
	path: '/Projects/Launch/Reader.project.json',
	title: 'Reader launch',
	objective: 'Prepare the offline reader release plan.',
	context: 'Keep the first release local to this browser.',
});

const current = projects_read({ path: created.path });
const started = projects_start({
	path: current.path,
	expectedRevision: current.revision,
	agent: 'Agent A',
	objective: 'Inspect the notes and decide the retention policy.',
	steps: ['Read the notes', 'Apply the retention decision'],
});

const waiting = projects_checkpoint({
	path: started.path,
	runId: started.run.id,
	expectedRevision: started.revision,
	summary: 'Read the meeting notes. Retention still needs a decision.',
	nextAction: 'Update the release plan with the chosen retention policy.',
	steps: started.run.steps.map((step, index) => ({
		...step,
		status: index === 0 ? 'done' : 'pending',
	})),
	evidence: [
		{
			label: 'Meeting notes',
			target: '/Projects/Launch/meeting-notes.md',
			detail: 'Source for the release requirements.',
		},
	],
	decision: {
		question: 'When should saved articles expire?',
		options: ['After 30 days', 'Only when the user removes them'],
	},
});

// The user can answer in Projects, or authorize this tool call.
const answered = projects_answer({
	path: waiting.path,
	decisionId: waiting.decision.id,
	expectedRevision: waiting.revision,
	answer: 'Keep saved articles until the user removes them.',
});

// A fresh session needs only the project path, not the old conversation.
const handoff = projects_read({ path: '/Projects/Launch/Reader.project.json' });
const resumed = projects_start({
	path: handoff.path,
	expectedRevision: handoff.revision,
	agent: 'Agent B',
	objective: handoff.brief.latestRun.nextAction,
	basedOn: handoff.brief.latestRun.id,
	steps: ['Read the saved decision', 'Update the release plan'],
});
```

Agent B reads the linked source, edits the release plan through the appropriate file or document tools, then checkpoints the outcome with its output link. It can mark the new run completed once its steps are done. Tasks remain in their linked `.tasks.json` file; use `tasks_list` and `tasks_update` to read or change them. Projects does not copy or automatically synchronize task status.

A project-specific `AGENTS.md` instruction can say:

> At the start of substantial work, read the saved project brief at `/Projects/Launch/Reader.project.json`. Save a checkpoint when a milestone completes or a decision blocks progress. Before ending, record the result, evidence, and next action. Read saved decisions before continuing.

The agent still needs a supported browser connection to these WebMCP tools. The instruction itself does not establish that connection.

## Saved files and conflicts

`projects_read` without a path resolves the open or remembered project. It never creates a file; a missing project returns `PROJECT_NOT_FOUND` with a discovery hint. `projects_list` reports individual malformed files in `warnings` and continues listing valid projects. Unsupported JSON stays intact for repair in Notepad or recovery in Review.

Existing-project writes require a fresh SHA-256 `expectedRevision`. The service checks it within the same mutation queue as workspace writes. Competing saves return `FILE_CHANGED`; read again and adapt the edit. Agent writes to a project with an unsaved Projects form return `OPEN_DRAFT`. A file changed through another route leaves the human form visible and stale, with saving disabled until the user discards and reopens it. Forms are session-local, so save before reloading.

Projects uses `WorkspaceJson` for ordinary workspace saves. Activity records those saves and Review describes project, run, step, and decision changes. Review can restore a version to a new `.project.json` copy or to the original after checking its revision and pending edits. Recovery follows [Review's capture and retention limits](review.md). The last-opened project path is remembered in `/System/projects-session.json`; project context and history stay in the project file.

Each file allows up to 100 runs, 250 decisions, and 1 MB total. A run allows 40 steps and 40 evidence items; a project allows 40 references. Project context allows 12,000 characters, summaries 6,000, and answers 4,000. Writes that exceed a bound fail without dropping earlier history.

Discovery inspects up to 100 candidate project files and reports `truncated` when more exist. A resume brief includes the latest run, every open decision, the ten most recently answered decisions, and up to twenty linked tasks, with unfinished tasks first. `omittedDecisions` and `taskList.omittedTasks` report additional saved records. Older runs remain available in the session selector and the full project file.

The saved workspace belongs to this site in one browser profile. Reload preserves it; different browser profiles and devices have separate data. There is no backend or synchronization. One desktop tab opens the workspace at a time. A second tab asks you to close the first and reload before it can open the files. Agents can use the same open desktop through its WebMCP connection, or reopen it for a later session.

The tab guard uses a browser Web Lock before mounting IndexedDB. It prevents separate ZenFS instances from allocating conflicting file IDs. Agent names and verification claims are reported context, so inspect linked evidence when a result matters.
