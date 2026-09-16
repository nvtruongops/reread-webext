# fflate (vendored)

The ZIP reader behind EPUB import, and the writer behind the backup. One file, copied in
unchanged, committed for the same reason as its two neighbours: Manifest V3 forbids remotely hosted code, and an extension
that asks for `<all_urls>` should ship what it runs.

| File | What it is | Size |
|---|---|---|
| `browser.js` | the library's browser ES module build, unminified | 89 KB |
| `LICENSE` | MIT, full text | 1 KB |

## Where this came from

- **Package**: [`fflate@0.8.3`](https://www.npmjs.com/package/fflate), published 2026-05-16 -
  the current release. The vendored file is `esm/browser.js` from the npm tarball
  (`fflate-0.8.3.tgz`, SHA-256
  `38c2cd824402407b43153c782274aec2ea83ea688e4aa0b743c5f2c305857d92`).
- **Upstream**: <https://github.com/101arrowz/fflate>, MIT.
- **Vendored**: 2026-08-16.

```
b7ca4450b19559a1d50eb381adcee94b82449674be4cd17789d9beba7e6122a1  browser.js
0a1df3a083d0c010560aa342e87959c8c1070e6fd54545741f083f22d0c8b551  LICENSE
```

**One source, unlike Readability.** Upstream's repository holds TypeScript; the JavaScript
here is built at publish time, so there is no tag to compare the bytes against. What is
pinned instead is the tarball itself (its SHA-256 above, and the registry's own integrity
for `0.8.3` is
`sha512-tbZNuJrLwGUp3zshBtdy4W+ORxZuIh8a5ilyIEQDC5rY1f3U20JMry0Ll3WBzU58EZKsEuJFXhb5gwv8CsPvgA==`).

`tools/check-vendor.sh` verifies the sums on every run of the quality gate, and refuses a
file in this directory that `CHECKSUMS` does not name at all.

## Why this build, and how it is loaded

`esm/browser.js` is the one build that is both **readable** (compiled from TypeScript,
unminified, commented) and **free of Node imports**. The minified UMD build is a third the
size and was rejected for the reason minification is banned from our own code: a package
that asks to read every page has to be readable itself.

It is **copied into the package, never bundled** - the file that ships hashes to the file
npm published (the same rule as the engine and Readability). Being an ES module it cannot
be a plain `<script>` like Readability; the reader page loads it with a dynamic
`import(runtime.getURL(...))`, once, at the moment a book import actually starts. Nothing
loads it before then.

## What is used, and what is not

One synchronous function and three synchronous classes, all through `src/reader/zip.js`:
**`unzipSync`**, always with a `filter`, which is what makes it decompress single ZIP entries
on demand - the central directory is scanned, and only the entry asked for is inflated (the
book import's reads, and since D145 the listing and the entries of the `.zip` backup) - and
the streaming writer **`Zip`** with **`ZipDeflate`** (text entries) and **`ZipPassThrough`**
(pictures, stored as they are), which write the backup one entry at a time (D218; until then
`zipSync` wrote it whole, and the whole library stood in memory beside its archive). Nothing
else is called. In particular the **asynchronous API is never touched**: that path (visible
near the top of the file, and `AsyncZipDeflate` beside the classes above) spins up Web Workers
from `Blob` URLs, which is exactly the kind of dynamic code an auditor should be able to rule
out - and can, by checking that no `unzip(`, `zip(` or `Async` call sites exist in `src/`
(`test/vendor-surface.test.js` checks exactly that on every run of the quality gate).

## The licence, precisely

MIT, full text in `LICENSE`, copyright Arjun Barrett. MIT is compatible with this
extension's AGPL-3.0-or-later in the direction that matters: MIT code may be combined into
an AGPL-3.0 work, not the other way round.

## Updating

1. Download the tarball for the chosen version from the npm registry, unpack, copy
   `esm/browser.js` into this directory as `browser.js`.
2. Record the tarball's SHA-256 and the registry integrity string above - they are the
   provenance, since upstream publishes no built files to compare against.
3. Regenerate `CHECKSUMS`: `shasum -a 256 browser.js LICENSE > CHECKSUMS`
4. Update the sums, the version and the date above.
5. Run `tools/check.sh`, then import a real EPUB in the reader - both a single-file novel
   and a many-chapter book.
