import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const size = 256;
const rgba = Buffer.alloc(size * size * 4);

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const dx = x - size / 2;
    const dy = y - size / 2;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const glow = Math.max(0, 1 - dist / 170);
    rgba[i] = Math.round(18 + 22 * glow);
    rgba[i + 1] = Math.round(19 + 30 * glow);
    rgba[i + 2] = Math.round(30 + 42 * glow);
    rgba[i + 3] = 255;
  }
}

drawCircle(128, 128, 96, [231, 191, 103, 255], 7);
drawCircle(128, 128, 68, [142, 223, 199, 255], 4);
drawDiamond(128, 128, 48, [231, 191, 103, 255]);
drawLine(80, 128, 176, 128, [243, 232, 202, 255], 5);
drawLine(128, 80, 128, 176, [243, 232, 202, 255], 5);
drawCircle(128, 128, 14, [142, 223, 199, 255], 0);

const png = makePng(size, size, rgba);
const ico = makeIco(png);
const outDir = path.resolve('build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);

function drawCircle(cx, cy, radius, color, stroke) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (stroke ? Math.abs(d - radius) <= stroke : d <= radius) blend(x, y, color);
    }
  }
}

function drawDiamond(cx, cy, radius, color) {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (Math.abs(x - cx) + Math.abs(y - cy) <= radius) blend(x, y, color);
    }
  }
}

function drawLine(x1, y1, x2, y2, color, width) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(x1 + (x2 - x1) * s / steps);
    const y = Math.round(y1 + (y2 - y1) * s / steps);
    drawCircle(x, y, width, color, 0);
  }
}

function blend(x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  const alpha = color[3] / 255;
  rgba[i] = Math.round(color[0] * alpha + rgba[i] * (1 - alpha));
  rgba[i + 1] = Math.round(color[1] * alpha + rgba[i + 1] * (1 - alpha));
  rgba[i + 2] = Math.round(color[2] * alpha + rgba[i + 2] * (1 - alpha));
  rgba[i + 3] = 255;
}

function makePng(width, height, pixels) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    scanlines[y * (width * 4 + 1)] = 0;
    pixels.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])),
    chunk('IDAT', zlib.deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function makeIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const dir = Buffer.alloc(16);
  dir[0] = 0;
  dir[1] = 0;
  dir[2] = 0;
  dir[3] = 0;
  dir.writeUInt16LE(1, 4);
  dir.writeUInt16LE(32, 6);
  dir.writeUInt32LE(png.length, 8);
  dir.writeUInt32LE(22, 12);
  return Buffer.concat([header, dir, png]);
}

function chunk(type, data) {
  const name = Buffer.from(type);
  return Buffer.concat([u32(data.length), name, data, u32(crc32(Buffer.concat([name, data])))]);
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
