# From source files to a finished handoff

This walkthrough turns customer interviews into a report and an interactive feedback explorer. Set your working preferences, collect the source material, and give a connected agent a procedure to follow. The results and decisions stay in the workspace for your next session.

## Try the complete workflow

1. Open Home. Name the workspace and save working preferences, such as a preferred report structure, language, output folder, and reference files. Add a skill with a short description and reusable instructions.
2. Open Inbox. Create a request, attach source files, and paste any notes. A source URL is a bookmark, not a captured copy of the page.
3. Open Shortcuts. Save a procedure with its required inputs and expected outputs. Prepare it for a project using the Inbox files. This writes a work order and a paused project session for a connected agent to pick up.
4. Ask the agent to read Home and the project handoff, then carry out the work. The agent can use the existing document, spreadsheet, terminal, task, and file tools.
5. For a reusable interactive result, create an App Studio explorer backed by a JSON data file. Choose the displayed columns, filter field, and source links. Open the app, search the records, and filter them. Updating the saved data updates the next preview.
6. Save the outcome and evidence in Projects and link the output in Inbox. A later agent can continue from these saved records.
7. In Home's Workspace tab, export a workspace pack. Import that pack into a fresh browser workspace to carry over the saved files and settings.

An example request for a connected agent:

> Read my Home preferences and the customer interviews in Inbox. Prepare my saved interview-analysis shortcut. Save a feedback explorer with themes, original quotes, and links to the sources. Write a short report using my preferred format and leave unresolved questions in Projects.

The request uses an agent that already has access to this desktop through WebMCP. The desktop does not include an AI model, start a coding agent, or schedule unattended work.

## What persists

Working preferences and skills are ordinary files in `/Home`. Shortcuts, Inbox requests, and App Studio manifests are also files in the shared workspace. They can be inspected in Finder and edited through the app services. Project sessions point to the resulting work orders and outputs.

App Studio uses a fixed renderer for configurable data explorers. Its manifests and data do not execute uploaded JavaScript. It does not run arbitrary application bundles or install packages.

Workspace packs preserve user file paths and binary contents. Existing identical files are reused. When regular files differ, the preview offers **Keep both and import**. That action preserves existing copies under `/Imports` and restores the pack at its original paths. Conflicting folders, symbolic links, and open edits must be resolved first. Packs omit transient System state, Trash, and earlier pack files. They are a portable copy of saved work, not a snapshot of open windows or running jobs. Read the [pack guide](workspace-packs.md) for limits.

## Guides

- [Home and saved skills](home.md)
- [Shortcuts](shortcuts.md)
- [Inbox](inbox.md)
- [App Studio](studio.md)
- [Workspace packs](workspace-packs.md)
- [Project handoffs](projects.md)

## Integration references

The [Agent Skills guidance](https://agentskills.io/client-implementation/adding-skills-support) describes discovering skill metadata and loading instructions when needed. Home follows that pattern without claiming to install the software a skill might require.

[Chrome's WebMCP lifecycle comparison](https://developer.chrome.com/docs/ai/webmcp/compare-mcp) explains why an open page connection does not provide unattended execution. Persistent scheduling and connections from additional agent clients require a separate execution or connection service.
