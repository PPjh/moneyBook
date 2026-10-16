/* 生成应用图标（纯 Node，无第三方依赖）：node gen-icons.mjs
   产出 icon-192.png / icon-512.png（圆角，any）与 icon-maskable-512.png（满幅，maskable） */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

/* ---------- 最小 PNG 编码器 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- 有向距离场绘制 ---------- */
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const cov = (d) => Math.max(0, Math.min(1, 0.5 - d));

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function drawIcon(S, maskable) {
  const bg1 = hex('#17b8a6'), bg2 = hex('#0b5f59');
  const radius = maskable ? 0 : S * 0.235;
  const scale = maskable ? 0.76 : 1;
  const g = (v) => S / 2 + (v - 0.5) * S * scale;
  const stroke = S * 0.075 * scale;

  // ¥ 字形：竖 + 两撇 + 两横
  const segs = [
    [0.500, 0.280, 0.500, 0.740],
    [0.322, 0.280, 0.500, 0.500],
    [0.678, 0.280, 0.500, 0.500],
    [0.350, 0.545, 0.650, 0.545],
    [0.350, 0.655, 0.650, 0.655]
  ].map(([x1, y1, x2, y2]) => [g(x1), g(y1), g(x2), g(y2)]);

  const buf = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    const t = S > 1 ? y / (S - 1) : 0;
    const br = bg1[0] + (bg2[0] - bg1[0]) * t;
    const bg = bg1[1] + (bg2[1] - bg1[1]) * t;
    const bb = bg1[2] + (bg2[2] - bg1[2]) * t;
    for (let x = 0; x < S; x++) {
      const px = x + 0.5, py = y + 0.5;
      const aBg = cov(sdRoundRect(px, py, S / 2, S / 2, S / 2, S / 2, radius));
      let aFg = 0;
      for (const [x1, y1, x2, y2] of segs) {
        const a = cov(sdSeg(px, py, x1, y1, x2, y2) - stroke / 2);
        if (a > aFg) aFg = a;
      }
      const i = (y * S + x) * 4;
      buf[i]     = Math.round(br + (255 - br) * aFg);
      buf[i + 1] = Math.round(bg + (255 - bg) * aFg);
      buf[i + 2] = Math.round(bb + (255 - bb) * aFg);
      buf[i + 3] = Math.round(aBg * 255);
    }
  }
  return encodePNG(S, S, buf);
}

const jobs = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true]
];
for (const [name, size, maskable] of jobs) {
  const png = drawIcon(size, maskable);
  writeFileSync(join(DIR, name), png);
  console.log(`✓ ${name}  ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB  ${maskable ? 'maskable' : 'any'}`);
}
