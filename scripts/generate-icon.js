/**
 * Generate a simple 256x256 app icon PNG.
 * Creates a gradient blue/purple rounded square — placeholder until a proper icon is designed.
 *
 * Usage: node scripts/generate-icon.js
 * Output: desktop/renderer/assets/icon.png
 */

const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const SIZE = 256;

// Build raw RGBA pixel data (SIZE × SIZE × 4 bytes)
// Blue-to-purple gradient with rounded corners
const pixels = Buffer.alloc(SIZE * SIZE * 4);

const cx = SIZE / 2;
const cy = SIZE / 2;
const radius = SIZE / 2 - 8;
const cornerRadius = 40;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const idx = (y * SIZE + x) * 4;

    // Distance from center for rounded rect
    const dx = Math.max(Math.abs(x - cx) - (SIZE / 2 - cornerRadius), 0);
    const dy = Math.max(Math.abs(y - cy) - (SIZE / 2 - cornerRadius), 0);
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Alpha: 255 inside, 0 outside, smooth border
    let alpha;
    if (dist <= cornerRadius - 1.5) {
      alpha = 255;
    } else if (dist <= cornerRadius) {
      alpha = Math.round(255 * (1 - (dist - (cornerRadius - 1.5)) / 1.5));
    } else {
      alpha = 0;
    }

    // Gradient: blue (#6c8cff) → purple (#a78bfa)
    const t = y / SIZE;
    const r = Math.round(108 + t * (167 - 108));
    const g = Math.round(140 + t * (139 - 140));
    const b = Math.round(255 + t * (250 - 255));

    pixels[idx] = b;     // B
    pixels[idx + 1] = g; // G
    pixels[idx + 2] = r; // R
    pixels[idx + 3] = alpha; // A
  }
}

// ── Build PNG ──────────────────────────────────────────────────────

// Filter bytes: one filter byte (0 = None) per row, then the row's RGBA data
const filterBytes = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  const srcStart = y * SIZE * 4;
  const dstStart = y * (1 + SIZE * 4);
  filterBytes[dstStart] = 0; // filter: None
  pixels.copy(filterBytes, dstStart + 1, srcStart, srcStart + SIZE * 4);
}

const compressed = zlib.deflateSync(filterBytes);

// PNG signature
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// IHDR chunk
const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(SIZE, 0);  // width
ihdrData.writeUInt32BE(SIZE, 4);  // height
ihdrData[8] = 8;   // bit depth
ihdrData[9] = 6;   // color type: RGBA
ihdrData[10] = 0;  // compression
ihdrData[11] = 0;  // filter
ihdrData[12] = 0;  // interlace

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeB, data]);

  // CRC32
  let crc = 0xffffffff;
  for (let i = 0; i < crcData.length; i++) {
    crc ^= crcData[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  crc ^= 0xffffffff;

  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([len, typeB, data, crcBuf]);
}

const ihdr = makeChunk("IHDR", ihdrData);
const idat = makeChunk("IDAT", compressed);
const iend = makeChunk("IEND", Buffer.alloc(0));

const png = Buffer.concat([signature, ihdr, idat, iend]);

const outPath = path.join(__dirname, "..", "desktop", "renderer", "assets", "icon.png");
fs.writeFileSync(outPath, png);
console.log(`Icon written to ${outPath} (${png.length} bytes)`);
