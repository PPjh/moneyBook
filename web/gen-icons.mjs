/* 从用户提供的原图生成 PWA 图标（纯 Node，无第三方依赖）。
   node gen-icons.mjs [source.png]；默认使用 assets/icon-source.png。
   仅做面积采样缩放，保留原图；maskable 版加安全留白和不透明橙色底。 */
import { deflateSync, inflateSync } from 'node:zlib';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

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

/* ---------- 读取 8-bit RGB / RGBA 非交错 PNG ---------- */
function decodePNG(file) {
  if (!file.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('源图不是 PNG');
  let w, h, channels, parts = [];
  for (let p = 8; p + 12 <= file.length;) {
    const len = file.readUInt32BE(p), type = file.toString('ascii',p+4,p+8), end = p+8+len;
    if (end+4 > file.length) throw new Error('PNG 数据不完整');
    if (type === 'IHDR') {
      w = file.readUInt32BE(p+8); h = file.readUInt32BE(p+12);
      const depth = file[p+16], color = file[p+17], interlace = file[p+20];
      if (!w || !h || w > 8192 || h > 8192 || depth !== 8 || ![2,6].includes(color) || interlace) throw new Error('请使用 8-bit RGB / RGBA 非交错 PNG');
      channels = color === 6 ? 4 : 3;
    }
    if (type === 'IDAT') parts.push(file.subarray(p+8,end));
    p = end+4;
  }
  if (!channels || !parts.length) throw new Error('PNG 缺少图像数据');
  const stride = w*channels, raw = inflateSync(Buffer.concat(parts), {maxOutputLength:(stride+1)*h});
  if (raw.length !== (stride+1)*h) throw new Error('PNG 像素数据长度不正确');
  const pixels = Buffer.alloc(stride*h);
  for (let y=0;y<h;y++) {
    const filter = raw[y*(stride+1)];
    if (filter > 4) throw new Error('PNG 滤波类型不支持');
    for (let x=0;x<stride;x++) {
      const i=y*stride+x, a=x>=channels?pixels[i-channels]:0, b=y?pixels[i-stride]:0, c=y&&x>=channels?pixels[i-stride-channels]:0;
      let predict=0;
      if (filter===1) predict=a;
      if (filter===2) predict=b;
      if (filter===3) predict=Math.floor((a+b)/2);
      if (filter===4) {
        const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c);
        predict=pa<=pb&&pa<=pc?a:pb<=pc?b:c;
      }
      pixels[i]=(raw[y*(stride+1)+1+x]+predict)&255;
    }
  }
  return {w,h,channels,pixels};
}

/* 面积采样采用预乘 alpha，透明边缘不会产生黑边。 */
function drawIcon(source, size, maskable) {
  const {w,h,channels,pixels}=source, rgba=Buffer.alloc(size*size*4), bg=[255,172,47];
  const scale=(maskable?0.8:1)*size/Math.max(w,h), dw=w*scale, dh=h*scale;
  const left=(size-dw)/2, top=(size-dh)/2;
  for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const x0=(x-left)/scale, x1=(x+1-left)/scale, y0=(y-top)/scale, y1=(y+1-top)/scale;
    let alpha=0, red=0, green=0, blue=0;
    for(let sy=Math.max(0,Math.floor(y0));sy<Math.min(h,Math.ceil(y1));sy++) {
      const wy=Math.min(y1,sy+1)-Math.max(y0,sy);
      for(let sx=Math.max(0,Math.floor(x0));sx<Math.min(w,Math.ceil(x1));sx++) {
        const weight=wy*(Math.min(x1,sx+1)-Math.max(x0,sx)), i=(sy*w+sx)*channels;
        const a=(channels===4?pixels[i+3]/255:1)*weight;
        alpha+=a; red+=pixels[i]*a; green+=pixels[i+1]*a; blue+=pixels[i+2]*a;
      }
    }
    const area=(x1-x0)*(y1-y0), opacity=Math.min(1,alpha/area), i=(y*size+x)*4;
    const colors=alpha?[red/alpha,green/alpha,blue/alpha]:[0,0,0];
    for(let c=0;c<3;c++) rgba[i+c]=Math.round(maskable?colors[c]*opacity+bg[c]*(1-opacity):colors[c]);
    rgba[i+3]=maskable?255:Math.round(opacity*255);
  }
  return encodePNG(size,size,rgba);
}

const sourcePath = process.argv[2] ? resolve(process.argv[2]) : join(DIR,'assets','icon-source.png');
const source = decodePNG(readFileSync(sourcePath));
console.log(`源图：${source.w}×${source.h} ${sourcePath}`);

const jobs = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true]
];
for (const [name, size, maskable] of jobs) {
  const png = drawIcon(source, size, maskable);
  writeFileSync(join(DIR, name), png);
  console.log(`✓ ${name}  ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB  ${maskable ? 'maskable' : 'any'}`);
}
