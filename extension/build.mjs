// Builds the unpacked extension into dist/: bundles the scripts, copies static files, draws the icons.
//   node build.mjs           one build
//   node build.mjs --watch   rebuild on change
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/icons", { recursive: true });
cpSync("static", "dist", { recursive: true });
for (const size of [16, 48, 128]) writeFileSync(`dist/icons/${size}.png`, icon(size));

const options = {
  entryPoints: ["src/background.ts", "src/content.ts", "src/popup.ts", "src/options.ts"],
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  logLevel: "info",
};
if (watch) await (await esbuild.context(options)).watch();
else await esbuild.build(options);

// --- icon: a blue rounded square with a white check mark, as a PNG -------------------------------

function icon(size) {
  const px = new Uint8Array(size * size * 4);
  const r = size * 0.22;
  const check = [
    [0.27, 0.53],
    [0.43, 0.69],
    [0.74, 0.34],
  ].map(([x, y]) => [x * size, y * size]);
  const stroke = size * 0.09;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const inside = roundedRectCoverage(cx, cy, size, r);
      if (inside <= 0) continue;
      const d = Math.min(segment(cx, cy, check[0], check[1]), segment(cx, cy, check[1], check[2]));
      const white = Math.max(0, Math.min(1, stroke - d + 0.5));
      const i = (y * size + x) * 4;
      px[i] = Math.round(37 + (255 - 37) * white);
      px[i + 1] = Math.round(99 + (255 - 99) * white);
      px[i + 2] = Math.round(235 + (255 - 235) * white);
      px[i + 3] = Math.round(255 * inside);
    }
  }
  return png(size, px);
}

function roundedRectCoverage(x, y, size, r) {
  const dx = Math.max(r - x, 0, x - (size - r));
  const dy = Math.max(r - y, 0, y - (size - r));
  return Math.max(0, Math.min(1, r - Math.hypot(dx, dy) + 0.5));
}

function segment(px, py, [ax, ay], [bx, by]) {
  const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
