# Bergamot translator (vendored)

The translation engine. Two files, copied in unchanged, and the reason they are committed
rather than installed: Manifest V3 forbids remotely hosted code, and WebAssembly counts. The
engine has to be inside the package a user installs.

| File | What it is | Size |
|---|---|---|
| `bergamot-translator-worker.wasm` | the engine: Marian NMT compiled to WebAssembly | 5.0 MB |
| `bergamot-translator-worker.js` | Emscripten's generated glue for the above | 80 KB |
| `LICENSE` | MPL-2.0, from the upstream repository | |

## Where this came from

- **Package**: [`@browsermt/bergamot-translator@0.4.9`](https://www.npmjs.com/package/@browsermt/bergamot-translator),
  published 2022-10-03, files taken from `worker/` inside the npm tarball.
- **Upstream**: <https://github.com/browsermt/bergamot-translator>, MPL-2.0.
- **Vendored**: 2026-08-10.

```
748b2418418a2ffc6e70721aeb10098d8e6fb589ea156b91f4ae8bc3490d8f7a  bergamot-translator-worker.js
95a2b58dd6773bf1b3f345d71f9149928b9f75f4ec9c9064c0b3e42c298671b2  bergamot-translator-worker.wasm
1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5  LICENSE
```

`tools/check-vendor.sh` verifies those sums on every run of the quality gate, refuses a file in
this directory that `CHECKSUMS` does not name at all, and also asks `WebAssembly.validate()`
whether the binary is still a loadable module. A vendored blob nobody checks is a vendored blob
that quietly rots. The licence is pinned along with the code, because "MPL-2.0, see LICENSE" is
worth exactly as much as the file it points at.

## Honesty about what you cannot read

The rest of this repository is readable on purpose - no minification, no build-time magic. These
two files are the exception, and pretending otherwise would be worse than saying it plainly:
5 MB of compiled C++ and 80 KB of generated glue are not code anybody reviews line by line.

What can be checked instead:

- the sums above pin exactly which bytes are here,
- they match the artifact published by the upstream project, not a rebuild by a third party,
- the licence is MPL-2.0, and the source that produced them is public,
- nothing here reaches the network. The engine is handed model data as `ArrayBuffer`s by our own
  code, and the only bytes this extension ever downloads are the models.

## Why 0.4.9 and not something newer

There is a fork, `@mkljczk/bergamot-translator@0.4.16`, published in December 2025. It looks
newer, and on closer inspection it is a repackage rather than a continuation: its
`translator-worker.js` is byte-for-byte identical to the official one, its changes live in files
this extension does not use, and its `.wasm` is a rebuild by a single person with no published
provenance. The 0.4.x branch is frozen either way, so "newer" bought nothing and cost a link in
the chain of trust.

The engine worth moving to eventually is the one Firefox itself ships, from
[`mozilla/translations`](https://github.com/mozilla/translations) (`inference/`, currently
v0.6.0). It has no published artifact - building it needs Docker and Emscripten - and it may
have moved off the `intgemm` matrix multiplication these model files are built for. That is
tracked as O9 in the working docs and has to be answered before anybody bumps this.

## Updating

1. Download the tarball for the chosen version from the npm registry, unpack, copy the two files
   from `worker/` into this directory.
2. Regenerate `CHECKSUMS`: `shasum -a 256 bergamot-translator-worker.js bergamot-translator-worker.wasm > CHECKSUMS`
3. Update the sums and the version above in this file.
4. Run `tools/check.sh`, and have somebody translate something in a real browser: a mismatch
   between engine version and model format does not fail loudly, it fails as nonsense output.
