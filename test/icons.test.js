import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { inflateSync } from "node:zlib";

/**
 * The committed rasters, read back the way a browser will read them. The
 * generator (`tools/icon/make-icons.mjs`) is dependency-free on purpose, which
 * also means nothing ever proof-read its output - so this suite is the second
 * reader: headers say what the manifest promises, and the pixels hold the
 * line mark in the set's own token color rather than a blank or a slab.
 *
 * Two sets because Chrome has no theme-aware manifest icons: the default one
 * (dark glyph, light toolbars, every size the manifest names) and the
 * `light-` one (paper glyph, dark toolbars, only the two sizes
 * `action.setIcon` can put on a toolbar - see `src/lib/theme-icon.js`).
 */

const SETS = [
  { suffix: "", color: [0x5b, 0x5b, 0x66], sizes: [16, 32, 48, 128] },
  // Chrome's own dark-toolbar icon gray, sampled - not Firefox's #fbfbfe;
  // the generator's header carries the measurements.
  { suffix: "light-", color: [0xc0, 0xc0, 0xc0], sizes: [16, 32] },
];

/**
 * @param {string} name
 * @returns {Promise<Buffer>}
 */
async function bytes(name) {
  return readFile(new URL(`../src/assets/icons/${name}`, import.meta.url));
}

/**
 * @param {Buffer} png
 * @returns {{ width: number, height: number, bitDepth: number, colorType: number }}
 */
function header(png) {
  assert.deepEqual(
    [...png.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "not a PNG signature",
  );
  assert.equal(png.toString("latin1", 12, 16), "IHDR");
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    bitDepth: png[24] ?? 0,
    colorType: png[25] ?? 0,
  };
}

/**
 * RGBA rows out of the IDAT stream. Asserts the one filter the generator
 * writes, so a change there fails loudly instead of decoding garbage.
 *
 * @param {Buffer} png
 * @param {number} size
 * @returns {Buffer} `size * size * 4` bytes
 */
function pixels(png, size) {
  /** @type {Buffer[]} */
  const idat = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = size * 4 + 1;
  assert.equal(raw.length, size * stride, "scanlines do not add up to the declared size");

  const out = Buffer.alloc(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    assert.equal(raw[row * stride], 0, `scanline ${row} uses a filter the generator never writes`);
    raw.copy(out, row * size * 4, row * stride + 1, (row + 1) * stride);
  }
  return out;
}

for (const { suffix, color, sizes } of SETS) {
  describe(`the ${suffix === "" ? "light-toolbar" : "dark-toolbar"} raster set`, () => {
    for (const size of sizes) {
      const name = `icon-${suffix}${size}.png`;

      it(`${name} is an 8-bit RGBA square of its name`, async () => {
        const png = await bytes(name);
        assert.deepEqual(header(png), { width: size, height: size, bitDepth: 8, colorType: 6 });
      });

      it(`${name} holds the mark in the set's one color`, async () => {
        const rgba = pixels(await bytes(name), size);

        let ink = 0;
        for (let at = 0; at < rgba.length; at += 4) {
          const alpha = /** @type {number} */ (rgba[at + 3]);
          ink += alpha;
          if (alpha > 0) {
            // One color per set, whatever the coverage: a wrong channel here
            // means a swapped set or a generator that started blending.
            assert.deepEqual(
              [rgba[at], rgba[at + 1], rgba[at + 2]],
              color,
              `an inked pixel at byte ${at} is not the set's color`,
            );
          }
        }

        // Mean coverage, not a count of touched pixels: anti-aliasing brushes
        // most of a 16px grid with a little alpha, while the mass of ink the
        // mark lays down is the same share of the square at every size
        // (~22%). A blank file has none of it, a flood has nearly all. The
        // wide band is on purpose - this guards decoding, not taste.
        const share = ink / (255 * size * size);
        assert.ok(share > 0.08, `mean coverage ${(share * 100).toFixed(1)}% - blank?`);
        assert.ok(share < 0.45, `mean coverage ${(share * 100).toFixed(1)}% - flooded?`);

        // The drawing is centered with margins: all four corners stay clear.
        for (const [x, y] of /** @type {Array<[number, number]>} */ ([
          [0, 0],
          [size - 1, 0],
          [0, size - 1],
          [size - 1, size - 1],
        ])) {
          assert.equal(rgba[(y * size + x) * 4 + 3], 0, `corner ${x},${y} is inked`);
        }
      });
    }
  });
}
