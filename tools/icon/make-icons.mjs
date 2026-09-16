// Generates src/assets/icons/* from the re/read mark (reread-mark.svg in
// this directory, kept byte for byte as it left the design tool).
//
// The mark is drawn with one uniform line weight on an artboard the design
// tool trimmed to the drawing, so a single scale maps that artboard onto the
// full 16x16 Firefox toolbar grid. Full, not 15px like home.svg/reload.svg:
// the first cut sat 15px tall and read visibly shorter next to the avatar
// and puzzle buttons, which do run edge to edge (the avatar circle spans
// 0..16). The line weight lands at ~1.5px - the weight of the avatar
// button's ring, at the heavy end of the proton set (home/reload measure
// ~1.25px). Icon color tokens #5b5b66 (light theme) / #fbfbfe (dark theme)
// from tokens-shared.css.
//
// Three SVG files, because three consumers: `icon.svg` follows the page's
// color scheme (default_icon, add-on manager), the fixed-color pair feeds
// action.theme_icons, where the active theme - not the OS scheme - decides.
//
// Eight PNG files for a fourth consumer: Chromium, which has never accepted
// SVG for extension icons. They are rasterized here rather than by the build,
// with no image library: the mark is a rounded-rectangle ring and one filled
// path, both of which a page of geometry can sample - and a generator with no
// dependencies is one anybody can read next to the files it wrote.
//
// Two raster sets, the same quiet line as the SVGs, each colored to sit
// among Chrome's own toolbar icons rather than in Firefox's tokens:
// `icon-N.png` in #5b5b66 for light toolbars - also the manifest default,
// and within a hair of Chrome's measured light-icon gray (#5d6575) - and
// `icon-light-N.png` in #c0c0c0 for dark ones ("light" names the glyph,
// matching icon-light.svg). #c0c0c0 is Chrome's own dark-toolbar icon
// color, sampled off a real toolbar (glyphs #c0c0c0 on #353535, 7.6:1);
// Firefox's near-white #fbfbfe was tried first and read louder than the
// browser's own icons - and it also vanished (1.04:1) on a light toolbar
// in the swap gap below, where #c0c0c0 stays faintly legible (1.6:1).
//
// The swap: Chrome has no theme-aware manifest icons (`icon_variants` is
// still a WECG proposal, nothing shipped through Chrome 153), so the
// extension swaps the toolbar icon itself with `action.setIcon`
// (`src/lib/theme-icon.js`). A single mid-gray was tried first and read
// wrong both ways - washed out next to the light toolbar's icons, sunk on
// the dark one - and a solid brand tile read legibly but not like re/read;
// the swap keeps the mark the mark on both. What setIcon cannot reach -
// chrome://extensions - shows the manifest default.
//
// Usage: node tools/icon/make-icons.mjs

import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";

// The mark, in its own coordinates: a page outline and the letter r, on the
// artboard reread-mark.svg trims to the drawing.
const CANVAS = { w: 92.316, h: 101.265 };
const RECT = { x: 4.876, y: 4.925, w: 82.342, h: 91.262, rx: 14.764, stroke: 9.52 };
const GLYPH =
  "M31.858,57.057l-0.001,23.791l-10.515,-0l-0,-23.824l10.516,-0l0.001,-35.39l10.356,0.043" +
  "l0,5.393c0.291,-0.403 0.598,-0.792 0.921,-1.169c3.222,-3.758 7.863,-5.637 13.923,-5.637" +
  "c2.762,0 5.255,0.435 7.48,1.305c2.224,0.87 4.296,2.314 6.213,4.332l-6.789,6.367" +
  "c-1.15,-1.114 -2.416,-1.914 -3.797,-2.401c-1.381,-0.487 -2.992,-0.73 -4.833,-0.73" +
  "c-3.836,-0 -6.981,1.113 -9.436,3.34c-2.454,2.226 -3.682,5.601 -3.682,10.124l0,14.456l-10.357,-0Z";

// Outer bounds of the drawing, stroke included - reported so a resize of the
// artboard that clips the drawing would be visible in the output.
const outer = {
  x: RECT.x - RECT.stroke / 2,
  y: RECT.y - RECT.stroke / 2,
  w: RECT.w + RECT.stroke,
  h: RECT.h + RECT.stroke,
};

const S = 16 / CANVAS.h;
const DX = 8 - (CANVAS.w / 2) * S;
const DY = 8 - (CANVAS.h / 2) * S;

/** @param {number} n */
const round = (n) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};
/** @param {number} x */
const tx = (x) => round(x * S + DX);
/** @param {number} y */
const ty = (y) => round(y * S + DY);
/** @param {number} d */
const ts = (d) => round(d * S);

/**
 * Scale an SVG path of absolute M and relative l/c segments - all the mark
 * uses. Points move by the affine map, deltas only scale.
 *
 * @param {string} d
 */
function transformPath(d) {
  return d.replace(/([MlcZ])([^MlcZ]*)/g, (_, cmd, body) => {
    if (cmd === "Z") return "Z";
    const nums = String(body).match(/-?[\d.]+/g)?.map(Number) ?? [];
    /** @type {string[]} */
    const out = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = /** @type {number} */ (nums[i]);
      const y = /** @type {number} */ (nums[i + 1]);
      out.push(cmd === "M" ? `${tx(x)} ${ty(y)}` : `${ts(x)} ${ts(y)}`);
    }
    return cmd + out.join(" ");
  });
}

const rect =
  `x="${tx(RECT.x)}" y="${ty(RECT.y)}" width="${ts(RECT.w)}" height="${ts(RECT.h)}" ` +
  `rx="${ts(RECT.rx)}"`;
const strokeWidth = ts(RECT.stroke);
const glyph = transformPath(GLYPH);

/**
 * @param {string} paint - fill/stroke value ("currentColor" or a hex color)
 * @param {string} style - extra markup after the comment ("" for fixed colors)
 */
const svg = (paint, style) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <!-- The re/read mark: a page holding a single letter r. Drawn to match the
       Firefox toolbar set: ~1.5px lines, full-height on the 16px grid, the
       browser's icon color tokens #5b5b66 (light theme) / #fbfbfe (dark).
       Generated by tools/icon/make-icons.mjs - edit there, not here. -->
${style}  <rect ${rect} fill="none" stroke="${paint}" stroke-width="${strokeWidth}"/>
  <path d="${glyph}" fill="${paint}"/>
</svg>
`;

const adaptive = svg(
  "currentColor",
  `  <style>
    :root { color: #5b5b66; }
    @media (prefers-color-scheme: dark) { :root { color: #fbfbfe; } }
  </style>
`,
);

// ---------------------------------------------------------------------------
// Rasterization. Everything below samples the same two shapes the SVG draws,
// in the mark's own coordinates: a point is inked when it lies inside the
// rounded-rectangle ring or inside the glyph. Pixels average a grid of such
// samples, which is all the anti-aliasing a mark this simple needs.

/**
 * The two raster sets - the same tokens the SVGs use, see the header. The
 * default set carries every size the manifest names (`icons` up to 128); the
 * dark-toolbar set only the two `action.setIcon` can put on a toolbar - a
 * size nothing would ever load has no place in a package anyone may audit.
 */
const PNG_SETS = /** @type {const} */ ([
  { suffix: "", color: { r: 0x5b, g: 0x5b, b: 0x66 }, sizes: [16, 32, 48, 128] },
  { suffix: "light-", color: { r: 0xc0, g: 0xc0, b: 0xc0 }, sizes: [16, 32] },
]);

/** Samples per pixel edge; 8x8 per pixel keeps the 16px icon's curves clean. */
const SAMPLES = 8;

/** Segments a cubic is flattened into - smooth at 128px, invisible below. */
const CUBIC_STEPS = 24;

/**
 * Signed distance from a point to a rounded rectangle's edge, negative inside.
 * The ring is "inside the outer rounded rect, outside the inner one", each of
 * which is the stroked rect grown or shrunk by half the stroke.
 *
 * @param {number} px
 * @param {number} py
 * @param {number} grow - half the stroke, positive for outer, negative for inner
 * @returns {number}
 */
function roundedRectDistance(px, py, grow) {
  const hw = RECT.w / 2 + grow;
  const hh = RECT.h / 2 + grow;
  const r = Math.max(RECT.rx + grow, 0);
  const cx = RECT.x + RECT.w / 2;
  const cy = RECT.y + RECT.h / 2;
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

/**
 * The glyph as one closed polygon in mark coordinates: the path's absolute M,
 * relative l and relative c segments flattened once, shared by every size.
 *
 * @returns {Array<[number, number]>}
 */
function flattenGlyph() {
  /** @type {Array<[number, number]>} */
  const points = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, body] of GLYPH.matchAll(/([MlcZ])([^MlcZ]*)/g)) {
    const nums = String(body).match(/-?[\d.]+/g)?.map(Number) ?? [];
    if (cmd === "M") {
      x = /** @type {number} */ (nums[0]);
      y = /** @type {number} */ (nums[1]);
      points.push([x, y]);
    } else if (cmd === "l") {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        x += /** @type {number} */ (nums[i]);
        y += /** @type {number} */ (nums[i + 1]);
        points.push([x, y]);
      }
    } else if (cmd === "c") {
      for (let i = 0; i + 5 < nums.length; i += 6) {
        const x1 = x + /** @type {number} */ (nums[i]);
        const y1 = y + /** @type {number} */ (nums[i + 1]);
        const x2 = x + /** @type {number} */ (nums[i + 2]);
        const y2 = y + /** @type {number} */ (nums[i + 3]);
        const x3 = x + /** @type {number} */ (nums[i + 4]);
        const y3 = y + /** @type {number} */ (nums[i + 5]);
        for (let step = 1; step <= CUBIC_STEPS; step += 1) {
          const t = step / CUBIC_STEPS;
          const u = 1 - t;
          points.push([
            u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
          ]);
        }
        x = x3;
        y = y3;
      }
    }
    // Z: the winding test below treats the polygon as closed already.
  }
  return points;
}

const GLYPH_POLYGON = flattenGlyph();

/**
 * Nonzero winding - what SVG fills with by default.
 *
 * @param {number} px
 * @param {number} py
 * @returns {boolean}
 */
function insideGlyph(px, py) {
  let winding = 0;
  const points = GLYPH_POLYGON;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = /** @type {[number, number]} */ (points[i]);
    const [x2, y2] = /** @type {[number, number]} */ (points[(i + 1) % points.length]);
    if (y1 <= py) {
      if (y2 > py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) > 0) winding += 1;
    } else if (y2 <= py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) < 0) {
      winding -= 1;
    }
  }
  return winding !== 0;
}

/**
 * @param {number} px
 * @param {number} py
 * @returns {boolean}
 */
function inked(px, py) {
  const inRing =
    roundedRectDistance(px, py, RECT.stroke / 2) <= 0 &&
    roundedRectDistance(px, py, -RECT.stroke / 2) > 0;
  return inRing || insideGlyph(px, py);
}

/**
 * Coverage-sampled RGBA pixels for one size, mapped the way the SVG maps the
 * mark onto its grid: fit the artboard height, center horizontally.
 *
 * @param {number} size
 * @param {{ r: number, g: number, b: number }} color
 * @returns {Uint8Array}
 */
function rasterize(size, color) {
  const scale = size / CANVAS.h;
  const dx = size / 2 - (CANVAS.w / 2) * scale;
  const pixels = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = (col + (sx + 0.5) / SAMPLES - dx) / scale;
          const py = (row + (sy + 0.5) / SAMPLES) / scale;
          if (inked(px, py)) hits += 1;
        }
      }
      const at = (row * size + col) * 4;
      pixels[at] = color.r;
      pixels[at + 1] = color.g;
      pixels[at + 2] = color.b;
      pixels[at + 3] = Math.round((hits / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return pixels;
}

/**
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type - four-letter chunk name
 * @param {Uint8Array} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

/**
 * A minimal PNG: 8-bit RGBA, no interlace, every scanline filter "none".
 *
 * @param {number} size
 * @param {Uint8Array} pixels
 * @returns {Buffer}
 */
function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let row = 0; row < size; row += 1) {
    // Leading zero per scanline: filter "none".
    pixels
      .subarray(row * size * 4, (row + 1) * size * 4)
      .forEach((byte, at) => (raw[row * (size * 4 + 1) + 1 + at] = byte));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

const OUT = new URL("../../src/assets/icons/", import.meta.url);
await writeFile(new URL("icon.svg", OUT), adaptive);
await writeFile(new URL("icon-dark.svg", OUT), svg("#5b5b66", ""));
await writeFile(new URL("icon-light.svg", OUT), svg("#fbfbfe", ""));
for (const { suffix, color, sizes } of PNG_SETS) {
  for (const size of sizes) {
    await writeFile(new URL(`icon-${suffix}${size}.png`, OUT), png(size, rasterize(size, color)));
  }
}
const pngNames = PNG_SETS.flatMap(({ suffix, sizes }) => sizes.map((s) => `icon-${suffix}${s}.png`));
console.log(`wrote icon.svg, icon-dark.svg, icon-light.svg, ${pngNames.join(", ")}`);
console.log(`scale ${round(S)}, line ${strokeWidth}px, outer ${round(outer.w * S)}x${round(outer.h * S)}`);
