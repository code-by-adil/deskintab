# Third-party notices

The root [MIT license](LICENSE) covers DeskInTab's original code and documentation. It does not replace the terms of dependencies, fonts, or third-party media.

## Desktop foundation

The desktop shell builds on [macos-web by Puru Vijay](https://github.com/PuruVJ/macos-web), licensed under MIT. Retained and adapted code includes desktop styling and shared UI utilities. The upstream copyright notice and MIT permission text are preserved in the root [LICENSE](LICENSE).

The inherited media collection requires separate review as described below; crediting the source project does not establish redistribution rights for every asset.

## Libraries and fonts

Exact dependency versions are recorded in `pnpm-lock.yaml`. Each dependency retains its own license. The production build uses [Vite's license output](https://vite.dev/config/build-options#build-license) to write bundled dependency notices to `dist/licenses/dependencies.md`. It also includes the root license at `dist/LICENSE` and Inter's unmodified font license at `dist/licenses/INTER-OFL.txt`.

Some assets are prepared separately from the JavaScript bundle:

| Component                                                      | Notices and source references                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ZetaOffice, LibreOffice, ZetaJS, and additional document fonts | [Office notices](public/office/NOTICE.md) and [license texts](public/office/licenses/)                        |
| PDF.js                                                         | [Apache license](public/office/licenses/PDFJS-APACHE.txt) and [Office notices](public/office/NOTICE.md#pdfjs) |
| Excalidraw and its fonts                                       | [Canvas notices](public/excalidraw/NOTICE.md)                                                                 |
| Inter                                                          | The installed `@fontsource/inter/LICENSE`, copied unchanged into the production build                         |

Keep these notices and the generated dependency report with the deployed site. Office and Excalidraw notices are served under `/office/` and `/excalidraw/`. The dependency report does not audit the rights to files copied from `public/` or imported artwork.

ZenFS is not MIT-licensed in the versions used here. [@zenfs/core 2.7.0](https://www.npmjs.com/package/@zenfs/core/v/2.7.0) and [@zenfs/dom 1.2.12](https://www.npmjs.com/package/@zenfs/dom/v/1.2.12) use LGPL-3.0-or-later with the web-application permissions in their `COPYING.md` files. Copyright James Prevett and other ZenFS contributors. The build report preserves those notices and source links. Transitive dependencies including memium and utilium also retain their LGPL terms. The root MIT license does not relicense them.

## Media and branding

The repository includes icons, wallpapers, cursors, a cover image, and a startup sound. The September 2026 release review did not establish asset-specific redistribution permissions for that collection. The Apple logos in the menu and startup screen also need a branding review.

Before release, document permission for the retained media or replace it with original or explicitly licensed assets. Keep the desktop composition while replacing individual assets. [Apple's third-party guidelines](https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html) describe its restrictions on logos, icons, and other branding. A non-affiliation statement does not grant permission.

The [release review](docs/release.md) identifies the paths to check. This notice records known sources and unresolved questions; it is not legal clearance for the distribution.
