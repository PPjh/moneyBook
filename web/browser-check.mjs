import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless:true, channel:process.env.MONEYBOOK_BROWSER_CHANNEL || 'msedge' });
const errors = [], results = [];
const baseURL = process.env.MONEYBOOK_TEST_URL || 'http://localhost:8080/';
const dir = dirname(fileURLToPath(import.meta.url));
const repoDir = dirname(dir);
const appVersion = readFileSync(join(dir,'index.html'),'utf8').match(/var APP_VERSION = '([^']+)'/)[1];
const screenshotDir = process.env.MONEYBOOK_SCREENSHOT_DIR || join(dir,'screenshots');
mkdirSync(screenshotDir, { recursive:true });
const screenshot = name => join(screenshotDir,appVersion+'-'+name+'.png');
const now = new Date();
const month = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
const prev = new Date(now.getFullYear(), now.getMonth()-1, 1);
const previous = prev.getFullYear() + '-' + String(prev.getMonth()+1).padStart(2,'0');
const rows = [
  { id:'demo-1', date:month+'-18', type:'expense', amount:3800, cat:'餐饮', note:'午餐 · 一碗热腾腾的面', ts:10 },
  { id:'demo-2', date:month+'-18', type:'expense', amount:1800, cat:'饮品', note:'下午的一杯拿铁', ts:9 },
  { id:'demo-3', date:month+'-17', type:'expense', amount:26800, cat:'购物', note:'生活日用品', ts:8 },
  { id:'demo-4', date:month+'-17', type:'expense', amount:600, cat:'交通', note:'地铁通勤', ts:7 },
  { id:'demo-5', date:month+'-16', type:'income', amount:850000, cat:'工资', note:'认真生活的底气', ts:6 },
  { id:'demo-6', date:month+'-15', type:'expense', amount:220000, cat:'居住', note:'每月房租', ts:5 },
  { id:'demo-7', date:month+'-15', type:'expense', amount:9800, cat:'学习', note:'买一本喜欢的书', ts:4 },
  { id:'demo-8', date:previous+'-18', type:'expense', amount:4500, cat:'餐饮', note:'和朋友一起吃午餐', ts:3 }
];
async function newTestPage(viewport){
  const context = await browser.newContext({ viewport, colorScheme:'light', reducedMotion:'reduce' });
  await context.addInitScript(({rows,month})=>{
    if(!localStorage.getItem('jz.records.v1')){
      localStorage.setItem('jz.records.v1', JSON.stringify(rows));
      localStorage.setItem('jz.config.v1', JSON.stringify({autoExport:'off',snapOn:false,theme:'light',budgets:{[month]:400000}}));
    }
  }, {rows,month});
  const page = await context.newPage();
  page.on('pageerror', err=>errors.push(err.message));
  page.on('dialog', dialog=>dialog.accept());
  await page.goto(baseURL, {waitUntil:'networkidle'});
  await page.waitForFunction(()=>navigator.serviceWorker.controller);
  return { page, context };
}
try{
  const {page, context} = await newTestPage({width:1440,height:1000});
  assert.equal(await page.locator('#listCount').innerText(), '7 笔记录');
  assert.equal(await page.locator('#budgetValue').innerText(), '¥1,372.00');
  await page.screenshot({path:screenshot('desktop'),fullPage:true});
  assert.equal(await page.locator('#searchPopover').isVisible(),false,'search is hidden by default');
  await page.locator('#toggleSearch').click();
  assert.equal(await page.locator('#searchInput').evaluate(el=>el===document.activeElement),true,'search receives focus');
  await page.getByRole('searchbox').fill('午餐');
  assert.equal(await page.locator('#listCount').innerText(), '1 笔记录');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#searchPopover').isVisible(),false,'Enter dismisses search, preserving the query');
  assert.equal(await page.locator('#toggleSearch').evaluate(el=>el.classList.contains('has-query')),true);
  await page.locator('#toggleSearch').click();
  assert.equal(await page.locator('#searchInput').inputValue(),'午餐');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#searchPopover').isVisible(),false);
  assert.equal(await page.locator('#toggleSearch').evaluate(el=>el===document.activeElement),true,'Escape returns focus');
  await page.getByLabel('跨月查找').check();
  assert.equal(await page.locator('#listCount').innerText(), '2 笔记录');
  await page.locator('#toggleSearch').click();
  await page.locator('#clearSearch').click();
  await page.locator('#closeSearch').click();
  await page.getByLabel('跨月查找').uncheck();
  await page.locator('#listSeg').getByRole('button',{name:'收入',exact:true}).click();
  assert.equal(await page.locator('#listCount').innerText(), '1 笔记录');
  await page.locator('#listSeg').getByRole('button',{name:'全部',exact:true}).click();
  await page.getByRole('button',{name:'记一笔',exact:true}).click();
  await page.getByLabel('金额（元）').fill('12.50');
  await page.getByLabel('备注',{exact:true}).fill('浏览器回归测试');
  await page.getByRole('button',{name:'保存并继续',exact:true}).click();
  assert.equal(await page.locator('#amt').inputValue(),'');
  assert.equal(await page.locator('#sheet').evaluate(el=>el.classList.contains('show')),true);
  await page.locator('#amt').fill('8.25');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  assert.equal(await page.locator('#listCount').innerText(),'9 笔记录');
  await page.locator('.rec').first().click();
  await page.getByRole('button',{name:'删除',exact:true}).click();
  assert.equal(await page.locator('#listCount').innerText(),'8 笔记录');
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  assert.equal(await page.locator('#listCount').innerText(),'9 笔记录');
  await page.locator('#editBudget').click();
  await page.locator('#budgetInput').fill('5000');
  await page.getByRole('button',{name:'保存预算',exact:true}).click();
  assert.equal(await page.locator('#budgetValue').innerText(),'¥2,351.25');
  await page.locator('#toast').evaluate(el=>el.classList.remove('show'));
  await page.locator('[data-view="stats"]').click();
  await page.screenshot({path:screenshot('stats'),fullPage:true});
  await page.locator('[data-view="me"]').click();
  await page.getByLabel('外观主题').selectOption('dark');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.locator('[data-view="list"]').click();
  await page.screenshot({path:screenshot('dark'),fullPage:true});
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await context.setOffline(true);
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.locator('#appVer').textContent(),appVersion);
  assert.equal(await page.locator('#listCount').innerText(),'9 笔记录');
  results.push('desktop: search/type/cross-month/continue/delete-undo/budget/theme/offline passed');
  await context.close();

  const mobile = await newTestPage({width:390,height:844});
  await mobile.page.screenshot({path:screenshot('mobile'),fullPage:true});
  assert.equal(await mobile.page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
  await mobile.page.locator('#fab').click();
  await mobile.page.screenshot({path:screenshot('entry'),fullPage:true});
  assert.equal(await mobile.page.locator('#amt').isVisible(),true);
  await mobile.page.keyboard.press('Escape');
  await mobile.page.locator('[data-view="me"]').click();
  await mobile.page.getByRole('switch',{name:'密码锁',exact:true}).click();
  assert.equal(await mobile.page.getByRole('button',{name:'确认 PIN'}).isVisible(),true);
  for(const digit of '1234') await mobile.page.locator('#pad').getByRole('button',{name:digit,exact:true}).click();
  await mobile.page.getByRole('button',{name:'确认 PIN'}).click();
  for(const digit of '1234') await mobile.page.locator('#pad').getByRole('button',{name:digit,exact:true}).click();
  await mobile.page.waitForFunction(()=>document.getElementById('lock').hidden);
  await mobile.page.reload({waitUntil:'networkidle'});
  assert.equal(await mobile.page.locator('#lock').isVisible(),true);
  for(const digit of '1234') await mobile.page.locator('#pad').getByRole('button',{name:digit,exact:true}).click();
  await mobile.page.waitForFunction(()=>document.getElementById('lock').hidden);
  results.push('mobile: layout/dialog/PIN setup-confirm-reload-unlock passed');
  await mobile.context.close();
  for(const width of [320,360,768]){
    const test = await newTestPage({width,height:740});
    assert.equal(await test.page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,`no horizontal overflow at ${width}`);
    await test.page.locator('#fab').click();
    assert.equal(await test.page.getByRole('button',{name:'保存',exact:true}).isVisible(),true,`entry save visible at ${width}`);
    await test.page.keyboard.press('Escape');
    await test.page.locator('[data-view="stats"]').click();
    assert.equal(await test.page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,`stats no overflow at ${width}`);
    await test.context.close();
  }
  results.push('responsive: 320/360/390/768/1440 widths passed');

  const concurrent = await newTestPage({width:1200,height:900});
  const second = await concurrent.context.newPage();
  await second.goto(baseURL,{waitUntil:'networkidle'});
  await second.locator('#fab').click(); await second.locator('#amt').fill('99');
  await concurrent.page.locator('#fab').click(); await concurrent.page.locator('#amt').fill('21');
  await concurrent.page.locator('#sheetSave').click();
  await second.locator('#sheetSave').click();
  assert.equal(await second.locator('#sheet').evaluate(el=>el.classList.contains('show')),true);
  assert.equal(await second.locator('#conflictWarning').evaluate(el=>el.hidden),false);
  assert.equal(await second.evaluate(()=>JSON.parse(localStorage.getItem('jz.records.v1')).length),9);
  await concurrent.context.close();
  results.push('concurrency: stale tab cannot overwrite newer records');

  // 选择器使用隔离的 OPFS 测试目录；写文件与 IndexedDB 句柄持久化走真实浏览器 API。
  const fixed = await newTestPage({width:390,height:844}), fp = fixed.page;
  async function savedBackups(){
    return fp.evaluate(async()=>{
      const root=await navigator.storage.getDirectory(), folder=await root.getDirectoryHandle('轻记账备份测试');
      const out=[];
      for await(const [name,handle] of folder.entries()){
        if(handle.kind==='file'){const file=await handle.getFile();out.push({name,text:await file.text(),size:file.size});}
      }
      return out;
    });
  }
  await fp.evaluate(()=>{
    window.__cancelFolder=true;
    window.showDirectoryPicker=async()=>{
      if(window.__cancelFolder)throw new DOMException('cancelled','AbortError');
      const root=await navigator.storage.getDirectory();return root.getDirectoryHandle('轻记账备份测试',{create:true});
    };
  });
  await fp.locator('[data-view="me"]').click();
  await fp.locator('#backupFolderRow').click();
  assert.match(await fp.locator('#backupFolderInfo').innerText(),/尚未选择/);
  await fp.evaluate(()=>window.__cancelFolder=false);
  await fp.locator('#backupFolderRow').click();
  await fp.waitForFunction(()=>document.getElementById('backupFolderInfo').textContent.includes('轻记账备份测试'));
  await fp.locator('#backupNowRow').click();
  await fp.waitForFunction(()=>JSON.parse(localStorage.getItem('jz.config.v1')).lastFolderBackup>0);
  let saved=await savedBackups();
  assert.equal(saved.length,1);assert.equal(JSON.parse(saved[0].text).records.length,rows.length);
  assert.equal('pin' in JSON.parse(saved[0].text).config,false);
  await fp.locator('#backupNowRow').click();
  await fp.waitForFunction(()=>!document.getElementById('backupNowRow').disabled);
  assert.equal((await savedBackups()).length,2);
  await fp.reload({waitUntil:'networkidle'});
  assert.match(await fp.locator('#backupFolderInfo').innerText(),/轻记账备份测试/);
  await fp.locator('#backupNowRow').click();
  await fp.waitForFunction(()=>!document.getElementById('backupNowRow').disabled);
  assert.equal((await savedBackups()).length,3);
  await fp.evaluate(()=>{
    const cfg=JSON.parse(localStorage.getItem('jz.config.v1'));cfg.autoExport='daily';cfg.lastFolderBackup=0;
    localStorage.setItem('jz.config.v1',JSON.stringify(cfg));
  });
  await fp.reload({waitUntil:'networkidle'});
  await fp.waitForFunction(()=>JSON.parse(localStorage.getItem('jz.config.v1')).lastFolderBackup>0);
  assert.equal((await savedBackups()).length,4);
  await fp.addInitScript(()=>{
    if(sessionStorage.getItem('test-folder-permission')){
      window.__folderPermission=sessionStorage.getItem('test-folder-permission');window.__permissionRequests=0;window.__permissionQueries=0;
      FileSystemDirectoryHandle.prototype.queryPermission=async()=>{window.__permissionQueries++;return window.__folderPermission;};
      FileSystemDirectoryHandle.prototype.requestPermission=async()=>{
        window.__permissionRequests++;window.__folderPermission=window.__requestResult||'denied';return window.__folderPermission;
      };
    }
  });
  // 最近已成功备份：新会话返回 prompt 不等于权限被拒绝，不应一重开就报警。
  await fp.evaluate(()=>sessionStorage.setItem('test-folder-permission','prompt'));
  await fp.reload({waitUntil:'networkidle'});
  await fp.waitForFunction(()=>document.getElementById('backupFolderInfo').textContent.includes('位置已记住'));
  assert.equal(await fp.locator('#backupLocationWarning').isVisible(),false);
  assert.equal(await fp.evaluate(()=>window.__permissionRequests),0);
  assert.equal((await savedBackups()).length,4);
  // 周期关闭时也不因待确认访问而报警，但显式拒绝仍需提醒。
  await fp.evaluate(()=>{
    const cfg=JSON.parse(localStorage.getItem('jz.config.v1'));cfg.autoExport='off';cfg.lastFolderBackup=0;
    localStorage.setItem('jz.config.v1',JSON.stringify(cfg));
  });
  await fp.reload({waitUntil:'networkidle'});
  await fp.waitForFunction(()=>document.getElementById('backupFolderInfo').textContent.includes('位置已记住'));
  assert.equal(await fp.locator('#backupLocationWarning').isVisible(),false);
  await fp.evaluate(()=>sessionStorage.setItem('test-folder-permission','denied'));
  await fp.reload({waitUntil:'networkidle'});
  await fp.waitForFunction(()=>document.getElementById('backupFolderInfo').textContent.includes('访问被拒绝'));
  assert.equal(await fp.locator('#backupLocationWarning').isVisible(),true);
  await fp.evaluate(()=>{
    sessionStorage.setItem('test-folder-permission','prompt');
    const cfg=JSON.parse(localStorage.getItem('jz.config.v1'));cfg.autoExport='daily';cfg.lastFolderBackup=0;localStorage.setItem('jz.config.v1',JSON.stringify(cfg));
  });
  await fp.reload({waitUntil:'networkidle'});
  await fp.waitForFunction(()=>document.getElementById('backupFolderInfo').textContent.includes('位置已记住'));
  await fp.waitForFunction(()=>window.__permissionQueries>=2);
  assert.equal(await fp.locator('#backupLocationWarning').isVisible(),true);
  assert.match(await fp.locator('#backupLocationWarningText').innerText(),/备份尚未完成/);
  assert.equal(await fp.evaluate(()=>window.__permissionRequests),0);
  assert.equal((await savedBackups()).length,4);
  await fp.locator('#backupNowRow').click();
  await fp.waitForFunction(()=>!document.getElementById('backupNowRow').disabled);
  assert.equal(await fp.evaluate(()=>JSON.parse(localStorage.getItem('jz.config.v1')).lastFolderBackup),0);
  assert.equal((await savedBackups()).length,4);
  await fp.evaluate(()=>window.__requestResult='granted');
  await fp.locator('#backupNowRow').click();
  await fp.waitForFunction(()=>JSON.parse(localStorage.getItem('jz.config.v1')).lastFolderBackup>0);
  assert.equal(await fp.locator('#backupLocationWarning').isVisible(),false);
  assert.equal((await savedBackups()).length,5);
  await fp.locator('#backupFolderRow').scrollIntoViewIfNeeded();
  await fp.locator('#toast').evaluate(el=>el.classList.remove('show'));
  await fp.screenshot({path:screenshot('backup'),fullPage:true});
  const beforeFailure=await fp.evaluate(()=>JSON.parse(localStorage.getItem('jz.config.v1')).lastFolderBackup);
  await fp.evaluate(()=>{FileSystemFileHandle.prototype.createWritable=async()=>{throw new DOMException('disk full','QuotaExceededError');};});
  await fp.locator('#backupNowRow').click();
  await fp.waitForFunction(()=>document.getElementById('toast').textContent.includes('备份失败'));
  assert.equal(await fp.evaluate(()=>JSON.parse(localStorage.getItem('jz.config.v1')).lastFolderBackup),beforeFailure);
  saved=await savedBackups();assert.equal(saved.length,5);assert.ok(saved.every(file=>file.size>0));
  await fp.locator('#resetBackupFolderRow').click();
  await fp.waitForFunction(()=>JSON.parse(localStorage.getItem('jz.config.v1')).backupTarget==='download');
  assert.equal((await savedBackups()).length,5);
  await fixed.context.close();
  results.push('fixed folder: cancel/select/write/persist/reload/automatic/permission recovery/failure cleanup/disable-preserve passed');
  results.push('permission reminder: prompt without backup due stays quiet; denied/overdue/write failure still warn');

  const fallbackContext=await browser.newContext();
  await fallbackContext.addInitScript(({rows})=>{
    Object.defineProperty(window,'showDirectoryPicker',{value:undefined});
    localStorage.setItem('jz.records.v1',JSON.stringify(rows));
    localStorage.setItem('jz.config.v1',JSON.stringify({autoExport:'off',snapOn:false}));
  },{rows});
  const fallbackPage=await fallbackContext.newPage();
  await fallbackPage.goto(baseURL,{waitUntil:'networkidle'});
  await fallbackPage.locator('[data-view="me"]').click();
  assert.match(await fallbackPage.locator('#backupFolderInfo').innerText(),/不支持固定文件夹/);
  const download=fallbackPage.waitForEvent('download');
  await fallbackPage.locator('#backupNowRow').click();
  assert.ok((await download).suggestedFilename().endsWith('.json'));
  await fallbackContext.close();
  results.push('compatibility: unsupported browser explicitly falls back to download');

  // 在独立来源中先安装 Git 中的 1.4.3，再切换当前文件，验证真实旧缓存升级。
  const baseline = '0ee95bd';
  const oldIndex = execFileSync('git',['show',baseline+':index.html'],{cwd:repoDir});
  const oldSW = execFileSync('git',['show',baseline+':sw.js'],{cwd:repoDir});
  let old = true;
  const assets = new Set(['index.html','sw.js','manifest.json','icon-192.png','icon-512.png','icon-maskable-512.png']);
  const server = createServer((req,res)=>{
    const name = new URL(req.url,'http://localhost').pathname.replace(/^\//,'') || 'index.html';
    if(!assets.has(name)){res.writeHead(404).end();return;}
    const body = old && name==='index.html' ? oldIndex : old && name==='sw.js' ? oldSW : readFileSync(join(dir,name));
    res.writeHead(200,{'content-type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':'image/png','cache-control':'no-store'}).end(body);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const migration = await browser.newContext();
  try{
    const p = await migration.newPage(); p.on('pageerror',err=>errors.push(err.message));
    p.on('dialog',dialog=>dialog.accept());
    await p.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'networkidle'});
    await p.waitForFunction(()=>navigator.serviceWorker.controller);
    assert.equal(await p.locator('#appVer').innerText(),'1.4.3');
    await p.evaluate(rows=>{
      localStorage.setItem('jz.records.v1',JSON.stringify(rows));
      localStorage.setItem('jz.config.v1',JSON.stringify({autoExport:'off',snapOn:false,pin:{salt:'migration',hash:window.__jz.pinHash('1234','migration'),len:4}}));
    },rows);
    old = false;
    await p.reload({waitUntil:'networkidle'});
    await p.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();});
    await p.waitForFunction(async version=> (await caches.keys()).some(name=>name.endsWith(version)),appVersion);
    await p.waitForFunction(version=>document.getElementById('appVer').textContent===version,appVersion);
    assert.equal(await p.locator('#lock').isVisible(),true);
    for(const digit of '1234') await p.locator('#pad').getByRole('button',{name:digit,exact:true}).click();
    await p.waitForFunction(()=>document.getElementById('lock').hidden);
    assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('jz.records.v1')).length),rows.length);
    await migration.setOffline(true); await p.reload({waitUntil:'networkidle'});
    assert.equal(await p.locator('#appVer').textContent(),appVersion);
    results.push('migration: real 1.4.3 service worker -> '+appVersion+', existing PIN and records, offline reload passed');
  }finally{await migration.close();await new Promise(resolve=>server.close(resolve));}
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({results,errors},null,2));
}finally{ await browser.close(); }
