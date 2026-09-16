# Readability (vendored)

The article extractor behind Firefox's own reader view, as a standalone library. One file,
copied in unchanged, and the reason it is committed rather than installed is the same as for the
engine next door: Manifest V3 forbids remotely hosted code, and an extension that asks for
`<all_urls>` should ship what it runs.

| File | What it is | Size |
|---|---|---|
| `Readability.js` | the extractor: a page in, an article out | 88 KB |
| `LICENSE` | Apache License 2.0, full text | 10 KB |

## Where this came from

- **Package**: [`@mozilla/readability@0.6.0`](https://www.npmjs.com/package/@mozilla/readability),
  published 2025-03-03 - the current release.
- **Upstream**: <https://github.com/mozilla/readability>, Apache-2.0.
- **Vendored**: 2026-08-11.

```
34dcab3d0832d0019f02990eed6b6124e029e8c32b9f0c6f2550544ff8dff174  Readability.js
074e6e32c86a4c0ef8b3ed25b721ca23aca83df277cd88106ef7177c354615ff  LICENSE
```

**Two sources agree on those bytes.** The file in the npm tarball and the file at tag `0.6.0` in
the GitHub repository are byte-for-byte identical - same SHA-256, checked when this was vendored.
That is worth more than either source alone: a tampered npm publish would have to match a tag in
a repository it does not control.

`tools/check-vendor.sh` verifies the sums on every run of the quality gate, and refuses a file in
this directory that `CHECKSUMS` does not name at all. A vendored blob nobody checks is a vendored
blob that quietly rots.

## What is not here, and why

- **`JSDOMParser.js`** (37 KB) - a HTML parser for Node, where there is no `DOMParser`. In a
  browser there is one, so this is 37 KB of dead weight.
- **`Readability-readerable.js`** (4 KB) - guesses whether a page is an article before parsing
  it. We parse anyway and let the answer be the answer, so there is nothing for it to save.
- **Anything else from the package** - `index.js`, the type definitions, the config files. What
  is here is what runs.

## The licence, precisely

Upstream ships a short-form `LICENSE.md`: the copyright line (Arc90 Inc, 2010) plus the standard
"Licensed under the Apache License, Version 2.0" paragraph pointing at a URL. `LICENSE` in this
directory is the **full text** that paragraph points at, because a licence you have to fetch from
the internet is not a licence shipped with the package. The copyright notice itself is where
upstream puts it, at the top of `Readability.js`, and that file is unchanged.

Apache-2.0 is compatible with this extension's AGPL-3.0-or-later in the direction that matters:
Apache-2.0 code may be combined into a GPL-3.0/AGPL-3.0 work, not the other way round. Upstream
publishes no `NOTICE` file, so there is none to carry.

## Reading it, unlike the engine

This one **is** readable, and that is part of why it was chosen: 2 800 lines of plain JavaScript
that scores paragraphs and throws away navigation. It runs on the reader page, on an inert
document parsed by `DOMParser` - never on the page being read, and never in the background.

What it does not do, checked in the source rather than assumed: it never touches the network and
never reaches for `window`. The only thing it wants from a document beyond the tree itself is
`baseURI`, which it uses to turn relative links into absolute ones.

None of that makes its output trustworthy. What comes out is HTML built from somebody else's
page, and it is treated that way - the reader rebuilds it into its own document from an allowed
list of elements and attributes, and never assigns it as `innerHTML`.

## Updating

1. Download the tarball for the chosen version from the npm registry, unpack, copy
   `Readability.js` into this directory.
2. Compare it with the same tag on GitHub - if the two disagree, stop and find out why.
3. Regenerate `CHECKSUMS`: `shasum -a 256 Readability.js LICENSE > CHECKSUMS`
4. Update the sums, the version and the date above.
5. Run `tools/check.sh`, and open a few real articles in the reader. Extraction failing is not a
   crash; it is a page that comes out as navigation links, or as nothing at all.
