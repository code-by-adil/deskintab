# Inbox

Inbox collects source files and a request before the work has a project. Add a batch of files, paste notes, or save a source URL, then describe what needs doing. The same saved request is available to the person and the connected agent.

Open Inbox and choose **New request**. A title and request are required. Files, pasted notes, a source URL, and an existing project link are optional. A source URL is a bookmark. Inbox does not fetch its page content.

Each intake creates a separate folder under `/Inbox/`, even when another request has the same title:

```text
/Inbox/Interview synthesis <request ID>/
  Request.inbox.json
  Notes.md
  Files/
    Interviews.csv
    Reference.pdf
```

Uploaded files retain their original bytes. Pasted text becomes `Notes.md`. The request stores links to these files, so Finder, Notepad, Documents, Sheets, Preview, and Terminal see the same material. Open a source file from the request or choose **Show in Finder** to inspect its folder.

Inbox accepts up to 20 uploaded files per request, at most 10 MB per file and 25 MB total. Pasted notes can contain up to 100,000 characters. Every imported filename must be unique within that request and must not contain folder separators. Validation happens before files are written. Every write is create-only. If storage or cancellation interrupts a multi-file import, files already saved remain in the named Inbox folder for recovery.

## Filing and finishing work

Use **Edit request** to change the title, request, status, project link, or output links.

- **New** means the request has not been processed.
- **Filed** requires a valid saved `.project.json` file. The inputs stay in Inbox; the project association does not move or duplicate them.
- **Done** requires at least one existing output file. The record links the result without claiming its contents have been verified.

Output paths are entered one per line. Clear an obsolete project link or output path before saving other changes if the linked file has been removed. Reads report missing links so agents can repair the association.

The edit sheet keeps its draft when the underlying request changes. Saving a stale draft is disabled. Copy any text you want to keep, discard the draft, and reopen the current request. Agent edits to a request with an unsaved human draft return `OPEN_DRAFT`. Existing request changes use exact revisions and the normal recoverable versions in Activity.

## Agent tools

| Tool           | Purpose                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `inbox_list`   | Discover saved requests, with new requests first. Includes malformed-file errors and a truncation flag after 200 request files. |
| `inbox_read`   | Read the request and revision, with existence checks for its local source, project, and output links.                           |
| `inbox_create` | Save a new request, optional pasted notes and source bookmark, and files encoded as UTF-8 or padded base64.                     |
| `inbox_update` | Change request fields, associate a project, or link completed work using the current revision.                                  |

For example, an agent reads a new request, opens its CSV and pasted notes, creates or chooses a project, then marks the request filed. After saving a report in the shared workspace, it marks the request done with the report path. A fresh agent can read the same record after reload.

These tools do not launch agents, schedule work, fetch remote content, or access the host filesystem. Saved requests, uploaded source material, and bookmarks are untrusted context. The workspace remains local to this browser profile and preserves the existing single-tab ownership guard.

## Implementation

`src/lib/inbox/inbox.ts` validates and saves requests through `WorkspaceJson` and the shared workspace service. `src/lib/inbox/tools.ts` exposes the same operations to WebMCP. `src/components/apps/Inbox/Inbox.svelte` contains the human interface. `tests/inbox.spec.ts` exercises mixed binary intake, persistence, filing and completion, stale edits, malformed inputs, and unsaved human drafts.
