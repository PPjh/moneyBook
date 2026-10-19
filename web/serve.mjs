/* 轻记账 · 局域网静态服务器（零依赖）
   用法： node serve.mjs [端口] [目录]
   然后在同一 WiFi 下的安卓手机上打开提示的地址即可。 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { networkInterfaces } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.argv[3] || HERE);
let PORT = Number(process.argv[2]) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function safePath(urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const full = normalize(join(ROOT, p));
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  return full;
}

const server = createServer(async (req, res) => {
  try {
    let file = safePath(req.url || '/');
    if (!file) { res.writeHead(403).end('403'); return; }

    let info = await stat(file).catch(() => null);
    if (info && info.isDirectory()) {
      file = join(file, 'index.html');
      info = await stat(file).catch(() => null);
    }
    if (!info || !info.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 Not Found'); return; }

    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    const noStore = /(^|[\\/])(sw\.js|index\.html)$/i.test(file) || extname(file) === '';
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': type,
      'content-length': body.length,
      'cache-control': noStore ? 'no-store, must-revalidate' : 'public, max-age=3600'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('500 ' + e.message);
  }
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && PORT < 8100) {
    console.log(`端口 ${PORT} 被占用，换 ${PORT + 1} 试试…`);
    PORT += 1;
    setTimeout(() => server.listen(PORT, '0.0.0.0'), 120);
  } else {
    console.error('启动失败：', e.message);
    process.exit(1);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  console.log('\n  轻记账 · 本地服务器已启动\n');
  console.log(`  目录： ${ROOT}`);
  console.log(`  本机： http://localhost:${PORT}/`);
  for (const ip of ips) console.log(`  手机： http://${ip}:${PORT}/   ← 手机连同一 WiFi 后打开这个`);
  console.log('\n  手机 Chrome 打开后：菜单 → 「添加到主屏幕 / 安装应用」');
  console.log('  按 Ctrl+C 停止。\n');
});
