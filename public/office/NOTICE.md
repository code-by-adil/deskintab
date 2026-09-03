# Office components and source availability

Documents includes ZetaOffice, based on LibreOffice, and the ZetaJS JavaScript bridge from allotropia software GmbH and contributors. The WebMCP Desktop MIT license does not replace the licenses of these components.

## ZetaJS and adapted examples

ZetaJS 1.2.0 and its full-office/PDF example code are copyright (c) 2024 allotropia software GmbH and contributors, under the [MIT license](licenses/ZETAJS-MIT.txt). The desktop's bootstrap and UNO integration adapt those examples.

- [ZetaJS source and examples](https://github.com/allotropia/zetajs)
- [ZetaJS 1.2.0 package](https://www.npmjs.com/package/zetajs/v/1.2.0)

## ZetaOffice / LibreOffice

The preparation script retrieves the upstream binaries from `https://cdn.zetaoffice.net/zetaoffice_latest/` and verifies the exact hashes recorded in `scripts/prepare-office.mjs`. Their embedded LibreOffice source build ID is `efaf0670b4d055f838a2849becb10f08aa06a257`. Runtime files are compressed and split for transport; decompression reconstructs the original binaries without patches.

Source code is available from the upstream repositories identified by [ZetaJS's build documentation](https://github.com/allotropia/zetajs#using-with-an-own-build):

- [LibreOffice source at the embedded build ID](https://git.libreoffice.org/core/+/efaf0670b4d055f838a2849becb10f08aa06a257/)
- [ZetaOffice distribution branch](https://git.libreoffice.org/core/+/refs/heads/distro/allotropia/zeta-24-2)
- [Emscripten fixed-3.1.65 sources](https://github.com/allotropia/emscripten/commits/fixed-3.1.65)
- [Qt 5 sources](https://github.com/allotropia/qt5/tree/5.15.2%2Bwasm)
- [Qt Base sources](https://github.com/allotropia/qtbase/tree/5.15.2%2Bwasm)

LibreOffice's source uses the Mozilla Public License 2.0 and other licenses for incorporated components. The source revision's unmodified [MPL](licenses/COPYING.MPL.txt), [LGPL](licenses/COPYING.LGPL.txt), and [GPL](licenses/COPYING.txt) texts accompany this integration. Individual component copyright and license notices remain in their corresponding source files and in LibreOffice's [`readlicense_oo`](https://git.libreoffice.org/core/+/efaf0670b4d055f838a2849becb10f08aa06a257/readlicense_oo/) directory. Qt, Emscripten, bundled fonts, and other dependencies retain their own license terms and source notices.

The upstream build instructions explain how to build a replacement runtime. It can be used with this desktop by updating the preparation script's verified hashes and supplying the matching files. The desktop bridge is separate JavaScript; it does not modify LibreOffice or Qt source.

These components are provided without warranty under their respective licenses. LibreOffice and ZetaOffice names identify their upstream projects; no endorsement is implied.

## Additional document fonts

The preparation script also downloads three unmodified fonts, verifies their pinned SHA-256 hashes, and serves them from the desktop's own origin:

- **Noto Serif Bengali 2.003**, regular and bold: Copyright 2022 The Noto Project Authors, under the [SIL Open Font License 1.1](licenses/NOTO-BENGALI-OFL.txt). [Source project](https://github.com/notofonts/bengali); [pinned font build](https://github.com/notofonts/bengali/tree/302df440f56996d55729644be29585af2b9ad555/fonts/NotoSerifBengali/hinted/ttf).
- **Noto Sans SC 2.004**, regular, upstream China subset: Copyright 2014–2021 Adobe (http://www.adobe.com/), under the [SIL Open Font License 1.1](licenses/NOTO-CJK-OFL.txt). [Pinned release and source](https://github.com/notofonts/noto-cjk/tree/523d033d6cb47f4a80c58a35753646f5c3608a78); [font deployment guide](https://github.com/notofonts/noto-cjk/blob/main/Sans/README.md).

These fonts are installed into the temporary office filesystem before Writer starts. Their licenses permit embedding in exported documents; the licenses do not apply to the document's own content.

## PDF.js

PDF previews use [Mozilla PDF.js](https://github.com/mozilla/pdf.js), distributed as `pdfjs-dist` under the [Apache License 2.0](licenses/PDFJS-APACHE.txt). Copyright Mozilla Foundation and individual contributors. The exact package version is recorded in `pnpm-lock.yaml`.
