// Generates assets/icon.ico (32x32, 32bpp) without any dependency:
// a dark rounded tile with three green fader bars and their knobs.
//   node scripts/make-icon.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = 32;

// BGRA helpers
const BG = [0x29, 0x20, 0x1a, 0xff]; // #1a2029
const BAR = [0x71, 0xcc, 0x2e, 0xff]; // #2ecc71
const KNOB = [0xf2, 0xe9, 0xdf, 0xff]; // #dfe9f2
const NONE = [0, 0, 0, 0];

const px = new Array(S * S).fill(NONE);
const put = (x, y, c) => {
  if (x >= 0 && x < S && y >= 0 && y < S) px[y * S + x] = c;
};
const rect = (x0, y0, x1, y1, c) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, c);
};

// Rounded background tile
const R = 7;
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const cx = x < R ? R - 1 : x > S - 1 - R ? S - R : x;
    const cy = y < R ? R - 1 : y > S - 1 - R ? S - R : y;
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy <= (R - 1) * (R - 1) || (x >= R - 1 && x <= S - R) || (y >= R - 1 && y <= S - R)) {
      put(x, y, BG);
    }
  }
}

// Three fader tracks + knobs (knob y = fader position)
const bars = [
  { x: 7, knobY: 12 },
  { x: 14, knobY: 8 },
  { x: 21, knobY: 17 },
];
for (const b of bars) {
  rect(b.x, 6, b.x + 3, 25, [0x14, 0x0f, 0x0b, 0xff]); // track #0b0f14
  rect(b.x, b.knobY + 2, b.x + 3, 25, BAR); // filled level
  rect(b.x - 1, b.knobY - 1, b.x + 4, b.knobY + 1, KNOB); // knob
}

// Build ICO: header + dir entry + (BITMAPINFOHEADER + XOR bottom-up + AND mask)
const xorSize = S * S * 4;
const andSize = (S * S) / 8;
const bmpSize = 40 + xorSize + andSize;

const buf = Buffer.alloc(6 + 16 + bmpSize);
let o = 0;
buf.writeUInt16LE(0, o); o += 2; // reserved
buf.writeUInt16LE(1, o); o += 2; // type: icon
buf.writeUInt16LE(1, o); o += 2; // count
buf.writeUInt8(S, o++); // width
buf.writeUInt8(S, o++); // height
buf.writeUInt8(0, o++); // colors
buf.writeUInt8(0, o++); // reserved
buf.writeUInt16LE(1, o); o += 2; // planes
buf.writeUInt16LE(32, o); o += 2; // bpp
buf.writeUInt32LE(bmpSize, o); o += 4; // bytes in resource
buf.writeUInt32LE(22, o); o += 4; // offset

buf.writeUInt32LE(40, o); o += 4; // biSize
buf.writeInt32LE(S, o); o += 4; // width
buf.writeInt32LE(S * 2, o); o += 4; // height (XOR + AND)
buf.writeUInt16LE(1, o); o += 2; // planes
buf.writeUInt16LE(32, o); o += 2; // bpp
buf.writeUInt32LE(0, o); o += 4; // compression
buf.writeUInt32LE(xorSize + andSize, o); o += 4; // image size
o += 16; // rest zero

for (let y = S - 1; y >= 0; y--) {
  for (let x = 0; x < S; x++) {
    const [b, g, r, a] = px[y * S + x];
    buf.writeUInt8(b, o++);
    buf.writeUInt8(g, o++);
    buf.writeUInt8(r, o++);
    buf.writeUInt8(a, o++);
  }
}
// AND mask: all zero (alpha channel drives transparency)

fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
const out = path.join(ROOT, 'assets', 'icon.ico');
fs.writeFileSync(out, buf);
console.log(`Wrote ${out} (${buf.length} bytes)`);
