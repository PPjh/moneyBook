/* 轻记账 · 打包（零依赖）
   用法： node build.mjs
   产出： dist/ —— 只含部署必需的 6 个文件，可直接拖到 GitHub Pages / Cloudflare Pages / Netlify Drop */
import { mkdirSync, copyFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const DIST = join(DIR, 'dist');

/* 部署只需要这些；check.mjs / serve.mjs / 截图 / README 都不用上传 */
const FILES = [
  'index.html',
  'manifest.json',
  'sw.js',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png'
];

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

let total = 0;
for (const f of FILES) {
  const src = join(DIR, f);
  if (!existsSync(src)) { console.error('✗ 缺少文件：' + f); process.exit(1); }
  copyFileSync(src, join(DIST, f));
  const kb = statSync(src).size / 1024;
  total += kb;
  console.log(`  ✓ ${f.padEnd(24)} ${kb.toFixed(1)} KB`);
}

/* 让 GitHub Pages 跳过 Jekyll 处理：更快，也免得被模板语法误伤 */
writeFileSync(join(DIST, '.nojekyll'), '');

console.log(`\n✓ dist/ 已生成，共 ${FILES.length + 1} 个文件、${total.toFixed(1)} KB\n`);
console.log('接下来：');
console.log('  · GitHub Pages   → 新建仓库 → 把 dist 里的文件拖进上传页 → Settings / Pages / 选 main 分支');
console.log('  · Cloudflare Pages 或 Netlify Drop → 直接把 dist 文件夹拖进去');
console.log('  · 拿到 https:// 地址后用手机打开 → 浏览器菜单「安装应用」\n');
