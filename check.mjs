/* 轻记账 · 自检脚本（零依赖）
   用法： node check.mjs
   做法：把 index.html 里的真实脚本放进一个极小的 DOM 桩里执行，
        既验证纯函数，也把「记账 → 编辑 → 删除 → 统计 → 解锁」整条链路走一遍。
        任何一处抛错或结果不符都会失败并返回非 0 退出码。 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const DIR = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(DIR, 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('✗ 没找到 <script> 块'); process.exit(1); }
const script = m[1];
const appVersion = (script.match(/var APP_VERSION = '([^']+)'/) || [])[1];
const markup = html.slice(0, html.indexOf('<script>'));

/** 按真实 HTML 建立静态元素表（含 hidden 初值），保证桩与页面一致 */
function seedStatic(markup, els) {
  for (const t of markup.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
    const idm = t[2].match(/\bid="([^"]+)"/);
    if (!idm) continue;
    const el = els.get(idm[1]);
    el.tagName = t[1].toLowerCase();
    if (/(^|\s)hidden(\s|$)/.test(t[2])) el.hidden = true;
  }
}

/* ---------------- DOM 桩 ---------------- */
function makeEl(id) {
  const cls = new Set();
  return {
    id, value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
    scrollTop: 0, dataset: {}, style: {}, onclick: null, onchange: null, children: [],
    _h: {},
    classList: {
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
      contains: (c) => cls.has(c),
      toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; on ? cls.add(c) : cls.delete(c); return on; }
    },
    addEventListener(type, fn) { this._h[type] = fn; },
    setAttribute() {}, removeAttribute() {}, focus() {}, blur() {}, appendChild() {},
    closest() { return null; }, querySelectorAll() { return []; }
  };
}

/** 元素表：取不到就现造一个（真实浏览器里这些元素本来就一直在 DOM 中） */
class ElMap extends Map {
  get(id) { if (!this.has(id)) this.set(id, makeEl(id)); return super.get(id); }
}

function makeStorage(mode, seed) {
  const box = new Map(Object.entries(seed || {}));
  if (mode === 'throw') {
    const boom = () => { throw new Error('storage denied'); };
    return { getItem: boom, setItem: boom, removeItem: boom, _map: box };
  }
  return {
    _map: box,
    getItem(k) { return box.has(k) ? box.get(k) : null; },
    setItem(k, v) { if(this.failWrites) throw new Error('quota exceeded'); box.set(k, String(v)); },
    removeItem(k) { box.delete(k); }
  };
}

function runApp({ storageMode = 'ok', seed = {}, hash = '', loc = {}, standalone = false, secureContext } = {}) {
  const els = new ElMap();
  seedStatic(markup, els);
  const created = [];
  const blobs = [];      // URL.createObjectURL 拿到的 Blob
  const files = [];      // a.click() 触发的“下载”
  const alerts = [];
  const storage = makeStorage(storageMode, seed);
  const docHandlers = {};

  const BlobStub = function (parts, opts) { this._text = (parts || []).join(''); this.type = (opts && opts.type) || ''; };
  const URLStub = {
    createObjectURL(b) { blobs.push(b); return 'blob:stub/' + blobs.length; },
    revokeObjectURL() {}
  };

  const documentShim = {
    title: '', hidden: false,
    documentElement: { dataset:{} },
    body: { dataset: {}, appendChild(el) { created.push(el); } },
    getElementById(id) { return els.get(id); },
    querySelectorAll() { return []; },
    createElement(tag) {
      return { tagName: tag, id: '', textContent: '', download: '', href: '',
               click() { files.push({ name: this.download, href: this.href }); } };
    },
    addEventListener(type, fn) { docHandlers[type] = fn; },
    _h: docHandlers
  };
  const windowShim = {
    _h: {}, addEventListener(type, fn) { this._h[type] = fn; },
    matchMedia: (q) => ({ matches: !!standalone && /display-mode/.test(String(q)) }),
    navigator: { standalone: false },
    isSecureContext: secureContext
  };
  const locationShim = {
    hash, href: (loc.protocol || 'file:') + '//' + (loc.hostname || '') + '/',
    protocol: loc.protocol || 'file:', hostname: loc.hostname || '', pathname: '/index.html',
    reloadCount: 0, reload() { this.reloadCount++; }
  };
  const historyShim = { replaceState() {} };

  const runner = new Function(
    'window', 'document', 'location', 'localStorage', 'navigator', 'history', 'confirm', 'alert', 'fetch', 'Blob', 'URL',
    script
  );
  runner(windowShim, documentShim, locationShim, storage, {}, historyShim, () => windowShim.confirmResult !== false,
         (m) => { alerts.push(String(m)); }, undefined, BlobStub, URLStub);
  return { els, created, storage, windowShim, documentShim, docHandlers, blobs, files, alerts, locationShim };
}

/** 触发通过 addEventListener 绑定的处理器；target 用来模拟 e.target.closest(...) */
function fire(el, type, dataset) {
  const h = el._h && el._h[type];
  if (!h) throw new Error('元素 #' + el.id + ' 未绑定 ' + type);
  const t = { dataset: dataset || {}, closest: () => t };
  h({ target: t });
}
const fireDoc = (app, type) => { const h = app.docHandlers[type]; if (h) h(); };
/** 触发 addEventListener('input') 的处理器（内部用 this.value） */
function fireInput(el) { if (el._h && el._h.input) el._h.input.call(el); }

/* ---------------- 断言 ---------------- */
let pass = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) { pass++; return true; }
  fails.push(name + (extra !== undefined ? '  →  ' + extra : ''));
  return false;
}
function eq(a, b, name) { return ok(JSON.stringify(a) === JSON.stringify(b), name, JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); }
function step(name, fn) { try { fn(); pass++; } catch (e) { fails.push(name + ' 抛错：' + e.message); } }
const recs = (app) => JSON.parse(app.storage.getItem('jz.records.v1') || '[]');
const cfgOf = (app) => JSON.parse(app.storage.getItem('jz.config.v1') || '{}');
const todayLocal = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

/* =========== 1. localStorage 被禁用时也要能跑（降级到内存） =========== */
let app1 = null;
step('localStorage 被禁时启动', () => { app1 = runApp({ storageMode: 'throw', hash: '#selftest' }); });
if (app1) {
  const pre = app1.created.find((el) => el.id === '__selftest');
  const txt = pre ? String(pre.textContent) : '(未生成自检结果)';
  ok(/^SELFTEST PASS/.test(txt), '内置纯函数自检（26 项）', txt.split('\n').slice(0, 8).join(' | '));
}

/* =========== 2. 完整记账链路 =========== */
let app = null;
step('主流程启动', () => { app = runApp({ storageMode: 'ok' }); });
if (app) {
  const { els } = app;
  ok(els.get('lock').hidden === true, '未设密码时不显示锁屏');
  eq(els.get('mlabel').textContent, new Date().getFullYear() + '年' + (new Date().getMonth() + 1) + '月', '默认显示本月');

  step('记一笔支出', () => {
    els.get('fab').onclick();
    els.get('amt').value = '25.5';
    els.get('date').value = '2025-07-04';
    els.get('note').value = '午饭 加个鸡腿';
    els.get('sheetSave').onclick();
  });
  const r1 = recs(app);
  eq(r1.length, 1, '落盘 1 条记录');
  eq(r1[0] && r1[0].amount, 2550, '金额按分存储（25.5 → 2550）');
  eq(r1[0] && r1[0].type, 'expense', '默认类型为支出');
  eq(r1[0] && r1[0].cat, '餐饮', '默认分类为餐饮');
  eq(r1[0] && r1[0].date, '2025-07-04', '日期写入正确');
  eq(r1[0] && r1[0].note, '午饭 加个鸡腿', '备注写入正确');

  eq(els.get('mlabel').textContent, '2025年7月', '月份跟随记录日期跳转');
  ok(/25\.50/.test(els.get('sumExp').innerHTML), '汇总卡显示本月支出 25.50', els.get('sumExp').innerHTML);
  eq(els.get('sumCnt').textContent, 1, '汇总卡笔数 = 1');
  eq(els.get('sumInc').textContent, '0.00', '收入仍为 0.00');
  ok(/餐饮/.test(els.get('listBox').innerHTML), '明细列表出现分类');
  ok(/午饭/.test(els.get('listBox').innerHTML), '明细列表出现备注');
  ok(/25\.50/.test(els.get('listBox').innerHTML), '明细列表出现金额');
  ok(/今天|昨天|月/.test(els.get('listBox').innerHTML), '明细按天分组显示日期');

  eq(els.get('stTotal').textContent, '25.50', '统计页 · 本月合计');
  eq(els.get('stTop').textContent, '餐饮', '统计页 · 最多的一类');
  eq(els.get('stAvg').textContent, '0.82', '统计页 · 日均（25.50 ÷ 31）');
  eq(els.get('stMoM').textContent, '—', '统计页 · 无上月数据时显示 —');
  ok(/<circle/.test(els.get('donutCard').innerHTML), '环形图生成 SVG 扇形');
  ok(/餐饮/.test(els.get('donutCard').innerHTML), '环形图列出分类');
  ok(/餐饮/.test(els.get('rankBox').innerHTML), '排行渲染出分类');
  ok(/width:100\.0%/.test(els.get('rankBox').innerHTML), '单一分类占比 100%');
  eq((els.get('trendBox').innerHTML.match(/tcol/g) || []).length, 6, '趋势图固定 6 个月');

  step('记一笔收入', () => {
    els.get('fab').onclick();
    fire(els.get('typeSeg'), 'click', { type: 'income' });
    fire(els.get('cats'), 'click', { cat: '工资' });
    els.get('amt').value = '8000';
    els.get('date').value = '2025-07-10';
    els.get('sheetSave').onclick();
  });
  const r2 = recs(app);
  eq(r2.length, 2, '落盘 2 条记录');
  eq(r2[1] && r2[1].type, 'income', '第二笔为收入');
  eq(r2[1] && r2[1].cat, '工资', '选中分类生效');
  eq(els.get('sumInc').textContent, '8,000.00', '汇总卡收入 8,000.00', els.get('sumInc').textContent);
  eq(els.get('sumBal').textContent, '7,974.50', '汇总卡结余', els.get('sumBal').textContent);
  eq(els.get('sumCnt').textContent, 2, '笔数累加到 2');
  step('统计页切到收入', () => fire(els.get('statSeg'), 'click', { type: 'income' }));
  eq(els.get('stTotal').textContent, '8,000.00', '统计页收入合计');
  eq(els.get('stTop').textContent, '工资', '统计页收入最多的一类');
  ok(/工资/.test(els.get('rankBox').innerHTML), '收入排行渲染');

  step('编辑记录', () => {
    fire(els.get('listBox'), 'click', { id: r2[0].id });
    eq(els.get('sheetTitle').textContent, '编辑记录', '面板标题变为「编辑记录」');
    eq(els.get('amt').value, '25.50', '编辑时回填金额');
    eq(els.get('note').value, '午饭 加个鸡腿', '编辑时回填备注');
    eq(els.get('sheetDelete').hidden, false, '编辑时显示删除按钮');
    els.get('amt').value = '30';
    els.get('note').value = '改成 30';
    els.get('sheetSave').onclick();
  });
  const r3 = recs(app);
  eq(r3.length, 2, '编辑不新增记录');
  eq(r3[0].amount, 3000, '编辑后金额更新为 3000');
  eq(r3[0].note, '改成 30', '编辑后备注更新');

  step('删除记录', () => {
    fire(els.get('listBox'), 'click', { id: r3[1].id });
    els.get('sheetDelete').onclick();
  });
  const r4 = recs(app);
  eq(r4.length, 1, '删除后剩 1 条');
  eq(els.get('sumInc').textContent, '0.00', '删除收入后汇总刷新');

  step('月份导航', () => {
    els.get('prevM').onclick();
    eq(els.get('mlabel').textContent, '2025年6月', '上一月按钮');
    ok(/还没有记录/.test(els.get('listBox').innerHTML), '空月份显示空状态');
    els.get('nextM').onclick();
    eq(els.get('mlabel').textContent, '2025年7月', '下一月按钮');
    els.get('todayBtn').onclick();
    eq(els.get('mlabel').textContent, new Date().getFullYear() + '年' + (new Date().getMonth() + 1) + '月', '「今天」回到本月');
  });

  step('切换底部导航', () => {
    fire(els.get('tabbar'), 'click', { view: 'stats' });
    eq(els.get('v-stats').classList.contains('active'), true, '统计页被激活');
    fire(els.get('tabbar'), 'click', { view: 'me' });
    eq(els.get('v-me').classList.contains('active'), true, '我的页被激活');
    eq(els.get('meCount').textContent, 1, '我的页显示累计笔数');
    eq(els.get('meDays').textContent, 1, '我的页显示记账天数');
  });

  step('从设置页开启密码锁', () => {
    els.get('pinSwitch').onclick();
    eq(els.get('lock').hidden, false, '进入设置密码界面');
    eq(els.get('lockTitle').textContent, '设置密码', '标题为设置密码');
    for (const k of ['1', '2', '3', '4']) fire(els.get('pad'), 'click', { k });
    fire(els.get('pad'), 'click', { k: 'ok' });
    eq(els.get('lockTitle').textContent, '确认密码', '第一步确认后要求再次输入');
    for (const k of ['1', '2', '3', '4']) fire(els.get('pad'), 'click', { k });
  });
  await new Promise((r) => setTimeout(r, 160));
  ok(cfgOf(app).pin && typeof cfgOf(app).pin.hash === 'string' && cfgOf(app).pin.salt, '密码以加盐哈希保存，不存明文');
  eq(els.get('lock').hidden, true, '设置完成后自动解锁进入应用');
  eq(els.get('pinSwitch').classList.contains('on'), true, '开关变为开启状态');

  step('清空数据（二次确认）', () => {
    els.get('clearRow').onclick();
    eq(recs(app).length, 0, '确认后数据被清空');
  });
}

/* =========== 3. 密码锁：启动即锁 + 输对密码解锁 =========== */
{
  const probe = runApp({ storageMode: 'ok', hash: '#selftest' });
  const hash = probe.windowShim.__jz.pinHash('1234', 'salt-xyz');
  const seed = {
    'jz.config.v1': JSON.stringify({ pin: { salt: 'salt-xyz', hash, len: 4 }, lockDelay: 0, lastCat: { expense: '餐饮', income: '工资' } })
  };
  let locked = null;
  step('带密码启动', () => { locked = runApp({ storageMode: 'ok', seed }); });
  if (locked) {
    const e = locked.els;
    eq(e.get('lock').hidden, false, '启动即显示锁屏');
    eq(e.get('lockTitle').textContent, '输入密码', '锁屏标题');
    ok(/4 位数字/.test(e.get('lockHint').textContent), '锁屏提示位数');
    eq((e.get('lockDots').innerHTML.match(/class="dot/g) || []).length, 4, '渲染 4 个圆点');
    eq((e.get('pad').innerHTML.match(/<button/g) || []).length, 12, '键盘 12 键（0–9 + 删除 + 占位）');
    eq((e.get('pad').innerHTML.match(/data-k="1"/g) || []).length, 1, '键盘含数字键');

    step('输入错误密码', () => {
      for (const k of ['9', '9', '9', '9']) fire(e.get('pad'), 'click', { k });
    });
    await new Promise((r) => setTimeout(r, 160));
    eq(e.get('lock').hidden, false, '密码错误仍锁着');
    ok(/不正确/.test(e.get('lockHint').textContent), '提示密码不正确', e.get('lockHint').textContent);

    step('输入正确密码', () => {
      for (const k of ['1', '2', '3', '4']) fire(e.get('pad'), 'click', { k });
    });
    await new Promise((r) => setTimeout(r, 160));
    eq(e.get('lock').hidden, true, '密码正确后解锁');
    eq((e.get('lockDots').innerHTML.match(/dot f/g) || []).length, 0, '解锁后圆点全部清空');

    step('切到后台再回来（锁定延时 0 = 立即）', () => {
      locked.documentShim.hidden = true; fireDoc(locked, 'visibilitychange');
      locked.documentShim.hidden = false; fireDoc(locked, 'visibilitychange');
    });
    eq(e.get('lock').hidden, false, '回到前台自动重新加锁');
  }
}

/* =========== 4. HTML 结构与 CSS 一致性 =========== */
{
  const ids = new Set([...markup.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]));
  const used = new Set([...script.matchAll(/\$\('([^']+)'\)/g)].map((x) => x[1]));
  const missing = [...used].filter((u) => !ids.has(u));
  ok(missing.length === 0, "脚本中 $('id') 引用的元素都存在于 HTML", missing.join(', '));
  ok(['list', 'stats', 'me'].every((v) => ids.has('v-' + v)), '三个视图容器齐全');
  const navViews = new Set([...markup.matchAll(/data-view="([^"]+)"/g)].map((x) => x[1]));
  ok(['list', 'stats', 'me'].every((v) => navViews.has(v)), '底部导航含三个入口');
  ok(/<meta name="viewport"[^>]*viewport-fit=cover/.test(markup), 'viewport 适配刘海屏');

  const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
  ok(manifest.display === 'standalone', 'manifest：standalone 全屏');
  ok(manifest.icons.some((i) => i.sizes === '192x192'), 'manifest：含 192 图标');
  ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any'), 'manifest：含 512 图标');
  ok(manifest.icons.some((i) => i.purpose === 'maskable'), 'manifest：含 maskable 图标');
  for (const i of manifest.icons) {
    const png = readFileSync(join(DIR, i.src));
    ok(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), '图标文件存在且是合法 PNG：' + i.src);
    const dimensions = i.sizes.split('x').map(Number);
    eq(png.readUInt32BE(16), dimensions[0], '图标实际宽度与清单一致：' + i.src);
    eq(png.readUInt32BE(20), dimensions[1], '图标实际高度与清单一致：' + i.src);
  }
  eq(manifest.theme_color, (markup.match(/<meta name="theme-color" content="([^"]+)"/) || [])[1], '安装应用与网页的主题色一致');
  ok(readFileSync(join(DIR, 'sw.js'), 'utf8').includes("addEventListener('fetch'"), 'service worker 有 fetch 处理器（可离线）');
}

/* =========== 5. CSS：括号平衡、变量闭合、暗色模式覆盖 =========== */
{
  const cssM = html.match(/<style>([\s\S]*?)<\/style>/);
  const css = cssM ? cssM[1] : '';
  ok(!!css, '存在 <style> 内联样式');

  let depth = 0, balanced = true;
  for (const ch of css) {
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth < 0) balanced = false; }
  }
  ok(balanced && depth === 0, 'CSS 花括号平衡', 'depth=' + depth);

  // 取某个 '{' 起点的完整块内容
  const blockAfter = (text, braceIdx) => {
    let d = 0;
    for (let i = braceIdx; i < text.length; i++) {
      if (text[i] === '{') d++;
      else if (text[i] === '}') { d--; if (d === 0) return text.slice(braceIdx + 1, i); }
    }
    return null;
  };

  const mediaIdx = css.indexOf('@media (prefers-color-scheme: dark)');
  ok(mediaIdx >= 0, '存在暗色模式媒体查询');
  const mediaBody = mediaIdx >= 0 ? blockAfter(css, css.indexOf('{', mediaIdx)) : '';
  ok(!!mediaBody, '暗色模式媒体块可解析');

  const lightRoot = blockAfter(css, css.indexOf('{', css.indexOf(':root'))) || '';
  const darkRoot = mediaBody ? (blockAfter(mediaBody, mediaBody.indexOf('{', mediaBody.indexOf(':root'))) || '') : '';
  ok(lightRoot.length > 100, '亮色 :root 变量块存在');
  ok(darkRoot.length > 100, '暗色 :root 变量块存在');

  const decls = (txt) => [...txt.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)];
  const lightVars = new Map(decls(lightRoot).map((m) => [m[1], m[2].trim()]));
  const darkVars = new Set(decls(darkRoot).map((m) => m[1]));
  ok(lightVars.size >= 12, '亮色变量数量正常（' + lightVars.size + '）');

  const usedVars = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  const undef = [...usedVars].filter((v) => !lightVars.has(v));
  ok(undef.length === 0, '所有 var(--x) 都已在 :root 定义', undef.join(', '));

  const colorVars = [...lightVars].filter(([, v]) => /#|rgb|hsl/.test(v)).map(([k]) => k);
  const notInDark = colorVars.filter((v) => !darkVars.has(v));
  ok(notInDark.length === 0, '暗色模式覆盖了全部颜色变量（' + colorVars.length + ' 个）', notInDark.join(', '));

  // 关键类在样式里都有定义
  const keyClasses = ['.topbar', '.summary', '.daygroup', '.rec', '.tabbar', '.fab', '.sheet', '.cat',
                      '.amount-row', '.dots', '.pad', '.donut', '.legend', '.rank', '.bar', '.trend', '.switch',
                      '#updateBar'];
  const noStyle = keyClasses.filter((c) => !css.includes(c));
  ok(noStyle.length === 0, '关键类名都有样式定义', noStyle.join(', '));

  // 安全区（刘海屏 / 手势条）
  ok(css.includes('safe-area-inset-bottom') && css.includes('safe-area-inset-top'), '适配安全区（刘海屏与手势条）');
  ok(css.includes('prefers-color-scheme: dark'), '跟随系统深色模式');
}

/* =========== 6. 备份与恢复 =========== */
{
  const demo = [
    { id: 'r1', type: 'expense', amount: 1200, cat: '餐饮', note: '午饭', date: '2025-07-04', ts: 1000 },
    { id: 'r2', type: 'expense', amount: 3000, cat: '交通', note: '', date: '2025-07-05', ts: 2000 },
    { id: 'r3', type: 'income', amount: 500000, cat: '工资', note: '月薪', date: '2025-07-10', ts: 3000 }
  ];
  const seedWith = (extraCfg) => ({
    'jz.records.v1': JSON.stringify(demo),
    'jz.config.v1': JSON.stringify(Object.assign(
      { pin: null, lockDelay: 60000, lastCat: { expense: '餐饮', income: '工资' }, autoExport: 'off' }, extraCfg))
  });

  let bk = null;
  step('启动时自动创建当日快照', () => { bk = runApp({ storageMode: 'ok', seed: seedWith() }); });
  if (bk) {
    const snaps = JSON.parse(bk.storage.getItem('jz.backups.v1') || '[]');
    eq(snaps.length, 1, '启动后存在 1 份快照');
    eq(snaps[0].reason, 'daily', '快照原因为 daily');
    eq(snaps[0].n, 3, '快照记录数正确');
    eq(snaps[0].total, 4200, '快照统计支出合计（12.00 + 30.00）');
    eq(cfgOf(bk).lastSnap, todayLocal(), '记录快照日期，当天不重复');
    ok(/共 1 份/.test(bk.els.get('snapCountInfo').textContent), '设置页显示快照数量', bk.els.get('snapCountInfo').textContent);
    ok(/还没有导出过/.test(bk.els.get('lastExportInfo').textContent), '设置页显示尚未导出');
    eq(bk.els.get('autoExport').value, 'off', '自动导出下拉回填正确');

    step('立即备份并导出 JSON', () => bk.els.get('backupNowRow').onclick());
    eq(bk.files.length, 1, '触发了一次文件下载');
    ok(/^轻记账-备份-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}\.json$/.test(bk.files[0].name), '备份文件名带日期、秒和毫秒，避免同一分钟内覆盖', bk.files[0].name);
    const exported = JSON.parse(bk.blobs[0]._text);
    eq(exported.app, '轻记账', '导出内容带应用标识');
    eq(exported.count, 3, '导出条数正确');
    eq(exported.records.length, 3, '导出记录完整');
    eq('pin' in exported.config, false, '导出文件不含 PIN');
    eq(exported.records[0].date, '2025-07-04', '导出按日期升序');
    eq(JSON.parse(bk.storage.getItem('jz.backups.v1')).length, 2, '手动备份同时留下快照');
    ok(/上次导出/.test(bk.els.get('lastExportInfo').textContent), '设置页显示上次导出时间');

    step('导出 CSV', () => bk.els.get('csvRow').onclick());
    eq(bk.files.length, 2, '触发了 CSV 下载');
    ok(/\.csv$/.test(bk.files[1].name), 'CSV 扩展名正确');
    const csv = bk.blobs[1]._text;
    eq(csv.charCodeAt(0), 65279, 'CSV 带 BOM');
    ok(csv.includes('2025-07-04,支出,餐饮,12.00,午饭'), 'CSV 数据行正确', csv.split('\r\n')[1]);
    eq(csv.split('\r\n').length, 4, 'CSV 表头 + 3 行');

    step('打开快照列表', () => {
      bk.els.get('snapListRow').onclick();
      eq(bk.els.get('panel').classList.contains('show'), true, '快照面板已打开');
      ok(/本机快照/.test(bk.els.get('panelTitle').textContent), '面板标题正确');
      ok(/恢复/.test(bk.els.get('panelBody').innerHTML), '快照行含恢复入口');
      ok(/删除/.test(bk.els.get('panelBody').innerHTML), '快照行含删除入口');
      eq(bk.els.get('panelFoot').hidden, true, '列表页不显示底部按钮');
    });

    step('快照恢复预览', () => {
      fire(bk.els.get('panelBody'), 'click', { i: '0' });
      eq(bk.els.get('panelTitle').textContent, '恢复预览', '进入恢复预览');
      eq(bk.els.get('panelFoot').hidden, false, '预览页显示合并/覆盖按钮');
      ok(/会新增 0 条，跳过 3 条重复/.test(bk.els.get('panelBody').innerHTML), '识别出全部重复', '');
    });

    step('合并同一份数据不会产生重复', () => {
      bk.els.get('panelMerge').onclick();
      eq(recs(bk).length, 3, '合并后仍是 3 条（按 id 去重）');
      eq(bk.els.get('panel').classList.contains('show'), false, '面板已关闭');
    });

    step('删除快照', () => {
      bk.els.get('snapListRow').onclick();
      const before = JSON.parse(bk.storage.getItem('jz.backups.v1')).length;
      fire(bk.els.get('panelBody'), 'click', { del: '0' });
      eq(JSON.parse(bk.storage.getItem('jz.backups.v1')).length, before - 1, '快照被删除');
    });

    /* —— 清空后靠快照救回来 —— */
    step('清空前自动留快照', () => {
      bk.els.get('clearRow').onclick();
      eq(recs(bk).length, 0, '数据已清空');
      const snaps = JSON.parse(bk.storage.getItem('jz.backups.v1'));
      ok(snaps.some((s) => s.reason === 'preclear'), '留下了 preclear 快照');
    });
    step('从快照恢复被清空的数据', () => {
      bk.els.get('snapListRow').onclick();
      const idx = JSON.parse(bk.storage.getItem('jz.backups.v1')).findIndex((s) => s.reason === 'preclear');
      fire(bk.els.get('panelBody'), 'click', { i: String(idx) });
      bk.els.get('panelReplace').onclick();
      eq(recs(bk).length, 3, '3 条记录全部找回');
      eq(bk.els.get('meCount').textContent, 3, '界面上的统计同步刷新');
      ok(/12\.00/.test(bk.els.get('listBox').innerHTML), '明细列表重新渲染');
    });
  }
}

/* =========== 7. 从文件恢复（合并 / 覆盖 / 容错） =========== */
{
  const seedOne = () => ({
    'jz.records.v1': JSON.stringify([
      { id: 'r1', type: 'expense', amount: 1200, cat: '餐饮', note: '午饭', date: '2025-07-04', ts: 1000 }]),
    'jz.config.v1': JSON.stringify({ pin: null, lockDelay: 60000, lastCat: { expense: '餐饮', income: '工资' }, autoExport: 'off' })
  });
  let app2 = null;
  step('准备导入环境', () => { app2 = runApp({ storageMode: 'ok', seed: seedOne() }); });
  if (app2) {
    const importFile = async (fileObj) => {
      app2.els.get('fileInput').files = [fileObj];
      app2.els.get('fileInput').onchange();
      await new Promise((r) => setTimeout(r, 20));
    };
    const payload = JSON.stringify({ app: '轻记账', version: 1, records: [
      { id: 'r1', type: 'expense', amount: 1200, cat: '餐饮', note: '午饭', date: '2025-07-04', ts: 1000 },
      { id: 'x9', type: 'expense', amount: 8800, cat: '购物', note: '鞋', date: '2025-08-01', ts: 9000 }] });

    await importFile({ text: () => Promise.resolve(payload) });
    eq(app2.els.get('panelTitle').textContent, '恢复预览', '选文件后进入恢复预览');
    ok(/会新增 1 条，跳过 1 条重复/.test(app2.els.get('panelBody').innerHTML), '预览显示新增/重复条数', app2.els.get('panelBody').innerHTML.slice(0, 120));

    step('合并导入', () => app2.els.get('panelMerge').onclick());
    eq(recs(app2).length, 2, '合并后 2 条（去重生效）');
    eq(recs(app2)[1].cat, '购物', '新增记录内容正确');

    await importFile({ text: () => Promise.resolve(payload) });
    step('重复导入同一文件', () => app2.els.get('panelMerge').onclick());
    eq(recs(app2).length, 2, '再导入一次不会翻倍');

    await importFile({ text: () => Promise.resolve(JSON.stringify({ records: [
      { id: 'z1', date: '2025-09-01', amount: 500, cat: '交通' }] })) });
    step('覆盖恢复', () => app2.els.get('panelReplace').onclick());
    eq(recs(app2).length, 1, '覆盖后只剩备份里的 1 条');
    eq(recs(app2)[0].id, 'z1', '覆盖的是备份内容');
    ok(JSON.parse(app2.storage.getItem('jz.backups.v1')).some((s) => s.reason === 'import'), '覆盖前自动留了 import 快照');

    const nFiles = app2.files.length;
    await importFile({ text: () => Promise.resolve('这不是 JSON') });
    eq(app2.alerts.length, 1, '非法文件弹出提示');
    ok(/JSON/.test(app2.alerts[0]), '提示说明是 JSON 解析问题', app2.alerts[0]);
    eq(app2.files.length, nFiles, '非法文件不会触发下载');

    await importFile({ text: () => Promise.resolve(JSON.stringify({ records: [] })) });
    eq(app2.alerts.length, 2, '空 records 也被拒绝');
    eq(recs(app2).length, 1, '拒绝导入时原数据不受影响');

    step('兼容裸数组文件', () => {});
    await importFile({ text: () => Promise.resolve(JSON.stringify([
      { date: '2025-01-01', amount: 999, type: 'expense', cat: '其他' }])) });
    eq(app2.els.get('panelTitle').textContent, '恢复预览', '裸数组也能预览');
    step('裸数组合并导入', () => app2.els.get('panelMerge').onclick());
    eq(recs(app2).length, 2, '裸数组记录被导入');
  }
}

/* =========== 8. 自动导出（无需用户操作） =========== */
{
  const seed = {
    'jz.records.v1': JSON.stringify([{ id: 'a', type: 'expense', amount: 100, cat: '餐饮', note: '', date: '2025-07-04', ts: 1 }]),
    'jz.config.v1': JSON.stringify({ pin: null, lockDelay: 60000, lastCat: {}, autoExport: 'daily', lastExport: 0, snapOn: true })
  };
  let auto = null;
  step('启动（自动导出=每天）', () => { auto = runApp({ storageMode: 'ok', seed }); });
  if (auto) {
    eq(auto.files.length, 0, '启动瞬间不会立刻下载');
    await new Promise((r) => setTimeout(r, 1800));
    eq(auto.files.length, 1, '延迟后自动导出了备份文件');
    ok(/\.json$/.test(auto.files[0].name), '自动导出的是 JSON');
    eq(JSON.parse(auto.blobs[0]._text).count, 1, '自动导出内容完整');
  }

  const seedOff = Object.assign({}, seed, {
    'jz.config.v1': JSON.stringify({ pin: null, lockDelay: 60000, lastCat: {}, autoExport: 'off', lastExport: 0 })
  });
  let autoOff = null;
  step('启动（自动导出=关闭）', () => { autoOff = runApp({ storageMode: 'ok', seed: seedOff }); });
  if (autoOff) {
    await new Promise((r) => setTimeout(r, 1800));
    eq(autoOff.files.length, 0, '关闭后不会下载任何文件');
  }

  const seedRecent = Object.assign({}, seed, {
    'jz.config.v1': JSON.stringify({ pin: null, lockDelay: 60000, lastCat: {}, autoExport: 'daily', lastExport: Date.now() })
  });
  let autoRecent = null;
  step('启动（刚导出过）', () => { autoRecent = runApp({ storageMode: 'ok', seed: seedRecent }); });
  if (autoRecent) {
    await new Promise((r) => setTimeout(r, 1800));
    eq(autoRecent.files.length, 0, '未到间隔不会重复导出');
  }
}

/* =========== 9. 「我的」页面结构（移除运行方式/关于卡片，但保留版本号） =========== */
{
  const seedCfg = { 'jz.config.v1': JSON.stringify({ pin: null, lockDelay: 60000, lastCat: {}, autoExport: 'off' }) };
  let me = null;
  step('打开「我的」页', () => { me = runApp({ storageMode: 'ok', seed: seedCfg }); fire(me.els.get('tabbar'), 'click', { view: 'me' }); });
  if (me) {
    ok(!/id="runStateRow"/.test(markup), '运行方式入口已移除');
    ok(!/id="installBtn"/.test(markup), '安装按钮已移除');
    ok(!/id="checkUpdateRow"/.test(markup), '检查更新入口已移除');
    ok(!/关于「轻记账」/.test(markup), '关于卡片已移除');
    ok(!/runStateInfo|installHint|updateInfo/.test(script), '脚本里不再引用被删掉的元素');
    ok(!/runtimeInfo|openRunHelp|deferredPrompt|checkUpdate\b/.test(script), '运行方式相关逻辑已清理');

    // 版本号必须还能在界面上看到（只保留这一行，不恢复整块「关于」）
    ok(/id="appVer"/.test(markup), '界面保留版本号');
    ok(/class="verline"/.test(markup), '版本号以独立小字行呈现');
    const verConst = (script.match(/var APP_VERSION = '([^']+)'/) || [])[1];
    ok(!!verConst, 'index.html 里有 APP_VERSION 常量');
    eq(me.els.get('appVer').textContent, verConst, '界面版本号与 APP_VERSION 一致（不会两处写死对不上）');
    ok(/轻记账[\s\S]{0,30}id="appVer"/.test(markup), '版本行带应用名');

    // 保留下来的卡片必须还在
    ok(/id="meBalance"/.test(markup), '总结余卡片保留');
    ok(/id="snapSwitch"/.test(markup), '自动快照设置保留');
    ok(/id="pinSwitch"/.test(markup), '密码锁设置保留');
    ok(/id="clearRow"/.test(markup), '清空数据保留');
    eq(me.els.get('meBalance').textContent, '¥0.00', '总结余仍正常渲染');
  }
}

/* =========== 10. 部署一致性（托管平台上最容易踩的坑） =========== */
{
  const swSrc = readFileSync(join(DIR, 'sw.js'), 'utf8');
  const assets = [...swSrc.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
  const missAssets = [...new Set(assets)].filter((a) => !existsSync(join(DIR, a)));
  ok(missAssets.length === 0, 'sw.js 预缓存清单里的文件都真实存在', missAssets.join(', '));

  // 导航必须绕开 HTTP 缓存的 max-age，否则换完文件手机可能十几分钟还拿到旧版
  ok(/req\.mode === 'navigate'/.test(swSrc), 'sw.js 对页面导航做了特殊处理');
  ok(/fetch\(req, \{ cache: 'no-cache' \}\)/.test(swSrc), '导航请求会向服务器校验版本（不受托管平台 max-age 影响）');
  ok(/caches\.match\('\.\/index\.html'/.test(swSrc), '断网时能回退到缓存的 index.html');
  ok(!/skipWaiting/.test(swSrc) || /self\.skipWaiting\(\)/.test(swSrc), 'sw.js 安装后立即生效');
  eq((swSrc.match(/const VERSION = CACHE_PREFIX \+ '([^']+)'/) || [])[1], (script.match(/var APP_VERSION = '([^']+)'/) || [])[1], '离线缓存与应用版本一致');

  // 语法自检：sw.js 不参与 DOM 桩执行，这里至少保证它能被解析
  let swSyntaxOk = true, swErr = '';
  try { new Function(swSrc); } catch (e) { swSyntaxOk = false; swErr = e.message; }
  ok(swSyntaxOk, 'sw.js 语法正确', swErr);

  const linkM = html.match(/<link rel="manifest" href="([^"]+)"/);
  ok(!!linkM, 'HTML 里声明了 manifest');
  const manFile = linkM ? linkM[1] : '';
  ok(manFile && existsSync(join(DIR, manFile)), 'manifest 文件真实存在：' + (manFile || '—'));
  ok(/\.json$/.test(manFile), '清单使用 .json 后缀（所有静态托管都保证 MIME 正确）', manFile);

  if (manFile && existsSync(join(DIR, manFile))) {
    const man = JSON.parse(readFileSync(join(DIR, manFile), 'utf8'));
    const startFile = String(man.start_url || '').replace(/^\.\//, '');
    ok(startFile && existsSync(join(DIR, startFile)), 'manifest 的 start_url 指向存在的文件：' + startFile);
    for (const i of man.icons) ok(existsSync(join(DIR, i.src)), 'manifest 图标存在：' + i.src);
    ok(man.display === 'standalone', 'manifest 要求独立窗口（无地址栏）');
  }

  const deployFiles = ['index.html', 'manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

  // 部署契约：GitHub Pages 直接从仓库根目录发布，所以这 6 个文件必须在根目录
  for (const f of deployFiles) ok(existsSync(join(DIR, f)), '仓库根目录可直接发布：' + f);
  ok(existsSync(join(DIR, '.nojekyll')), '根目录有 .nojekyll（跳过 GitHub Pages 的 Jekyll）');
  ok(existsSync(join(DIR, '.gitignore')), '根目录有 .gitignore');

  if (existsSync(join(DIR, 'dist'))) {
    for (const f of deployFiles) {
      const dp = join(DIR, 'dist', f);
      if (!existsSync(dp)) { ok(false, 'dist 缺少文件：' + f); continue; }
      ok(readFileSync(join(DIR, f)).equals(readFileSync(dp)), 'dist 与源文件一致：' + f + '（改了源码要重跑 build.mjs）');
    }
    ok(existsSync(join(DIR, 'dist', '.nojekyll')), 'dist 带 .nojekyll（跳过 GitHub Pages 的 Jekyll）');
  } else {
    // dist/ 只服务于 Cloudflare Pages / Netlify Drop 那种「拖文件夹」部署，
    // 从仓库根目录发布时不需要它，因此缺失不算失败（新克隆下来就应该是这样）。
    ok(true, 'dist/ 未生成，跳过打包一致性校验（需要时运行 node build.mjs）');
  }

  // 没有会被 Jekyll 误解析的模板语法，也没有会被 Pages 忽略的下划线文件
  for (const f of deployFiles.filter((x) => /\.(html|js|json)$/.test(x))) {
    const t = readFileSync(join(DIR, f), 'utf8');
    ok(!/\{\{|\{%/.test(t), f + ' 不含 Liquid 模板语法（GitHub Pages 不会误伤）');
  }
}

/* =========== 11. 版本更新提示 =========== */
{
  const seedCfg = { 'jz.config.v1': JSON.stringify({ pin: null, lockDelay: 60000, lastCat: {}, autoExport: 'off' }) };
  let up = null;
  step('更新提示条', () => {
    up = runApp({ storageMode: 'ok', seed: seedCfg, loc: { protocol: 'https:', hostname: 'me.github.io' }, secureContext: true });
  });
  if (up) {
    const e = up.els;
    eq(e.get('updateBar').hidden, true, '默认不显示更新提示条');
    ok(!!(script.match(/var APP_VERSION = '([^']+)'/) || [])[1], 'index.html 里有 APP_VERSION 常量');

    const jz = up.windowShim.__jz;
    ok(typeof jz.showUpdateBar === 'function', '暴露了 showUpdateBar');

    step('发现新版本', () => jz.showUpdateBar());
    eq(e.get('updateBar').hidden, false, '提示条出现');
    ok(/发现新版本/.test(markup) && /id="updateNow"/.test(markup), '提示条有「立即更新」按钮');

    step('点「立即更新」会重新加载页面', () => e.get('updateNow').onclick());
    eq(up.locationShim.reloadCount, 1, '调用了 location.reload()（数据不会因此丢失）');

    step('点「稍后」关闭提示条', () => {
      jz.showUpdateBar();
      e.get('updateLater').onclick();
      eq(e.get('updateBar').hidden, true, '提示条被关掉');
    });
  }
}

/* =========== 12. 分类与总结余 =========== */
{
  const M = todayLocal().slice(0, 7);   // 明细列表只显示当前月份，测试数据得用当月
  const seed = {
    'jz.records.v1': JSON.stringify([
      { id: 'a', type: 'expense', amount: 12345, cat: '零食', note: '', date: M + '-01', ts: 1 },
      { id: 'b', type: 'expense', amount: 500, cat: '饮品', note: '', date: M + '-02', ts: 2 },
      { id: 'c', type: 'expense', amount: 2000, cat: 'token', note: '', date: M + '-03', ts: 3 },
      { id: 'd', type: 'income', amount: 100000, cat: '工资', note: '', date: M + '-10', ts: 4 }
    ]),
    'jz.config.v1': JSON.stringify({ pin: null, lockDelay: 60000, lastCat: {}, autoExport: 'off' })
  };
  let app4 = null;
  step('分类与总结余', () => { app4 = runApp({ storageMode: 'ok', seed }); });
  if (app4) {
    const e = app4.els, jz = app4.windowShim.__jz;
    const names = jz.CATS.expense.map((c) => c[0]);
    ok(['零食', '饮品', 'token', '数码'].every((n) => names.includes(n)), '自定义添加的分类都在', names.join('/'));
    ok(jz.CATS.expense.every((c) => c.length === 2 && !!c[1]), '每个支出分类都有 emoji');
    ok(new Set(names).size === names.length, '分类名不重复');
    ok(names.indexOf('数码') > names.indexOf('通讯'), '数码排在通讯之后，位置合理');

    step('打开记账面板渲染分类宫格', () => e.get('fab').onclick());
    const grid = e.get('cats').innerHTML;
    eq((grid.match(/data-cat="/g) || []).length, jz.CATS.expense.length, '宫格渲染出全部分类（' + jz.CATS.expense.length + ' 个）');
    for (const n of ['零食', '饮品', 'token', '数码']) {
      ok(grid.includes('data-cat="' + n + '"'), n + ' 出现在宫格');
    }
    ok(/🍿/.test(grid) && /🥤/.test(grid) && /🪙/.test(grid) && /💻/.test(grid), '四个新分类都有图标');

    // 1000.00 − (123.45 + 5.00 + 20.00) = 851.55
    eq(e.get('meBalance').textContent, '¥851.55', '总结余 = 全部收入 − 全部支出');
    eq(e.get('meIncome').textContent, '1,000.00', '累计收入');
    eq(e.get('meTotal').textContent, '148.45', '累计支出');
    eq(e.get('meCount').textContent, 4, '累计笔数');
    eq(e.get('meDays').textContent, 4, '记账天数');
    eq(e.get('meBalance').style.color, 'var(--inc)', '正结余用收入色');

    step('明细列表显示新分类', () => {
      const list = e.get('listBox').innerHTML;
      ok(/零食/.test(list) && /饮品/.test(list) && /token/.test(list), '新分类正常显示');    });
  }

  const seedNeg = {
    'jz.records.v1': JSON.stringify([
      { id: 'a', type: 'expense', amount: 5000, cat: '餐饮', note: '', date: '2025-07-01', ts: 1 }]),
    'jz.config.v1': JSON.stringify({ pin: null, lockDelay: 60000, lastCat: {}, autoExport: 'off' })
  };
  let neg = null;
  step('负结余', () => { neg = runApp({ storageMode: 'ok', seed: seedNeg }); });
  if (neg) {
    eq(neg.els.get('meBalance').textContent, '-¥50.00', '支出大于收入时带负号');
    eq(neg.els.get('meBalance').style.color, 'var(--exp)', '负结余用支出色');
    eq(neg.els.get('meIncome').textContent, '0.00', '无收入时显示 0.00');
  }

  let empty = null;
  step('空账本', () => { empty = runApp({ storageMode: 'ok', seed: {} }); });
  if (empty) {
    eq(empty.els.get('meBalance').textContent, '¥0.00', '空账本总结余 0');
    eq(empty.els.get('meBalance').style.color, 'var(--muted)', '空账本用中性色');
  }
}

/* =========== 13. 金额算式（记账时直接加减乘除） =========== */
{
  const probe = runApp({ storageMode: 'ok', seed: {} });
  const ev = probe.windowShim.__jz.evalAmount;
  const close = (a, b, name) => ok(typeof a === 'number' && Math.abs(a - b) < 1e-9, name, a + ' vs ' + b);

  close(ev('12.5+3.8'), 16.3, '加法');
  close(ev('100-25'), 75, '减法');
  close(ev('2*3+4'), 10, '乘加优先级');
  close(ev('10/4'), 2.5, '除法');
  close(ev('(1+2)*3'), 9, '括号');
  close(ev('1.5+2.25'), 3.75, '多位小数');
  close(ev('12.5 + 3.8'), 16.3, '忽略空格');
  close(ev('6×7'), 42, '全角乘号');
  close(ev('8÷2'), 4, '全角除号');
  close(ev('20－5'), 15, '全角减号');
  close(ev('-5+10'), 5, '一元负号');
  close(ev('.5+.5'), 1, '省略整数部分');
  close(ev('0.1+0.2'), 0.3, '浮点累加不出偏差');
  eq(ev(''), null, '空串返回 null');
  eq(ev('12+'), null, '末尾缺操作数');
  eq(ev('10/0'), null, '除以零被拒绝');
  eq(ev('abc'), null, '非法字符');
  eq(ev('1.2.3'), null, '多个小数点');
  eq(ev('(1+2'), null, '括号不闭合');
  eq(ev('*5'), null, '运算符开头');

  let ui = null;
  step('算式记账界面', () => { ui = runApp({ storageMode: 'ok', seed: {} }); });
  if (ui) {
    const e = ui.els;
    e.get('fab').onclick();
    eq(e.get('calcPreview').hidden, true, '没有运算符时不显示预览');

    step('输入算式', () => {
      e.get('amt').value = '12.5+3.8';
      fireInput(e.get('amt'));
    });
    eq(e.get('calcPreview').hidden, false, '出现算式预览');
    eq(e.get('calcPreview').textContent, '= 16.30', '预览显示计算结果', e.get('calcPreview').textContent);

    step('保存算式结果', () => e.get('sheetSave').onclick());
    eq(recs(ui).length, 1, '记录已保存');
    eq(recs(ui)[0] && recs(ui)[0].amount, 1630, '存的是计算结果 1630 分');

    // 按需求移除：运算符按钮条与 12.5+3.8 提示都不应再出现在界面上
    ok(!/id="opbar"/.test(markup), '运算符按钮条已移除');
    ok(!/opbar-hint|可直接输入 12\.5\+3\.8/.test(markup), '「12.5+3.8」提示文案已移除');
    ok(!/opbar-hint/.test(script), '脚本里不再引用提示元素');

    step('非法字符被过滤', () => {
      const el = e.get('amt');
      el.value = '12元+3块';
      fireInput(el);
      eq(el.value, '12+3', '只保留数字和运算符');
    });

    step('算式不完整时拒绝保存', () => {
      const before = recs(ui).length;
      e.get('amt').value = '12+';
      fireInput(e.get('amt'));
      eq(e.get('calcPreview').textContent, '不完整', '预览提示不完整');
      e.get('sheetSave').onclick();
      eq(recs(ui).length, before, '没有新增记录');
      ok(/算式不完整/.test(e.get('toast').textContent), '给出明确提示', e.get('toast').textContent);
    });

    step('结果为负数或零也拒绝', () => {
      const before = recs(ui).length;
      e.get('amt').value = '5-5';
      fireInput(e.get('amt'));
      eq(e.get('calcPreview').textContent, '= 0.00', '预览会显示 0.00');
      e.get('sheetSave').onclick();
      eq(recs(ui).length, before, '0 元不记账');
    });

    step('普通金额照旧可用', () => {
      const el = e.get('amt');
      el.value = '38.50';
      fireInput(el);
      eq(e.get('calcPreview').hidden, true, '纯数字不显示预览');
      const before = recs(ui).length;
      e.get('sheetSave').onclick();
      eq(recs(ui).length, before + 1, '纯数字保存成功');
      eq(recs(ui)[recs(ui).length - 1].amount, 3850, '金额正确');
    });
  }
}

/* =========== 14. 1.5.0 搜索、分类、跨月与长列表 =========== */
{
  const seed = { 'jz.config.v1': JSON.stringify({ autoExport:'off', snapOn:false }), 'jz.records.v1': JSON.stringify([
    { id:'s1', type:'expense', amount:2550, cat:'餐饮', note:'午饭 <script>', date:'2026-10-18' },
    { id:'s2', type:'expense', amount:1800, cat:'饮品', note:'Coffee', date:'2026-10-17' },
    { id:'s3', type:'income', amount:800000, cat:'工资', date:'2026-10-01' },
    { id:'s4', type:'expense', amount:3000, cat:'餐饮', note:'午饭', date:'2026-09-18' }
  ]) };
  const a = runApp({ seed }), e = a.els;
  e.get('monthPicker').value = '2026-10'; e.get('monthPicker').onchange();
  eq(e.get('listCount').textContent, '3 笔记录', '月份直达只显示所选月');
  ok(/&lt;script&gt;/.test(e.get('listBox').innerHTML), '备注 HTML 作为文本转义');
  e.get('searchInput').value = '午饭'; fireInput(e.get('searchInput'));
  eq(e.get('listCount').textContent, '1 笔记录', '备注关键词筛选');
  ok(/25\.50/.test(e.get('filterInfo').textContent), '筛选统计独立显示');
  ok(/43\.50/.test(e.get('sumExp').innerHTML), '搜索不改变月份总支出');
  e.get('allMonths').checked = true; e.get('allMonths').onchange();
  eq(e.get('listCount').textContent, '2 笔记录', '跨月搜索命中历史记录');
  ok(/2026年/.test(e.get('listBox').innerHTML), '跨月分组显示年份');
  e.get('clearSearch').onclick();
  eq(e.get('listCount').textContent, '4 笔记录', '清除关键词保留跨月选择');
  fire(e.get('listSeg'), 'click', { filter:'income' });
  eq(e.get('listCount').textContent, '1 笔记录', '收入类型筛选');
  fire(e.get('listSeg'), 'click', { filter:'expense' });
  e.get('categoryFilter').value = '餐饮'; e.get('categoryFilter').onchange();
  eq(e.get('listCount').textContent, '2 笔记录', '分类与跨月组合筛选');
  e.get('searchInput').value = '不存在'; fireInput(e.get('searchInput'));
  ok(/没有找到匹配/.test(e.get('listBox').innerHTML), '搜索空状态明确');
  fire(e.get('listBox'), 'click', { action:'reset' });
  eq(e.get('listCount').textContent, '3 笔记录', '清除筛选回到当前月份');
  e.get('searchInput').value = 'COFFEE'; fireInput(e.get('searchInput'));
  eq(e.get('listCount').textContent, '1 笔记录', '搜索不区分大小写');
  e.get('searchInput').value = '18.00'; fireInput(e.get('searchInput'));
  eq(e.get('listCount').textContent, '1 笔记录', '支持金额搜索');
  const many = Array.from({ length:205 }, (_, i) => ({ id:'many'+i, date:todayLocal(), amount:100, cat:'餐饮' }));
  const b = runApp({ seed:{ 'jz.records.v1':JSON.stringify(many), 'jz.config.v1':JSON.stringify({ autoExport:'off', snapOn:false }) } });
  eq((b.els.get('listBox').innerHTML.match(/class="rec"/g) || []).length, 100, '长列表首屏最多 100 条');
  eq(b.els.get('sumCnt').textContent, 205, '长列表汇总仍包含所有记录');
  b.els.get('loadMore').onclick();
  eq((b.els.get('listBox').innerHTML.match(/class="rec"/g) || []).length, 200, '加载更多追加到 200 条');
  b.els.get('loadMore').onclick();
  eq(b.els.get('loadMore').hidden, true, '加载全部后隐藏按钮');
}

/* =========== 15. 月份预算与主题 =========== */
{
  const a = runApp(), e = a.els;
  e.get('monthPicker').value = '2026-10'; e.get('monthPicker').onchange();
  e.get('editBudget').onclick();
  eq(e.get('budgetForm').hidden, false, '打开预算表单');
  e.get('budgetInput').value = '3000.50'; e.get('saveBudget').onclick();
  eq(cfgOf(a).budgets['2026-10'], 300050, '预算按分落盘');
  eq(e.get('budgetValue').textContent, '¥3,000.50', '显示剩余预算');
  eq(e.get('budgetForm').hidden, true, '保存后收起预算表单');
  e.get('fab').onclick(); e.get('amt').value = '3100'; e.get('date').value = '2026-10-18'; e.get('sheetSave').onclick();
  ok(/已超出预算/.test(e.get('budgetCaption').textContent), '超预算提示');
  eq(e.get('budgetValue').textContent, '¥99.50', '超预算金额准确');
  eq(e.get('budgetBar').style.width, '100.0%', '超预算进度不溢出');
  eq(e.get('budgetBar').style.background, 'var(--exp)', '超预算使用警示色');
  e.get('prevM').onclick();
  ok(/给花费/.test(e.get('budgetValue').textContent), '各月份预算独立');
  e.get('nextM').onclick();
  eq(e.get('budgetValue').textContent, '¥99.50', '返回月份保留预算');
  e.get('themeSelect').value = 'dark'; e.get('themeSelect').onchange();
  eq(cfgOf(a).theme, 'dark', '保存深色主题偏好');
  eq(a.documentShim.documentElement.dataset.theme, 'dark', '应用深色主题');
  const backup = a.windowShim.__jz.buildBackup();
  eq(backup.appVersion, appVersion, '备份标识应用版本');
  eq(backup.config.budgets['2026-10'], 300050, '备份包含月度预算');
  eq('pin' in backup.config, false, '新版备份仍排除密码');
  a.storage.failWrites = true;
  e.get('budgetInput').value = '9000'; e.get('saveBudget').onclick();
  eq(a.windowShim.__jz.buildBackup().config.budgets['2026-10'], 300050, '预算保存失败回滚内存');
  a.storage.failWrites = false;
  e.get('removeBudget').onclick();
  eq(cfgOf(a).budgets['2026-10'], undefined, '移除预算落盘');
}

/* =========== 16. 连续记账、撤销删除与保存失败 =========== */
{
  const a = runApp(), e = a.els;
  e.get('fab').onclick(); e.get('amt').value = '25'; e.get('note').value = '午饭';
  e.get('saveContinue').onclick();
  eq(recs(a).length, 1, '连续记账保存第一笔');
  eq(e.get('sheet').classList.contains('show'), true, '保存并继续保持面板');
  eq(e.get('amt').value, '', '保存并继续清空金额');
  eq(e.get('note').value, '', '保存并继续清空备注');
  e.get('amt').value = '10'; e.get('sheetSave').onclick();
  eq(recs(a).length, 2, '连续记账第二笔落盘');
  fire(e.get('listBox'), 'click', { id:recs(a)[0].id });
  eq(e.get('saveContinue').hidden, true, '编辑记录不显示连续新增');
  e.get('sheetDelete').onclick();
  eq(recs(a).length, 1, '删除后落盘');
  eq(e.get('toastUndo').hidden, false, '删除后提供撤销');
  e.get('toastUndo').onclick();
  eq(recs(a).length, 2, '撤销删除恢复记录');
  a.storage.failWrites = true;
  e.get('fab').onclick(); e.get('amt').value = '66'; e.get('sheetSave').onclick();
  eq(recs(a).length, 2, '空间满时不写入新增记录');
  eq(e.get('meCount').textContent, 2, '空间满时内存与持久化保持一致');
  eq(e.get('sheet').classList.contains('show'), true, '保存失败保留输入面板');
  eq(e.get('amt').value, '66', '保存失败保留输入金额');
  ok(/保存失败/.test(e.get('toast').textContent), '保存失败不提示成功');
  a.storage.failWrites = false; e.get('sheetSave').onclick();
  eq(recs(a).length, 3, '释放空间后可重试保存');
  fire(e.get('listBox'), 'click', { id:recs(a)[0].id });
  a.storage.failWrites = true; e.get('amt').value = '999'; e.get('sheetSave').onclick();
  eq(recs(a).find(r=>r.id===recs(a)[0].id).amount, 1000, '编辑失败不会改变原记录');
  e.get('sheetDelete').onclick();
  eq(recs(a).length, 3, '删除写入失败不会丢数据');
  a.storage.failWrites = false;
  a.storage.setItem('jz.records.v1', JSON.stringify([{ id:'external', date:todayLocal(), amount:100 }]));
  e.get('sheetSave').onclick();
  eq(recs(a)[0].id, 'external', '并发修改不会被旧窗口覆盖');
  eq(e.get('conflictWarning').hidden, false, '并发修改提示重新加载');
}

/* =========== 17. 日期、异常账本、导出安全与手机 PIN =========== */
{
  const a = runApp(), e = a.els, api = a.windowShim.__jz;
  eq(api.normalizeRows([{ date:'2025-02-29', amount:100 }]).bad, 1, '非闰年 2 月 29 日被拒绝');
  eq(api.normalizeRows([{ date:'2024-02-29', amount:100 }]).bad, 0, '闰年日期有效');
  eq(api.normalizeRows([{ date:'2026-13-01', amount:100 }]).bad, 1, '无效月份被拒绝');
  eq(api.normalizeRows([{ date:'2026-01-01', amount:1e30 }]).bad, 1, '溢出金额被拒绝');
  eq(api.normalizeRows([{ date:'2026-01-01', amount:true }]).bad, 1, '布尔值不能作为金额');
  const legacy = [{date:'2026-01-01',amount:100},{date:'2026-01-01',amount:100}];
  eq(api.normalizeRows(legacy).records.map(r=>r.id), api.normalizeRows(legacy).records.map(r=>r.id), '无 ID 旧备份生成稳定 ID，重复导入可去重');
  ok(api.normalizeRows(legacy).records[0].id !== api.normalizeRows(legacy).records[1].id, '无 ID 的两条相同记录仍分别保留');
  const rows = api.normalizeRows([{ id:'__proto__', date:todayLocal(), amount:100, cat:'__proto__' }, { id:'constructor', date:todayLocal(), amount:200, cat:'constructor' }]).records;
  eq(rows.length, 2, '原型同名 ID 可正常处理');
  eq(api.aggregate(rows).length, 2, '原型同名分类可正确聚合');
  e.get('fab').onclick(); e.get('amt').value = '0.001'; e.get('sheetSave').onclick();
  eq(recs(a).length, 0, '小于一分的金额不能记为零');
  e.get('amt').value = '999999999999'; e.get('sheetSave').onclick();
  eq(recs(a).length, 0, '超出上限的金额不能保存');
  e.get('amt').value = '10'; e.get('date').value = '2025-02-29'; e.get('sheetSave').onclick();
  eq(recs(a).length, 0, '记账日期也严格校验');
  e.get('date').value = todayLocal(); e.get('note').value = '=HYPERLINK("https://example.com")'; e.get('sheetSave').onclick();
  ok(api.toCSV().includes("'=HYPERLINK"), 'CSV 备注以公式符号开头时转义');
  const raw = '{not-json';
  const b = runApp({ seed:{ 'jz.records.v1':raw } });
  eq(b.els.get('recoveryWarning').hidden, false, '异常账本持续显示恢复提示');
  b.els.get('fab').onclick(); b.els.get('amt').value = '10'; b.els.get('sheetSave').onclick();
  eq(b.storage.getItem('jz.records.v1'), raw, '异常账本原文不被普通记账覆盖');
  e.get('pinSwitch').onclick();
  ok(/data-k="ok"/.test(e.get('pad').innerHTML), '手机设置 PIN 有明确确认键');
  eq(e.get('cancelPin').hidden, false, 'PIN 设置可取消');
  e.get('cancelPin').onclick();
  eq(e.get('lock').hidden, true, '取消 PIN 返回账本');
  const d = runApp({ storageMode:'throw' });
  eq(d.els.get('storageWarning').hidden, false, '无持久化存储时显示常驻警告');
}

/* =========== 18. 恢复确认、预算恢复和失败保护 =========== */
{
  const a = runApp(), e = a.els;
  e.get('fab').onclick(); e.get('amt').value = '10'; e.get('sheetSave').onclick();
  const payload = JSON.stringify({ records:[{id:'imported',date:todayLocal(),amount:1234}], config:{ budgets:{'2026-10':500000,'bad':10},pin:{hash:'bad'} } });
  const openPayload = app => { app.els.get('fileInput').files = [{text:()=>Promise.resolve(payload)}]; app.els.get('fileInput').onchange(); };
  openPayload(a); await new Promise(r=>setTimeout(r,0));
  a.windowShim.confirmResult = false; e.get('panelReplace').onclick();
  eq(recs(a).length,1,'取消覆盖不改变条数');
  ok(recs(a)[0].id !== 'imported','取消覆盖保留原账目');
  eq(e.get('panel').classList.contains('show'),true,'取消覆盖保留预览');
  a.windowShim.confirmResult = true; a.storage.failWrites = true; e.get('panelReplace').onclick();
  ok(recs(a)[0].id !== 'imported','无法保存保护快照时停止覆盖');
  a.storage.failWrites = false; e.get('panelReplace').onclick();
  eq(recs(a)[0].id,'imported','确认后覆盖恢复成功');
  eq(cfgOf(a).budgets['2026-10'],500000,'覆盖恢复包含预算');
  eq(cfgOf(a).budgets.bad,undefined,'恢复预算忽略无效月份');
  eq(cfgOf(a).pin,null,'备份中的 PIN 不会导入');
  const b = runApp({seed:{'jz.records.v1':'broken-json'}});
  openPayload(b); await new Promise(r=>setTimeout(r,0)); b.els.get('panelReplace').onclick();
  eq(recs(b)[0].id,'imported','损坏账本可从有效备份恢复');
  eq(JSON.parse(b.storage.getItem('jz.recovery.v1')).raw,'broken-json','恢复前保存损坏账本原文');
  eq(b.els.get('recoveryWarning').hidden,true,'成功恢复后关闭损坏提示');
}

/* =========== 19. 真实 Service Worker 逻辑：完整安装、缓存隔离与回退 =========== */
{
  const src = readFileSync(join(DIR,'sw.js'),'utf8'), handlers = {}, deleted = [], waited = [];
  const scope = 'https://example.com/moneybook/', prefix = 'jz-' + scope;
  let failInstall = false, activated = false, cached = true, requestedCache = '';
  const cache = { addAll:async reqs=>{ if(failInstall) throw new Error('missing asset'); eq(reqs.length,6,'安装完整预缓存 6 个外壳地址'); }, put:async()=>{} };
  const shim = {
    self:{registration:{scope},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:()=>{activated=true;},clients:{claim:async()=>{}}},
    caches:{open:async()=>cache,keys:async()=>[prefix+'1.4.3',prefix+appVersion,'another-app','jz-https://example.com/other/1.0.0'],delete:async name=>deleted.push(name),match:async(key,opts)=>{requestedCache=opts.cacheName;return cached?new Response('cached-page',{status:200}):undefined;}},
    fetch:async()=>new Response('server-error',{status:500}),
    Request:class{constructor(url,opts){this.url=url;this.cache=opts.cache;}}, Response, URL, location:{origin:'https://example.com'}
  };
  runInNewContext(src,shim);
  handlers.install({waitUntil:p=>waited.push(p)}); await Promise.all(waited.splice(0));
  eq(activated,true,'完整预缓存后激活新版');
  activated=false;failInstall=true;
  handlers.install({waitUntil:p=>waited.push(p)});
  let rejected=false; try{await Promise.all(waited.splice(0));}catch(e){rejected=true;}
  eq(rejected,true,'预缓存缺文件时安装失败');
  eq(activated,false,'预缓存不完整时不会取代旧版');
  handlers.activate({waitUntil:p=>waited.push(p)}); await Promise.all(waited.splice(0));
  eq(deleted,[prefix+'1.4.3'],'只清理当前应用路径的旧缓存');
  let response;
  const req={method:'GET',mode:'navigate',url:scope+'index.html'};
  handlers.fetch({request:req,respondWith:p=>response=p,waitUntil:p=>waited.push(p)});
  eq(await (await response).text(),'cached-page','服务器 500 时回退离线页面');
  eq(requestedCache,prefix+appVersion,'回退只查找当前版本缓存');
  cached=false;
  handlers.fetch({request:req,respondWith:p=>response=p,waitUntil:p=>waited.push(p)});
  eq((await response).status,503,'没有缓存时返回明确的离线错误页');
  let intercepted=false;
  handlers.fetch({request:{method:'GET',mode:'cors',url:'https://example.com/other/backup.json'},respondWith:()=>intercepted=true});
  eq(intercepted,false,'不缓存同域下其他应用的数据');
}

/* ---------------- 输出 ---------------- */
const total = pass + fails.length;
if (fails.length) {
  console.log('\n✗ 自检未通过  ' + pass + '/' + total + '\n');
  fails.forEach((f) => console.log('  ✗ ' + f));
  console.log('');
  process.exit(1);
}
console.log('\n✓ 全部通过  ' + pass + '/' + total + '\n');
process.exit(0);
