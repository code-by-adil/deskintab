# Home and saved skills

Home gives your agent a starting point for each session. Save how you want work written, the references it should use, and where results belong. Toolbox holds reusable skill instructions. Both save ordinary workspace files that you can inspect in Finder and include in a workspace pack.

The Preferences tab edits `/Home/profile.json`. It stores the workspace name, working instructions, language, time zone, default output folder, reference paths, and preferred skill paths. Project context and the current user request can refine these defaults. Opening Home or reading its context does not create the profile. The first deliberate save does.

Toolbox stores reusable instructions in `/Home/Skills/<name>/SKILL.md`. Each skill has a lowercase name, a description explaining when to use it, and Markdown instructions. Put links to supporting files or source URLs in the instructions. Home writes compatible single-line `name` and `description` YAML frontmatter with quoted values. The reader accepts simple unquoted, single-quoted, or JSON-quoted values. Multiline YAML metadata is not supported; the full procedure belongs in the Markdown body.

Saving a skill does not install software, connect an MCP server, or start an agent. Skills can refer to capabilities an agent has elsewhere. The agent must establish that those capabilities are available before using them.

## Agent workflow

1. Call `home_get_context` to read the working preferences and a compact skills catalog. The result contains `briefText`, `profile`, `skills`, and warnings. A missing profile has `exists: false` and `revision: null`.
2. Call `home_read_skill` for the instruction file relevant to the task. The catalog does not load every skill body into the brief.
3. Use the saved reference files, output folder, and working instructions where relevant. Missing references produce warnings rather than disappearing from the saved preferences.
4. To update preferences, supply all preference fields and the last profile revision to `home_save_preferences`. To save a skill, use `home_save_skill` with its last revision. Supply `null` only when creating a file.

`home_list_skills` returns at most 100 skills and reports malformed files. The orientation brief includes up to 20 skills, with preferred paths first, and reports omitted entries. Instruction files stay readable through Files or Notepad.

## Editing and recovery

Human drafts keep their original revision. An agent cannot replace the same file while Home has unsaved changes. Changes made elsewhere leave the Home draft intact and require a fresh read before saving. Saving uses the shared workspace mutation queue and checks the revision immediately before the write.

Malformed profiles and skills are never silently replaced. Home reports the problem; Files and Notepad can repair the original file, and Activity can restore a saved version. Read-only context discovery continues with warnings if the profile is malformed.

Workspace pack export includes these files. Importing a pack into a fresh desktop does not conflict with automatically generated Home defaults because there are none.

The skill file format follows the [Agent Skills specification](https://agentskills.io/specification). Home provides local instruction storage and discovery. It does not implement agent execution or automatic skill installation into another application.
