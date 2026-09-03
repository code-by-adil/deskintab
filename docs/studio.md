# App Studio

App Studio turns a JSON file into a saved, interactive explorer. People can search records, filter a field, switch between cards and a table, and open selected source files. Agents create and update the same app through WebMCP.

The app definition and its data are ordinary workspace files. A fresh agent can read them, add records, adjust the selected fields, and leave an application the person can use again. Workspace export includes these files.

## Try it

1. Open **App Studio** from the dock.
2. Choose **Try the Feedback Explorer**. This creates a sample app, four fictional interview records, and their source notes under `/Applications/Feedback Explorer/`.
3. Filter **Feature** to **Offline reading**. Search for a phrase or change **View** to **Table**.
4. Choose **Open source** to open the original notes in Notepad.
5. In Studio, choose **Files** and open the data file. Edit a record and save it.
6. Return to Studio and choose **Reload data**. The saved app uses the changed records.

Opening Studio and listing applications never create sample content. Creating another sample chooses a new folder without replacing an earlier one.

## Create an app with your own files

Save a JSON array in the workspace, then choose **New app**. Specify the data file and the fields to display. Each selected field must contain text, a finite number, a boolean, or null. Missing values appear empty. Other fields remain in the data file and are not sent to the preview.

For example, `/Documents/feedback.json` could contain:

```json
[
	{
		"title": "Keep articles for a flight",
		"feature": "Offline reading",
		"quote": "I need the saved article to work on a plane.",
		"source": "/Documents/Interviews.md"
	}
]
```

The corresponding `/Applications/Reader feedback/Reader feedback.app.json` is:

```json
{
	"format": "webmcp-app",
	"version": 1,
	"title": "Reader feedback",
	"description": "Find recurring requests and read the supporting quotes.",
	"view": "cards",
	"dataPath": "/Documents/feedback.json",
	"columns": [
		{ "key": "title", "label": "Finding" },
		{ "key": "feature", "label": "Feature" },
		{ "key": "quote", "label": "Quote" }
	],
	"titleField": "title",
	"filterField": "feature",
	"sourceField": "source",
	"sourcePaths": ["/Documents/Interviews.md"]
}
```

`titleField` and `filterField` refer to displayed columns. `filterField` may be null. Set `sourceField` to null and `sourcePaths` to an empty array if the app has no source links. Source paths must be selected explicitly; a path merely appearing in the dataset does not grant permission to open it. Missing and unselected source buttons are disabled.

The settings form writes columns as `field: Label`, one per line. Field names begin with a letter and may contain letters, numbers, spaces, underscores, and hyphens. Labels must fit on one line. App definitions support up to 12 columns, 100 source paths, and 64 KB. Data files support up to 1,000 records and 512 KB, with up to 12,000 characters in each selected text cell.

## Agent tools

| Tool            | Behavior                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `studio_list`   | Find up to 100 saved `.app.json` files; report malformed manifests without replacing them.              |
| `studio_read`   | Read the current or named manifest, revision, source availability, data revision, and row count.        |
| `studio_create` | Validate an existing data file, save a new app manifest, and open it.                                   |
| `studio_update` | Change app settings with `expectedRevision` from `studio_read`. Arrays replace their previous contents. |
| `studio_open`   | Open a saved app with the latest data and remember the selection.                                       |

`studio_create` accepts the fields in the example above, plus `path`, and omits the file-only `format` and `version` fields. All other fields are required, including nullable fields and an empty `sourcePaths` when unused. `studio_update` accepts `path`, `expectedRevision`, and a nonempty `changes` object containing only the settings to replace.

Use `files_write` to prepare or change the JSON dataset. App edits and data edits use the existing workspace revision checks and Review versions. Unsaved human app settings prevent an agent from updating that manifest. A direct file edit makes an open settings draft stale, so it cannot overwrite the new file. Closing or navigating away from a dirty settings form preserves the existing desktop draft guard behavior.

## Preview boundary

App definitions select a fixed renderer, layout, labels, fields, and workspace data. They do not accept executable JavaScript, HTML, CSS, plugins, network addresses, or arbitrary commands.

The preview uses an iframe with `sandbox="allow-scripts"` and an opaque origin. A nonce-based Content Security Policy allows only the application's fixed renderer and stylesheet and blocks network requests, other scripts, images, nested frames, workers, and forms. Data is serialized with escaped `<` characters and rendered with `textContent`.

The only message accepted from the preview asks the desktop to open a selected source file. The host checks the exact iframe window, opaque origin, current preview token, exact message shape, and selected existing path. It provides no file-writing, tool-execution, or general workspace-reading bridge. Source file contents are never included in the preview unless they are independently the selected dataset.

These restrictions depend on keeping the renderer fixed. An iframe sandbox permits a document to navigate itself, so a CSP with `connect-src 'none'` alone would not establish a no-network boundary for arbitrary supplied JavaScript. The implementation therefore uses declarative app files. See [WHATWG sandboxing rules](https://html.spec.whatwg.org/multipage/browsers.html#sandboxing), [MDN iframe documentation](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe), [MDN CSP nonce guidance](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP#nonces), and [MDN postMessage security guidance](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage#security_concerns).

## Implementation

- `src/lib/studio/studio.ts`: strict manifest/data validation, shared file services, discovery, revision checks, sample creation, and preview snapshots.
- `src/lib/studio/renderer.ts`: fixed renderer, safe serialization, and the source-message validator.
- `src/lib/studio/tools.ts`: semantic WebMCP tools.
- `src/components/apps/Studio/Studio.svelte`: app library, preview, settings, source files, and draft guards.
- `tests/studio.spec.ts`: visible filtering, source opening, data reload, persistence, revision/draft guards, malformed data, and preview isolation.

The current app views are read-only. Changing the temporary search, filter, or view does not change the saved default. Studio does not install software into a coding harness, run an agent, or continue work after the browser desktop closes.
