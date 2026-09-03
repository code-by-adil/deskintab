# Activity and Review

Activity records human and agent actions with links to their results. Review stores file versions and work summaries, and restores saved contents after checking for newer edits. The UI and WebMCP call the same TypeScript services.

## Human workflow

1. Open Activity from the dock. Paths open their real app; **Review change** opens the corresponding saved version.
2. In **Review**, inspect recent changes or a work summary. Text changes show removed/added lines. Binary documents show metadata; restore a copy and open it in Documents, Sheets, or Preview to inspect its contents.
3. **Restore Previous Version** checks that the original is still at that saved version, then asks for an inline confirmation. The replacement itself gets a recovery version, so it can be reviewed and reversed.
4. If the file changed, moved, disappeared, or has an unresolved draft, choose **Restore as Copy**. It never replaces an existing destination. The original extension is retained.
5. **New Summary** groups chosen changes, linked result paths, optional activity records, an outcome, and unresolved questions. The person or agent writing a summary chooses what it says and which changes it includes. **Edit Summary** uses a session revision check.

Notepad drafts are protected. A file loaded in Writer or Calc must be closed before in-place restoration, even if the parent UI currently says it is clean: the office worker may still have a queued keystroke. Restore-as-copy works without closing it. Ordinary file inspection or opening results never silently discards a draft.

Task and Canvas saves show a "What changed" summary above the restore controls. "Raw file changes" expands the underlying JSON diff. `desktop_get_context` reports the currently selected version or summary ID, the Activity/Review tab, and whether a summary form is open. Closed or minimized windows do not expose a selection.

## Agent workflow

- `review_list({path?,limit?})` discovers versions, work summaries, warnings, and retention limits. The optional path filters versions exactly, not summaries. Default 30, maximum 100 versions.
- `review_read({versionId,includeRawDiff?})` returns a saved change, `current.token`, `canRestore`, the blocking reason, and a suggested copy path. Task and Canvas files include `semantic` changes with stable IDs, changed fields, and plain-language summaries. These are computed from the saved files. Up to 100 changes are returned with `total` and `truncated`. Editor version counters and timestamps are ignored. Set `includeRawDiff:true` for the raw JSON diff as well. Other text files retain line diffs; binary files return metadata. This read does not alter the source file.
- `review_restore({versionId,mode,side?,destination?,expectedCurrentToken?})` restores actual bytes. `mode: "replace"` requires the current token and restores only the previous file. `mode: "copy"` requires a new destination; choose `side: "before"` or `"after"`. Copies retain the original extension. The default side is `before`; new-file versions only have `after`.
- `review_session({id?,expectedRevision?,title,status,summary,questions?,results?,versionIds?,activityIds?})` creates or updates a work summary. `status` is `working` or `completed`. Updates require the current integer revision and replace all lists. Obtain activity IDs through `activity_list`; normal file-tool saves return `entry.versionId`, and all captured saves are discoverable through `review_list`.

Example sequence:

```text
review_session({ title: "Prepare launch handoff", status: "working", summary: "" })
files_read / files_patch / documents_edit / sheets_edit
review_list({ limit: 30 })
activity_list({ limit: 30 })
review_session({
  id: <started session ID>, expectedRevision: 1,
  title: "Prepare launch handoff", status: "completed",
  summary: "Revised the report and prepared the budget for review.",
  results: ["/Documents/Report.odt", "/Documents/Budget.ods"],
  versionIds: [<explicit IDs of changes made for this work>],
  activityIds: [<explicit relevant activity IDs>],
  questions: ["Who approves the budget?", "Who owns delivery?"]
})
desktop_reveal({ target: "activity" })
```

A summary includes only the IDs its author supplies. It does not automatically collect intervening human or agent work. Activity included in a summary is copied into its durable record, so the short activity feed can roll over without losing that context.

## What can be restored

Recovery captures contents when files are saved. Earlier Activity descriptions do not contain recoverable file bytes. `writeText`, `patchText`, and `writeBytes` retain snapshots for Notepad, file tools, Writer, Calc, imports, and exports. No-op content writes do not create duplicate versions. New files retain their saved result but have no previous file to restore.

Raw Bash writes, move/copy/trash/delete operations, directory changes, and other command side effects do not create restorable file versions. A `docs` command can capture a file version because it saves through the Office service. Restoring that file does not reverse other effects of the command. To recover a trashed file, move it out of Trash with `files_move`.

Before mutating a supported file, recovery saves its prior and intended next bytes. A preparation failure stops the save without replacing the source. The journal marks the version saved after the write. If finalization fails, the successful file save returns `recoveryWarning` rather than a misleading failed mutation; an unconfirmed record can only be recovered as a copy. Snapshots are verified against SHA-256 digests before use.

In-place restoration checks the after-content digest, inode identity, modification time, supplied current token, and open-draft guards inside the shared mutation queue. ZenFS updates ctime on reads, so ctime is deliberately not used as a write token. These checks serialize against the existing terminal adapter and application writes in the same page. These checks apply within one page. They do not coordinate writes across tabs or protect history from tampering.

## Storage and bounds

- `/System/review/versions/<uuid>/version.json`, `before.bin`, and `after.bin` hold recovery data in the existing filesystem.
- `/System/review/sessions/<uuid>.json` holds work summaries. Updates stage a temporary file and rename it into place.
- System/Trash writes are excluded from capture. Journal internals are excluded from recursive workspace indexing/search so old bytes are not mistaken for current project content.
- Each snapshot side is limited to **5 MiB** for ordinary files and **20 MB** for `.excalidraw` and `.canvas.json`, matching Canvas's full scene limit. Only ordinary unlinked files support in-place recovery. Larger or aliased saves report when recovery contents were not captured. Existing records without snapshot bytes cannot gain recovery retroactively.
- Confirmed history rolls at **100 versions or 64 MiB of snapshot bytes**, whichever is reached first. Oldest confirmed snapshots expire automatically. Session links to expired versions display as unavailable; result paths and summaries remain. Unconfirmed/corrupt records are left untouched for inspection rather than silently purged.
- Up to **60 work summaries**, **50 items per list**, **120 title characters**, **4,000 summary characters**, and **200 KB serialized metadata per summary**. Existing summaries can be updated at the session limit.
- Text comparison is bounded to 100,000 combined characters and a one-million-cell line-diff matrix. Larger comparisons return labeled before/after excerpts, up to 20,000 characters each. The UI displays at most 500 diff lines and reports clipping. Restoration always uses complete snapshot bytes.

Activity keeps its latest 120 entries in localStorage. Work summaries and file snapshots persist separately in ZenFS.

## Verification

`tests/review.spec.ts` exercises the registered tool callbacks against the real browser filesystem: text and binary restore, later terminal changes, concurrent restoration, reload persistence, summary membership and revisions, corrupted snapshots, missing originals, draft protection, storage failure, cancellation, rolling retention, and large-diff bounds. A real Writer/Calc round trip verifies saved document text, workbook formulas, and values after restoration. UI tests also cover direct Activity links, human summary editing, restore confirmation, copy restoration, and compact viewports.

Implementation references: [ZenFS core](https://github.com/zen-fs/core), [Chrome imperative WebMCP API](https://developer.chrome.com/docs/ai/webmcp/imperative-api), and current Svelte documentation through the Svelte MCP and Context7.
