// 把生成的 .cube 套到测试色卡上,输出 PNG 对比图(纯 Node,无第三方依赖)
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const LUT_DIR = 'D:\\pojia\\mediastorm_re\\luts';
const OUT = 'D:\\pojia\\mediastorm_re\\luts\\preview.png';

// ---------- 最小 PNG 编码器 ----------
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function writePNG(file, w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}

// ---------- 读 .cube ----------
function loadCube(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const lines = txt.split(/\r?\n/);
  let size = 0;
  const vals = [];
  for (const L of lines) {
    if (!L || L.startsWith('#') || L.startsWith('TITLE')) continue;
    if (L.startsWith('LUT_3D_SIZE')) { size = parseInt(L.split(/\s+/)[1]); continue; }
    if (L.startsWith('DOMAIN')) continue;
    const p = L.trim().split(/\s+/).map(Number);
    if (p.length === 3 && p.every((v) => !isNaN(v))) vals.push(p);
  }
  return { size, vals };
}

function sample(cube, r, g, b) {
  const { size, vals } = cube;
  const n = size - 1;
  const ir = Math.round(r * n), ig = Math.round(g * n), ib = Math.round(b * n);
  const idx = ir * size * size + ig * size + ib;
  const v = vals[idx] || [r, g, b];
  return [Math.round(v[0] * 255), Math.round(v[1] * 255), Math.round(v[2] * 255)];
}

// ---------- 测试色板 ----------
const SWATCHES = [
  // 灰阶
  [0.03, 0.03, 0.03], [0.10, 0.10, 0.10], [0.20, 0.20, 0.20], [0.32, 0.32, 0.32],
  [0.45, 0.45, 0.45], [0.58, 0.58, 0.58], [0.70, 0.70, 0.70], [0.82, 0.82, 0.82],
  [0.92, 0.92, 0.92], [0.98, 0.98, 0.98],
  // 肤色
  [0.85, 0.66, 0.55], [0.72, 0.53, 0.42], [0.55, 0.38, 0.30],
  // 天空/植被/红/黄/品红/青
  [0.28, 0.45, 0.75], [0.20, 0.42, 0.22], [0.62, 0.14, 0.12], [0.85, 0.72, 0.16],
  [0.55, 0.20, 0.45], [0.15, 0.55, 0.60], [0.45, 0.30, 0.16],
];

const W_SW = 56, H_SW = 44;
const ROWS = ['__ORIGINAL__'].concat(
  fs.readdirSync(path.join(LUT_DIR, 'leica')).filter((f) => f.endsWith('.cube')).map((f) => 'leica/' + f),
  fs.readdirSync(path.join(LUT_DIR, 'fuji')).filter((f) => f.endsWith('.cube')).map((f) => 'fuji/' + f),
);

const W = W_SW * SWATCHES.length;
const H = H_SW * ROWS.length;
const img = Buffer.alloc(W * H * 3);

ROWS.forEach((row, ri) => {
  const cube = row === '__ORIGINAL__' ? null : loadCube(path.join(LUT_DIR, row));
  for (let si = 0; si < SWATCHES.length; si++) {
    const [r, g, b] = SWATCHES[si];
    let px;
    if (cube) px = sample(cube, r, g, b);
    else px = [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    for (let y = 0; y < H_SW; y++) {
      for (let x = 0; x < W_SW; x++) {
        const o = ((ri * H_SW + y) * W + si * W_SW + x) * 3;
        img[o] = px[0]; img[o + 1] = px[1]; img[o + 2] = px[2];
      }
    }
  }
});

writePNG(OUT, W, H, img);
console.log(`preview: ${OUT}  ${W}x${H}  rows=${ROWS.length}`);
ROWS.forEach((r, i) => console.log(`  row ${String(i).padStart(2)}: ${r}`));
