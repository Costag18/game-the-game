// One-off generator for the 4 finale 1v1 game previews (Pentago, Lights Out,
// Quoridor, Liar's Market). Hand-rolls themed 480x300 PNGs (RGB, no deps) so each
// game card has a preview consistent with the rest of the catalog.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const W = 480, H = 300;

function canvas() { return Buffer.alloc(W * H * 3); }
function px(buf, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
}
function rect(buf, x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(buf, x, y, c);
}
function vgrad(buf, top, bot) {
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    const c = [Math.round(top[0] + (bot[0] - top[0]) * t), Math.round(top[1] + (bot[1] - top[1]) * t), Math.round(top[2] + (bot[2] - top[2]) * t)];
    for (let x = 0; x < W; x++) px(buf, x, y, c);
  }
}
function disc(buf, cx, cy, rad, c) {
  for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) {
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy <= rad * rad) px(buf, x, y, c);
  }
}

function encode(buf) {
  // add filter byte 0 per row
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    buf.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const crcTable = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const outDir = path.join(__dirname, '..', 'client', 'src', 'assets', 'gamepreviews');

// ---- Pentago: 6x6 board, 4 quadrants, black/white marbles ----
function pentago() {
  const b = canvas();
  vgrad(b, [42, 28, 70], [18, 14, 40]);
  const ox = 120, oy = 30, cell = 38, gap = 8;
  for (let q = 0; q < 4; q++) {
    const qx = ox + (q % 2) * (cell * 3 + gap);
    const qy = oy + Math.floor(q / 2) * (cell * 3 + gap);
    rect(b, qx - 4, qy - 4, cell * 3 + 8, cell * 3 + 8, [90, 70, 140]);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) rect(b, qx + c * cell + 2, qy + r * cell + 2, cell - 4, cell - 4, [30, 22, 56]);
  }
  const marbles = [[0, 0, 1], [1, 1, 0], [2, 0, 0], [0, 2, 1], [2, 2, 0], [1, 2, 1], [3, 1, 0]];
  function cc(qi, ci) { const qx = ox + (qi % 2) * (cell * 3 + gap); const cx = qx + ci * cell + cell / 2; return cx; }
  function rcy(qi, ri) { const qy = oy + Math.floor(qi / 2) * (cell * 3 + gap); return qy + ri * cell + cell / 2; }
  for (const [q, idx, col] of marbles) { const ci = idx % 3, ri = Math.floor(idx / 3) % 3; disc(b, cc(q, ci), rcy(q, ri), 13, col ? [240, 240, 245] : [20, 20, 26]); }
  return b;
}

// ---- Lights Out: 5x5 neon grid, some lit ----
function lightsOut() {
  const b = canvas();
  vgrad(b, [6, 24, 20], [2, 8, 10]);
  const ox = 130, oy = 30, cell = 44;
  const lit = new Set([0, 2, 6, 7, 8, 11, 13, 18, 20, 24]);
  for (let i = 0; i < 25; i++) {
    const r = Math.floor(i / 5), c = i % 5;
    const x = ox + c * cell, y = oy + r * cell;
    rect(b, x + 3, y + 3, cell - 6, cell - 6, lit.has(i) ? [40, 240, 140] : [16, 40, 38]);
    if (lit.has(i)) rect(b, x + 10, y + 10, cell - 20, cell - 20, [180, 255, 210]);
  }
  return b;
}

// ---- Quoridor: 9x9 board, two pawns, a couple of walls ----
function quoridor() {
  const b = canvas();
  vgrad(b, [60, 40, 22], [30, 18, 8]);
  const ox = 135, oy = 24, cell = 26;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) rect(b, ox + c * cell + 1, oy + r * cell + 1, cell - 2, cell - 2, [210, 180, 130]);
  // walls (brown segments in the gutters)
  rect(b, ox + 2 * cell - 2, oy + 1 * cell + 2, 4, cell * 2 - 4, [90, 55, 25]);
  rect(b, ox + 4 * cell + 2, oy + 5 * cell - 2, cell * 2 - 4, 4, [90, 55, 25]);
  rect(b, ox + 6 * cell - 2, oy + 6 * cell + 2, 4, cell * 2 - 4, [90, 55, 25]);
  // pawns
  disc(b, ox + 4 * cell + cell / 2, oy + 0 * cell + cell / 2, 9, [40, 110, 230]);
  disc(b, ox + 4 * cell + cell / 2, oy + 8 * cell + cell / 2, 9, [230, 120, 40]);
  return b;
}

// ---- Liar's Market: hidden-value bluff — price bars + a face-down card ----
function liarsMarket() {
  const b = canvas();
  vgrad(b, [60, 16, 30], [24, 8, 14]);
  // gold price bars
  const bx = 60, by = 240;
  const bars = [70, 120, 90, 160, 110, 200];
  for (let i = 0; i < bars.length; i++) rect(b, bx + i * 34, by - bars[i], 24, bars[i], [230, 190, 80]);
  // face-down "secret value" card
  rect(b, 320, 70, 110, 150, [20, 12, 18]);
  rect(b, 328, 78, 94, 134, [150, 40, 70]);
  rect(b, 356, 120, 38, 50, [240, 210, 120]);
  disc(b, 375, 110, 16, [240, 210, 120]);
  return b;
}

const games = { pentago, lightsOut, quoridor, liarsMarket };
for (const [name, fn] of Object.entries(games)) {
  const out = path.join(outDir, `${name}.png`);
  fs.writeFileSync(out, encode(fn()));
  console.log('wrote', out);
}
