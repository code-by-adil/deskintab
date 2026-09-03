# Release review

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
| `public/app-icons/`, `public/cursors/`, `public/favicon.ico`                         | Remove unused files and document the rights to the assets still used by the app.                                                                                     |
| Apple icons in `src/components/TopBar/MenuBar.svelte` and `src/components/Desktop/BootupScreen.svelte` | Replace with project branding or establish permission for this use.                                                                                                  |
| `public/sounds/mac-startup-sound.mp3`                                                                  | Replace or remove the sound and its startup, prefetch, and precache references unless permission is established.                                                     |
| `public/cover-image.png`                                                                               | Replace the current cover with an accurate screenshot of this project after the media review. It is currently included in the precache list.                         |
| `docs/references/desktop-reference.png`                                                                | Keep the visual reference for development, but review its redistribution rights before publishing the repository.                                                    |
| Office and Canvas distribution                                                                         | Keep their notices and license texts. Verify that upstream source links resolve to the shipped runtime and that separately copied fonts retain the required notices. |
| `wrangler.jsonc`                                                                                       | Confirm the deployment target. The configured name is `webmcp-desktop`. Confirm that this is the intended destination before deploying.                              |

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
