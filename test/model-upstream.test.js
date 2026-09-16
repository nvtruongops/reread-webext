import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";

import { parseRegistry } from "../src/lib/models/registry.js";
import {
  allowedPrefix,
  convertUpstreamIndex,
  modelSourceUrl,
  pickEntry,
  underPrefix,
  updateAvailable,
} from "../src/lib/models/upstream.js";
import { downloadModel } from "../src/lib/models/download.js";

/** The packaged registry's source, as the guard sees it in these tests. */
const SOURCE = "https://models.example/bucket/db/models.json";
const BASE = "https://models.example/bucket/models";

/**
 * One released upstream entry, shaped like Mozilla's index shapes them.
 *
 * @param {{ architecture?: string, releaseStatus?: string, run?: string, vocabSides?: boolean, hash?: string, size?: number }} [how]
 */
function entry(how = {}) {
  const run = how.run ?? "retrain_base-memory_abc123";
  const vocab = how.vocabSides
    ? {
        srcVocab: { path: `en-pl/${run}/exported/srcvocab.enpl.spm.gz` },
        trgVocab: { path: `en-pl/${run}/exported/trgvocab.enpl.spm.gz` },
      }
    : { vocab: { path: `en-pl/${run}/exported/vocab.enpl.spm.gz` } };

  return {
    architecture: how.architecture ?? "base-memory",
    releaseStatus: how.releaseStatus ?? "Release",
    files: {
      model: {
        path: `en-pl/${run}/exported/model.enpl.intgemm.alphas.bin.gz`,
        ...(how.hash === undefined ? {} : { uncompressedHash: how.hash }),
        ...(how.size === undefined ? {} : { uncompressedSize: how.size }),
      },
      lexicalShortlist: { path: `en-pl/${run}/exported/lex.50.50.enpl.s2t.bin.gz` },
      ...vocab,
    },
  };
}

describe("allowedPrefix and underPrefix", () => {
  it("derives origin plus bucket from the packaged source", () => {
    assert.equal(allowedPrefix(SOURCE), "https://models.example/bucket/");
    assert.equal(
      allowedPrefix("https://storage.googleapis.com/moz-fx-data/db/models.json"),
      "https://storage.googleapis.com/moz-fx-data/",
    );
  });

  it("refuses other hosts, other buckets and traversal out of the bucket", () => {
    const prefix = allowedPrefix(SOURCE);
    assert.ok(underPrefix(`${BASE}/en-pl/run/exported/model.bin.gz`, prefix));
    assert.ok(!underPrefix("https://elsewhere.example/bucket/model.bin.gz", prefix));
    assert.ok(!underPrefix("https://models.example/other-bucket/model.bin.gz", prefix));
    assert.ok(!underPrefix("https://models.example/bucket/../other/model.bin.gz", prefix));
    assert.ok(!underPrefix("http://models.example/bucket/model.bin.gz", prefix));
  });
});

describe("pickEntry", () => {
  it("prefers the memory build over the desktop build", () => {
    const picked = pickEntry([entry({ architecture: "base" }), entry({ architecture: "base-memory" })]);
    assert.ok(picked.ok);
    assert.equal(picked.value.architecture, "base-memory");
  });

  it("ignores anything not released", () => {
    const picked = pickEntry([entry({ releaseStatus: "Beta" }), entry({ architecture: "base" })]);
    assert.ok(picked.ok);
    assert.equal(picked.value.architecture, "base");
    assert.ok(!pickEntry([entry({ releaseStatus: "Beta" })]).ok);
  });

  it("refuses two released builds of the same kind rather than guessing", () => {
    const picked = pickEntry([entry({ run: "one" }), entry({ run: "two" })]);
    assert.ok(!picked.ok);
  });
});

describe("convertUpstreamIndex", () => {
  it("turns a released pair into the registry shape, sums where declared", () => {
    const hash = "a".repeat(64);
    const { models, problems } = convertUpstreamIndex(
      { baseUrl: `${BASE}/`, models: { "en-pl": [entry({ hash, size: 123 })] } },
      SOURCE,
    );
    assert.deepEqual(problems, []);
    assert.equal(models.length, 1);
    const model = models[0];
    assert.equal(model?.pair, "enpl");
    assert.equal(model?.from, "en");
    assert.equal(model?.to, "pl");
    assert.deepEqual(
      model?.files.map((file) => file.role),
      ["model", "shortlist", "vocab"],
    );
    assert.equal(model?.files[0]?.sha256, hash);
    assert.equal(model?.files[0]?.bytes, 123);
    assert.equal(model?.files[1]?.sha256, null);
    assert.equal(model?.files[1]?.bytes, 0);
  });

  it("keeps script-suffixed codes and both vocabulary shapes", () => {
    const { models, problems } = convertUpstreamIndex(
      {
        baseUrl: BASE,
        models: {
          "en-zh_hant": [entry()],
          "pl-en": [entry({ vocabSides: true })],
        },
      },
      SOURCE,
    );
    assert.deepEqual(problems, []);
    assert.deepEqual(
      models.map((model) => model.pair),
      ["enzh_hant", "plen"],
    );
    const sided = models.find((model) => model.pair === "plen");
    assert.equal(sided?.files.filter((file) => file.role === "vocab").length, 2);
  });

  it("drops a pair whose files point outside the packaged bucket, and keeps the rest", () => {
    const foreign = entry();
    foreign.files.model.path = "../../elsewhere/model.bin.gz";
    const { models, problems } = convertUpstreamIndex(
      { baseUrl: BASE, models: { "en-pl": [foreign], "de-en": [entry()] } },
      SOURCE,
    );
    assert.deepEqual(
      models.map((model) => model.pair),
      ["deen"],
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /en-pl/);
  });

  it("drops what it cannot read - keys, pairs, whole shapes - without throwing", () => {
    const odd = entry();
    // @ts-expect-error - deliberately not a file the roles know
    odd.files.somethingNew = { path: "en-pl/x/exported/extra.bin" };
    const { models, problems } = convertUpstreamIndex(
      {
        baseUrl: BASE,
        models: { "en-pl": [odd], "not a pair": [entry()], "de-en": "not entries" },
      },
      SOURCE,
    );
    assert.deepEqual(models, []);
    assert.equal(problems.length, 3);
    assert.deepEqual(convertUpstreamIndex(null, SOURCE).models, []);
    assert.deepEqual(convertUpstreamIndex({ models: {} }, SOURCE).models, []);
  });
});

describe("updateAvailable", () => {
  const available = convertUpstreamIndex({ baseUrl: BASE, models: { "en-pl": [entry({ run: "newrun" })] } }, SOURCE)
    .models[0];

  it("claims nothing without a recorded source or an offered model", () => {
    assert.equal(updateAvailable(null, available ?? null), false);
    assert.equal(updateAvailable({}, available ?? null), false);
    assert.equal(updateAvailable({ sourceUrl: "https://x/model.bin" }, null), false);
  });

  it("compares the recorded source with the offered model file", () => {
    const offered = modelSourceUrl(/** @type {any} */ (available));
    assert.ok(offered !== null);
    assert.equal(updateAvailable({ sourceUrl: offered ?? "" }, available ?? null), false);
    assert.equal(updateAvailable({ sourceUrl: `${BASE}/en-pl/oldrun/exported/model.enpl.bin.gz` }, available ?? null), true);
  });
});

describe("parseRegistry without required sums", () => {
  const bare = {
    models: [
      {
        pair: "enpl",
        from: "en",
        to: "pl",
        files: [
          { role: "model", url: "https://models.example/bucket/m.bin.gz", downloadBytes: 0, bytes: 0, sha256: null },
          { role: "shortlist", url: "https://models.example/bucket/l.bin.gz", downloadBytes: 0, bytes: 0, sha256: null },
          { role: "vocab", url: "https://models.example/bucket/v.spm.gz", downloadBytes: 0, bytes: 0, sha256: null },
        ],
      },
    ],
  };

  it("accepts sumless entries only when told to", () => {
    assert.equal(parseRegistry(bare).models.length, 0);
    const lenient = parseRegistry(bare, { requireSums: false });
    assert.deepEqual(lenient.problems, []);
    assert.equal(lenient.models.length, 1);
  });

  it("still refuses a sum that is present but wrong, in both modes", () => {
    const files = bare.models[0]?.files ?? [];
    const broken = {
      models: [{ ...bare.models[0], files: [{ ...files[0], sha256: "not hex" }, files[1], files[2]] }],
    };
    assert.equal(parseRegistry(broken, { requireSums: false }).models.length, 0);
    assert.equal(parseRegistry(broken).models.length, 0);
  });
});

describe("downloadModel with an entry that claims nothing", () => {
  it("stores what arrives whole and refuses emptiness", async () => {
    const body = new TextEncoder().encode("model bytes ".repeat(64));
    const wire = new Uint8Array(gzipSync(body));

    /** @type {import("../src/lib/models/registry.js").RegistryModel} */
    const model = {
      pair: "enpl",
      from: "en",
      to: "pl",
      downloadBytes: 0,
      bytes: 0,
      files: [
        { role: "model", url: "https://models.example/bucket/m.bin.gz", downloadBytes: 0, bytes: 0, sha256: null },
        { role: "shortlist", url: "https://models.example/bucket/l.bin.gz", downloadBytes: 0, bytes: 0, sha256: null },
        { role: "vocab", url: "https://models.example/bucket/v.spm.gz", downloadBytes: 0, bytes: 0, sha256: null },
      ],
    };

    /** @type {typeof fetch} */
    const serve = /** @type {any} */ (
      async (/** @type {string} */ url) =>
        new Response(url.endsWith("v.spm.gz") ? new Uint8Array(gzipSync(new Uint8Array(0))) : wire.slice())
    );

    const refused = await downloadModel(model, { fetch: serve });
    assert.ok(!refused.ok);
    assert.equal(refused.problem, "size");
    assert.match(refused.detail ?? "", /empty/);

    /** @type {typeof fetch} */
    const serveWhole = /** @type {any} */ (async () => new Response(wire.slice()));
    const accepted = await downloadModel(model, { fetch: serveWhole });
    assert.ok(accepted.ok);
    assert.equal(new TextDecoder().decode(accepted.value.model), new TextDecoder().decode(body));
  });
});
