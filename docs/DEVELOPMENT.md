# Development notes

Practical notes for building, loading and releasing re/read. The short version lives in the [README](../README.md#development); this file keeps the details.

## Commands

```bash
npm install              # once
npm run build            # Firefox package in dist/firefox
npm run build:chromium   # Chromium package in dist/chromium
npm run watch            # rebuild on change
npm test                 # unit tests (node --test, no framework)
npm run typecheck        # tsc --noEmit over code and tests
npm start                # build, then launch Firefox with the extension loaded
tools/check.sh           # quality gate: vendor checksums, typecheck, tests, both builds, addons-linter
npm run sign             # gate, then AMO signing (needs credentials, see below)

node tools/models-registry.mjs --all   # rewrite the model registry (network; downloads gigabytes, --pairs=en-pl,pl-en narrows it)
node tools/wikdict-catalog.mjs         # rewrite the dictionary catalogue (network)
```

`tools/check.sh` is exactly what CI runs, so the gate and CI cannot drift apart. The two registry tools are run by hand when upstream releases change, and their output is committed.

## Installing a Firefox build that survives a restart

Firefox permanently installs only signed packages; anything loaded through `about:debugging` or `web-ext run` disappears on restart, together with the vocabulary database. `npm run sign` runs the gate, uploads `dist/firefox` to AMO for validation and signing, and saves the signed `.xpi` to `web-ext-artifacts/`. The channel is **unlisted**: nothing appears in the add-on directory and nobody else can find or install the result.

Installing:

- **Desktop:** **about:addons** → cog → **Install Add-on From File**, or drag the `.xpi` onto a Firefox window.
- **Android:** copy the `.xpi` to the phone, unlock the hidden menu (tap the Firefox logo five times in **Settings → About Firefox**), then pick **Install extension from file**.

Installing a newer build over an older one keeps the vocabulary - the extension id, and with it the database, stays the same.

Signing needs an [AMO API key](https://addons.mozilla.org/developers/addon/api/key/):

```bash
cp .env.example .env   # gitignored; fill in WEB_EXT_API_KEY and WEB_EXT_API_SECRET
```

AMO refuses any version number it has already seen, so each signed build raises `version` in both `src/manifest.json` and `package.json` (scheme: `0.<milestone>.<build>`).

## Loading in Chrome / Chromium

Chrome loads the build directly, no signing involved: **chrome://extensions** → enable **Developer mode** → **Load unpacked** → pick `dist/chromium`. The load survives restarts, but Chrome shows a "developer mode extensions" notice on startup.

Run `npm run build:chromium` immediately before loading or reloading. `dist/` is a build product: the quality gate deletes and rebuilds it on every run, so a reload that races a build - or trails an interrupted one - loads a package with files missing, and the errors (`ERR_FILE_NOT_FOUND` in the console of extension pages) point at the load, not at the code. When in doubt: build, then press reload on **chrome://extensions**.

One directive of the pages' Content-Security-Policy is looser in the Chromium package: `style-src` allows inline styles (`'unsafe-inline'`, patched in by `tools/manifest-target.mjs`). The reader parses other people's pages with `DOMParser`; the parsed document inherits the policy, and Chromium files a violation report for every inline style it meets there - styles that never take effect, since that document is never rendered and the article builder strips `style` attributes before anything reaches a live page. An unpacked extension collects those reports into a red "Errors" button on the extensions page, which reads as a malfunction where nothing is wrong. Scripts stay locked in both packages, and the Firefox package keeps the strict directive - Firefox files no such reports.

## Code layout

```
src/
  background/    the only context that translates and owns the database
  content/       what runs on every page: selection, bubble, highlighting
  reader/        the extension's own reader mode and the reading list
  vocab/         the saved phrases page
  options/       settings
  popup/         the toolbar popup
  offscreen/     Chromium only: the page hosting the engine's worker
  lib/
    translator/  engine facade and its providers
    models/      translation models: registry, download, verification, storage
    matcher/     tokenisation and phrase matching
    dict/        StarDict dictionaries
    store/       IndexedDB, import and export
vendor/
  bergamot/      the engine, committed rather than installed
  readability/   the article extractor, committed rather than installed
  fflate/        the ZIP reader for EPUB import, committed rather than installed
```
