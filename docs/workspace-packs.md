# Workspace packs

Home can export saved workspace files into one `.desktop-pack.json` download. The pack also stays in `/Exports`, where Finder and agent tools can inspect or download it. Import a pack through Home, or upload it into the workspace and call `packs_inspect` followed by `packs_import`.

Packs preserve exact file paths, binary file bytes, and empty folders. This includes saved Home preferences, shortcuts, Inbox files, Projects, and Studio applications. The export runs inside the same mutation queue as normal file writes, so another app cannot change a file halfway through the snapshot.

The export leaves out `/System`, `/Trash`, and any item ending in `.desktop-pack.json`. This excludes recovery history, system seed markers, and previous exports. Open drafts, running terminal jobs, window positions, and other page or browser state are not saved files and are not included. Save drafts before exporting. A pack is a copy of the saved user workspace, not a browser backup or cloud sync.

## Import behavior

Home previews file and folder counts, total decoded bytes, identical existing files, and conflicting paths before showing the import action. Import checks the entire manifest and rechecks the workspace inside the mutation queue before creating anything.

Existing directories merge. Existing files with exactly the same bytes are skipped. The default import stops before making changes if any existing path conflicts. Importing preferences or applications does not execute their content.

When every conflict is a different regular file, Home offers **Keep both and import**. This action moves each current file into `/Imports/Conflicts-<id>/<original-path>`, then restores the packed file at its original path. The result links to every preserved original. This also handles an edited Launch project imported into a fresh desktop that already contains the sample files. No original file is discarded.

Folders, symbolic links, and files where a parent folder is needed cannot be preserved automatically. Use **Show in Finder** to inspect an existing item, move it aside, then choose **Recheck pack**. Keep both also requires `/Imports` to be a regular folder or absent.

An unsaved app draft or a file loaded in Documents or Sheets blocks changes to that path. Save or discard the draft and close the office editor before rechecking. Import uses the same editor protection as Review and rechecks before moving an original or writing its replacement.

When a write fails, the service attempts to delete only files and folders that this import created, then restores any originals moved during Keep both. Folder cleanup is non-recursive. The result reports what was created, what was rolled back, which originals were restored, and any paths that still need inspection. A failure does not become a success merely because some files were written. As with other local operations, closing the page or losing power during the import can interrupt cleanup. Inspect the preserved paths in `/Imports` if the operation was interrupted.

## Format and limits

Version 1 is JSON with `format: "webmcp-desktop-pack"`, `version: 1`, a `createdAt` timestamp, `entries`, and an `omitted` declaration. Directory entries have `kind` and `path`. File entries also have `data`, containing canonical padded base64. Paths are normalized absolute workspace paths. Traversal, control characters, backslashes, duplicate paths, file-parent collisions, reserved paths, and nested packs are rejected.

The limits are 5,000 entries including implied parent folders, 32 MiB of decoded file data, and 48 MiB for the encoded JSON file. Symbolic links and other special filesystem items are unsupported and cause export to stop before saving a pack. Hard-linked regular files export as independent files with the same bytes. File modification times, permissions, and inode identities are not retained.

`packs_export` returns the saved path and counts. `packs_inspect` returns a preview without mutations, including `canImport` and `canPreserve`. `packs_import` accepts `conflictMode: "stop"` by default or `"preserve"` when the user wants both copies. Its result has `status` as `imported`, `blocked`, or `failed`, with created paths, skipped identical files, conflicts, rollback paths, remaining paths, `preservedFiles` mappings, and `restoredOriginals`. Blocked and failed tool results have `ok: false`. Agents must inspect this status before reporting completion.

The service uses the [ZenFS promises API](https://zenfs.dev/core/) and exclusive file handles for new imports. The human interface and WebMCP tools call the same service in `src/lib/packs/packs.ts`.
