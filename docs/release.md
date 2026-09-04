# Release review

## Current deployment: DeskInTab

Live at [deskintab.dgkhan08.workers.dev](https://deskintab.dgkhan08.workers.dev/), deployed on 4 September 2026. Worker: `deskintab`. Version: `c7848052-156b-42ab-a8fd-b47f36e110bd`.

The app title, install manifest, metadata, terminal, menus, sample workspace content, Canvas source metadata, package, and current documentation use DeskInTab. Historical entries below retain the names and version IDs used at the time. Existing user documents are not rewritten.

The previous Worker's production and preview URLs are disabled in Cloudflare. Its production address returns HTTP 404; the new address returns HTTP 200. The old Worker is retained for recovery, not public use. No custom domains or DNS records were changed. Deploy future updates with `wrangler deploy` using the checked-in `deskintab` configuration; deploying an old checkout could reactivate the retired address.

Validation: Svelte checks passed with zero errors or warnings; all three changed Svelte files passed the autofixer; changed code formatting and `git diff --check` passed. Production build and Wrangler dry run passed. Five selected Chromium tests passed: Calculator cold launch, desktop rendering, cross-app WebMCP workflow, compact desktop, and Writer editing and persistence. The full suite was not rerun. Existing bundler warnings remain.

Live verification confirmed the DeskInTab title, rendered desktop and terminal banner/prompt, with no captured browser warnings or errors. HTML, install manifest, service worker, and Office iframe HTML match the local build byte for byte and retain COOP/COEP headers. Native WebMCP invocation in Codex Browser still reports that the site's configuration exceeds supported limits; callback tests passing does not resolve that client limit.

The new origin has separate browser storage. Workspace packs are required to transfer existing work; disabling the previous URL does not migrate or erase its local IndexedDB data.

## Historical review

Reviewed on 3 September 2026. MIT licensing for the project's own work is in place. The media review remains open, so this is not a declaration that every bundled asset is ready for public distribution.

## Changes made

- Added Deskstead's MIT contributor notice and package license field. The publication snapshot also restores Puru Vijay's upstream MIT copyright notice and credits the inherited desktop foundation.
- Added production output for the project license, bundled dependency notices, and the Inter font license. Existing Office and Canvas notices remain intact.
- Rewrote the README and welcome note around the working apps, project handoffs, and browser-storage limits. New welcome text applies to new workspaces; existing user files are not overwritten.
- Removed `.github/FUNDING.yml`, an obsolete sponsorship configuration, and `public/google7cdade01e9ae4685.html`, an obsolete site-verification file.
- Removed `.gitpod.yml`, which used the old npm setup and port 3000. Kept the small StackBlitz config and changed its start command to pnpm.
- Added ignore rules for environment files, local variable variants, logs, and TypeScript build state.

## Resolve before publishing

| Item                                                                                                   | Action                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/assets/wallpapers/`                                                                               | Establish permission for each retained image or replace it. Names and file locations are not licensing evidence.                                                     |
| `public/app-icons/`, `public/cursors/`, `public/favicon.ico`                                           | Remove unused files and document the rights to the assets still used by the app.                                                                                     |
| Apple icons in `src/components/TopBar/MenuBar.svelte` and `src/components/Desktop/BootupScreen.svelte` | Replace with project branding or establish permission for this use.                                                                                                  |
| `public/sounds/mac-startup-sound.mp3`                                                                  | Replace or remove the sound and its startup, prefetch, and precache references unless permission is established.                                                     |
| `public/cover-image.png`                                                                               | Replace the current cover with an accurate screenshot of this project after the media review. It is currently included in the precache list.                         |
| `docs/references/desktop-reference.png`                                                                | Keep the visual reference for development, but review its redistribution rights before publishing the repository.                                                    |
| Office and Canvas distribution                                                                         | Keep their notices and license texts. Verify that upstream source links resolve to the shipped runtime and that separately copied fonts retain the required notices. |

The unused icon directories contain 106 files totaling 8.4 MiB. They include App Store, Calendar, Contacts, DevUtils, FaceTime, Keynote, Launchpad, Mail, Maps, Messages, Music, News, Photos, Podcasts, the unused social-link icon, Safari, TV, Ukraine, View Source, and VS Code. None is an installed desktop app. Check source references before deleting files; the System Preferences icon is still used by the update prompt.

The large public asset cleanup is left for a separate change. It should retain the current dock, wallpaper layout, and window styling. Deleting the artwork without replacements would break the working desktop.

## Keep in source, exclude generated output

Keep `LICENSE`, `THIRD_PARTY.md`, component notices, `pnpm-lock.yaml`, tests, and app guides in source control. They support attribution and reproducible development. The public repository starts from a source snapshot without the private development history. `AGENTS.md`, `.agents/`, `.codex/`, and `docs/references/` are excluded. Local development resources remain in the private development checkout.

`node_modules/`, `dist/`, prepared Office runtime files, copied Canvas fonts, test reports, and local deployment state are already ignored. They do not need to be deleted from the developer's machine to publish the source repository. The built site still needs its prepared Office runtime and Canvas fonts.

The source history audit found no environment files, private-key files, database dumps, or logs in the tracked-file inventory. TruffleHog reported no findings with credential verification disabled. A later common-token scan found no matches in 621 reachable text blobs or the pending copy changes. These scans reduce risk but do not guarantee that every possible secret is absent. Revoke any credential found in future reviews rather than just deleting its current file.

## Known verification results

An earlier source snapshot completed the full Chromium suite with 274 passing tests and two failures in `tests/office-startup.spec.ts`: creating a Writer document from PDF preview, and retrying a failed Writer launch from PDF preview. Both cases remained on `Preview.pdf` instead of showing `Untitled.odt` and failed again in a focused rerun. Those reports remain open.

After the Deskstead copy updates, type checking, formatting, and the production build passed. All 23 selected browser tests passed, covering the personal workspace workflow, Shortcuts, and App Studio. The report and project handoff also worked through WebMCP in the browser. The full suite was not rerun for these copy changes. The build still emits chunk-size and bundler deprecation warnings.

## Verify the release candidate

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
git diff --check
```

Inspect `dist/LICENSE`, `dist/licenses/dependencies.md`, `dist/licenses/INTER-OFL.txt`, and the Office and Canvas notices. Dependency reports can miss asset-specific obligations; review warnings and unknown licenses rather than assuming the report is a compliance certificate.

The initial generated report contains entries without license text for Radix UI packages, FastDom, Kerium, and react-remove-scroll-bar. Retrieve the notices for the pinned versions before distributing the build. Excalidraw also omits text from its npm package, but its MIT notice is already included in `public/excalidraw/NOTICE.md`. Khroma's package metadata omits its license identifier; its installed `license` file and generated report contain the MIT text.

Open the production preview, check the startup screen, and try the handoff workflow with a supported WebMCP connection. Download the output and confirm it survives a reload. Check the final hosting headers and preserve the workspace's origin when updating a deployment. A new origin has separate browser data.

The package is marked `private: true` to prevent accidental npm publication. It does not make the source repository private or change the MIT license. This project is released as source and a static website, not as an npm library.

## Cloudflare deployment — 3 September 2026

Deployed to [deskstead.dgkhan08.workers.dev](https://deskstead.dgkhan08.workers.dev/) using the `deskstead` Worker. `workers_dev` is explicitly enabled and `routes` is empty. No existing custom domains or DNS records were changed. Version: `c58971b6-dba5-459f-a7eb-5b0efb508994`.

For maintainers updating this deployment, run `wrangler deploy` while signed in to the deployment account. Wrangler builds the app and uploads `dist/`. Preserve `public/_headers` so Office receives its required cross-origin isolation headers. If deploying a separate copy, choose your own Worker name in `wrangler.jsonc` first.

The production build, Wrangler dry run, Svelte checks (zero errors or warnings), Wrangler configuration formatting, and `git diff --check` passed. Four selected Chromium tests passed: desktop rendering, the Files/Notepad/Terminal/Activity WebMCP workflow, real Writer editing and persistence, and the personal workspace transfer workflow. The full suite was not rerun for deployment.

Live verification confirmed the desktop renders and Writer opens a saved `Untitled.odt`. The root page and Office iframe return the required COOP/COEP headers. Office runtime chunks are available with immutable caching, while the entry page and service worker revalidate.

Native WebMCP verification in Codex Browser remains blocked: its tool discovery reports that the site's WebMCP configuration exceeds supported limits. The local callback tests passing does not resolve this client discovery failure. No tool schema or registration behavior was changed during deployment.

## Cloudflare redeployment — 4 September 2026

Redeployed the current local checkout to the same `deskstead.dgkhan08.workers.dev` address. Version: `3f4a5d01-f8dd-4710-83ed-74783cfd8769`. Cloudflare uploaded 27 changed assets and reused 869 existing assets. No custom domains or DNS records were changed.

The production build, Svelte checks, Wrangler configuration formatting, and the same four selected Chromium workflow tests passed. The live HTML, entry JavaScript, service worker, and Office iframe HTML matched the local build byte for byte, with the required COOP/COEP headers. The desktop loaded after refresh. Native WebMCP discovery still reports that the configuration exceeds Codex Browser's supported limits.
