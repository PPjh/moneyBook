/* Real-browser parity and native-adapter contract checks. This does not emulate Android's OS APIs. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const output = join(root, 'app/build/ui-checks'); mkdirSync(output, { recursive: true });
const source = readFileSync(join(root, '../web/index.html'), 'utf8');
const adapter = readFileSync(join(root, 'app/src/main/web/native-adapter.js'), 'utf8');
const version = readFileSync(join(root, 'app/build.gradle'), 'utf8').match(/versionName '([^']+)'/)[1];
const date = new Date(), month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const rows = [
  { id:'existing-native-a', type:'expense', amount:3800, cat:'餐饮', note:'午餐 · 一碗热腾腾的面', date:month+'-18', ts:10 },
  { id:'existing-native-b', type:'expense', amount:1800, cat:'饮品', note:'下午的一杯拿铁', date:month+'-18', ts:9 },
  { id:'existing-native-c', type:'income', amount:850000, cat:'工资', note:'认真生活的底气', date:month+'-16', ts:8 }
];
const config = { theme:'light', snapOn:false, autoExport:'off', backupTarget:'folder', budgets:{[month]:400000}, lastCat:{expense:'餐饮',income:'工资'}, lastFolderBackup:0, lastExport:0, lockDelay:60000, pin:null };
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/native/' || path === '/web/') {
    const native = path === '/native/';
    const html = native ? source.replace('<script>', '<script nonce="test-nonce" src="native-adapter.js"></script><script nonce="test-nonce">') : source;
    const headers = {'content-type':'text/html; charset=utf-8','cache-control':'no-store'};
    if(native) headers['content-security-policy'] = "default-src 'none'; script-src 'nonce-test-nonce'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    response.writeHead(200, headers).end(html); return;
  }
  if (path === '/native/native-adapter.js') { response.writeHead(200, {'content-type':'text/javascript'}).end(adapter); return; }
  const name = path.split('/').pop();
  if (['icon-192.png','icon-512.png','icon-maskable-512.png','manifest.json','sw.js'].includes(name)) {
    response.writeHead(200, {'content-type':name.endsWith('.png')?'image/png':name.endsWith('.js')?'text/javascript':'application/json'}).end(readFileSync(join(root,'../web',name))); return;
  }
  response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true, channel:process.env.MONEYBOOK_BROWSER_CHANNEL || 'msedge'});
const results = [], errors = [];
async function context(native, pin = null, options = {}) {
  const ctx = await browser.newContext({viewport:options.viewport || {width:390,height:844},deviceScaleFactor:options.deviceScaleFactor || 1,colorScheme:'light',reducedMotion:'reduce'});
  await ctx.addInitScript(({native,rows,config,pin,version}) => {
    if(!native) {
      if(!localStorage.getItem('jz.records.v1')) {
        localStorage.setItem('jz.records.v1',JSON.stringify(rows)); localStorage.setItem('jz.config.v1',JSON.stringify(config));
      } return;
    }
    const state = JSON.parse(sessionStorage.getItem('native-harness') || 'null') || {records:rows,config,pin,snapshots:[],folder:{selected:true,name:'轻记账备份',granted:true,error:''},files:[]};
    window.__nativeHarness = state;
    const save = () => sessionStorage.setItem('native-harness',JSON.stringify(state));
    const publicPin = () => state.pin ? {salt:'native',hash:'native',len:state.pin.known?state.pin.value.length:4,native:true,unknownLength:!state.pin.known} : null;
    function call(op,a) {
      if(op==='info') return {version};
      if(op==='get') {
        if(a.key==='jz.records.v1') return JSON.stringify(state.records);
        if(a.key==='jz.config.v1') return JSON.stringify({...state.config,pin:publicPin()}); return null;
      }
      if(op==='set') {
        if(a.key==='jz.records.v1') { if(a.expected!==JSON.stringify(state.records)) throw Error('账本已更新'); state.records=JSON.parse(a.value); }
        else { state.config=JSON.parse(a.value); delete state.config.pin; } save(); return true;
      }
      if(op==='theme'||op==='ready'||op==='lock') return true;
      if(op==='folder') return state.folder;
      if(op==='snapshots') return state.snapshots;
      if(op==='snapshot') {
        const snapshot={nativeId:'snapshot-'+Date.now(),ts:Date.now(),date:new Date().toISOString().slice(0,10),reason:a.reason,n:state.records.length,total:5600,rows:JSON.parse(JSON.stringify(state.records)),config:{budgets:state.config.budgets}};
        state.snapshots.unshift(snapshot);state.snapshots=state.snapshots.slice(0,10);save();return snapshot;
      }
      if(op==='retainSnapshots') {state.snapshots=state.snapshots.filter(s=>a.keep.includes(s.nativeId));save();return true;}
      if(op==='pinVerify') {const valid=state.pin&&state.pin.value===a.pin;if(valid)state.pin.known=true;save();return !!valid;}
      if(op==='pinSet') {state.pin={value:a.pin,known:true};save();return publicPin();}
      if(op==='pinDisable') {state.pin=null;save();return true;}
      if(op==='import') {
        if(a.expected!==JSON.stringify(state.records))throw Error('账本已更新');
        const before=state.records.length;
        if(a.mode==='replace'){state.records=a.rows;state.config.budgets=a.config.budgets||{};}
        else {const have=new Set(state.records.map(r=>r.id));state.records.push(...a.rows.filter(r=>!have.has(r.id)));}
        save();return {ok:true,before,after:state.records.length,added:state.records.length-before,budgetSaved:true};
      }
      throw Error('Unsupported operation: '+op);
    }
    window.MoneyBookNative = {
      call:(op,args)=>{try{return JSON.stringify({ok:true,value:call(op,JSON.parse(args))});}catch(e){return JSON.stringify({ok:false,error:e.message});}},
      request:(id,op,args)=>setTimeout(()=>{
        try {
          const a=JSON.parse(args);let value=true;
          if(state.cancelNext){state.cancelNext=false;throw Error('已取消');}
          if(op==='backup') {
            if(state.failBackup)throw Error('设备存储空间不足');
            state.files.push({text:JSON.stringify({records:state.records,config:{budgets:state.config.budgets}})});
            state.config.lastFolderBackup=Date.now();state.config.lastExport=state.config.lastFolderBackup;
          }
          if(op==='chooseFolder'){state.folder={selected:true,name:'新备份目录',granted:true,error:''};state.config.backupTarget='folder';state.config.lastFolderBackup=0;value=state.folder;}
          if(op==='forgetFolder'){state.folder={selected:false,name:'',granted:false};state.config.backupTarget='download';}
          if(op==='saveFile')state.files.push(a);
          if(op==='importFile')value=state.importText;
          save();window.__moneybookResolve(id,{ok:true,value});
        }catch(e){save();window.__moneybookResolve(id,{ok:false,error:e.message});}
      },0)
    };
  },{native,rows:options.rows || rows,config:{...config,...options.config},pin,version});
  const page = await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(origin+(native?'/native/':'/web/'),{waitUntil:'networkidle'});
  return {ctx,page};
}
try {
  const web = await context(false), native = await context(true), p = native.page;
  const layout = await p.evaluate(() => {
    const box = selector => { const r=document.querySelector(selector).getBoundingClientRect(); return {top:r.top,height:r.height}; };
    return {header:box('.topbar'),summary:box('.summary'),budget:box('.budget-card'),overview:box('.overview'),details:box('.list-heading'),record:box('.rec')};
  });
  results.push({mobileLayout:layout});
  assert.ok(layout.header.height <= 54, 'mobile header should stay compact');
  assert.ok(layout.summary.height <= 110, 'monthly label and amount share a compact row');
  assert.ok(layout.budget.height <= 120, 'budget amount and caption share a row');
  assert.ok(layout.overview.height <= 238, 'combined cards must be smaller than 1.1.1 (268px)');
  assert.ok(layout.details.top <= 365, 'collapsed search must not reserve a full search row');
  assert.ok(layout.record.height>=52 && layout.record.height<=60, 'slightly smaller rows retain a comfortable touch target');
  for(const name of ['details','search','statistics','entry','dark']) {
    if(name==='search')for(const x of [web,native]){await x.page.locator('#toggleSearch').click();await x.page.locator('#searchInput').fill('午餐');}
    if(name==='statistics')for(const x of [web,native])await x.page.locator('[data-view="stats"]').click();
    if(name==='entry')for(const x of [web,native]){await x.page.locator('[data-view="list"]').click();await x.page.locator('#fab').click();}
    if(name==='dark')for(const x of [web,native]){await x.page.locator('#sheetCancel').click();await x.page.locator('[data-view="me"]').click();await x.page.locator('#themeSelect').selectOption('dark');await x.page.locator('[data-view="list"]').click();}
    await Promise.all([web.page,native.page].map(page=>page.waitForTimeout(300)));
    const a=await web.page.screenshot({path:join(output,'web-'+name+'.png')}),b=await p.screenshot({path:join(output,'android-'+name+'.png')});
    assert.equal(createHash('sha256').update(a).digest('hex'),createHash('sha256').update(b).digest('hex'),name+' screenshot must match Web pixel-for-pixel in the same browser');
    results.push(name+': shared Web/native-adapter screenshots are pixel-identical at 390 × 844');
    if(name==='search')for(const x of [web,native]){await x.page.locator('#clearSearch').click();await x.page.locator('#closeSearch').click();}
  }
  for(const x of [web,native]) {
    const page=x.page;
    assert.equal(await page.locator('#searchPopover').isVisible(),false);
    await page.locator('#toggleSearch').click();
    assert.equal(await page.locator('#searchInput').evaluate(el=>el===document.activeElement),true);
    await page.locator('#searchInput').fill('午餐');
    assert.equal(await page.locator('#listCount').innerText(),'1 笔记录');
    assert.equal(await page.locator('#sumExp').innerText(),'¥56.00','search never changes the monthly amount');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#searchPopover').isVisible(),false);
    assert.equal(await page.locator('#toggleSearch').evaluate(el=>el.classList.contains('has-query')),true);
    assert.match(await page.locator('#filterInfo').innerText(),/午餐/);
    await page.locator('#toggleSearch').click();assert.equal(await page.locator('#searchInput').inputValue(),'午餐');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#searchPopover').isVisible(),false);
    assert.equal(await page.locator('#toggleSearch').evaluate(el=>el===document.activeElement),true);
    await page.locator('#toggleSearch').click();await page.locator('#summaryLabel').click();
    assert.equal(await page.locator('#searchPopover').isVisible(),false,'outside click dismisses popup');
    await page.locator('#toggleSearch').click();await page.locator('#clearSearch').click();
    assert.equal(await page.locator('#listCount').innerText(),'3 笔记录');
    assert.equal(await page.locator('#toggleSearch').evaluate(el=>el.classList.contains('has-query')),false);
    await page.keyboard.press('Tab');await page.keyboard.press('Tab');
    assert.equal(await page.locator('#searchPopover').isVisible(),false,'keyboard can leave the non-modal search popup');
    await page.locator('#toggleSearch').click();await page.locator('[data-view="stats"]').click();
    assert.equal(await page.locator('#searchPopover').isVisible(),false,'switching pages dismisses search');
    await page.locator('[data-view="list"]').click();
    if(x===native) {
      await page.locator('#toggleSearch').click();
      assert.equal(await page.evaluate(()=>window.MoneyBookPlatform.back()),true,'native back first closes search');
      assert.equal(await page.locator('#searchPopover').isVisible(),false);
    }
  }
  results.push('search popup: hidden by default, focus, live filtering, active marker, Enter/Escape/outside/Tab/view-change dismissal, query preservation, clear and native back');
  await p.locator('#fab').click();await p.locator('#amt').fill('12.5+3');await p.locator('#note').fill('共享界面新增');await p.locator('#sheetSave').click();
  assert.equal(await p.evaluate(()=>window.__nativeHarness.records.length),4);
  assert.equal(await p.evaluate(()=>window.__nativeHarness.records.find(r=>r.id==='existing-native-a').amount),3800);
  await p.reload({waitUntil:'networkidle'});assert.equal(await p.locator('#listCount').innerText(),'4 笔记录');
  results.push('existing native IDs/amounts preserved; add and reload use the native storage adapter');
  await p.locator('[data-view="me"]').click();await p.locator('#backupNowRow').click();
  await p.waitForFunction(()=>window.__nativeHarness.files.length===1);
  const success=await p.evaluate(()=>window.__nativeHarness.config.lastFolderBackup);assert.ok(success>0);
  await p.evaluate(()=>window.__nativeHarness.failBackup=true);await p.locator('#backupNowRow').click();
  await p.waitForFunction(()=>document.getElementById('toast').textContent.includes('备份失败'));
  assert.equal(await p.evaluate(()=>window.__nativeHarness.config.lastFolderBackup),success);
  await p.evaluate(()=>{window.__nativeHarness.cancelNext=true;});await p.locator('#backupFolderRow').click();
  await p.waitForFunction(()=>!document.getElementById('backupFolderRow').disabled);
  assert.match(await p.locator('#backupFolderInfo').innerText(),/轻记账备份/);
  results.push('native fixed-folder route: write success, failure leaves success time, cancelling preserves old folder');
  await p.evaluate(({month})=>{window.__nativeHarness.importText=JSON.stringify({records:[{id:'imported',type:'income',amount:123400,cat:'工资',note:'导入',date:month+'-18',ts:1}],config:{budgets:{[month]:900000},pin:'must-not-import'}});},{month});
  await p.locator('#restoreFileRow').click();await p.waitForFunction(()=>document.getElementById('panel').classList.contains('show'));
  await p.locator('#panelReplace').click();assert.equal(await p.evaluate(()=>window.__nativeHarness.records[0].id),'imported');
  assert.equal(await p.evaluate(month=>window.__nativeHarness.config.budgets[month],month),900000);
  results.push('native document import -> shared preview -> confirmed native replacement includes budgets');
  await web.ctx.close();await native.ctx.close();
  const phoneLayouts = [];
  async function checkPhone(page, name, compact = true) {
    const metrics = await page.evaluate(() => {
      const box = selector => { const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,height:r.height,left:r.left,right:r.right}; };
      const selectors=['#sumExp','#sumInc','#sumBal','#sumCnt','#budgetValue','#budgetCaption','#budgetUsage','#budgetDaily','#categoryFilter','.check-label'];
      return {width:innerWidth,header:box('.topbar'),summary:box('.summary'),budget:box('.budget-card'),overview:box('.overview'),details:box('.list-heading'),
        record:document.querySelector('.rec')?box('.rec'):null,
        filters:['.filter-seg','#categoryFilter','.check-label'].map(box),
        amounts:selectors.map(selector=>{const el=document.querySelector(selector);return {selector,...box(selector),fits:el.scrollWidth<=el.clientWidth+1};})};
    });
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow: '+name);
    assert.ok(metrics.header.height<=54,'single-row header: '+name);
    assert.ok(Math.max(...metrics.filters.map(x=>x.top))-Math.min(...metrics.filters.map(x=>x.top))<=1,'all filters must share one row: '+name);
    for(const cell of metrics.amounts) {
      assert.ok(cell.fits,cell.selector+' must wrap rather than clip: '+name);
      assert.ok(cell.left>=0 && cell.right<=metrics.width+1,cell.selector+' stays onscreen: '+name);
    }
    if(compact) {
      assert.ok(metrics.overview.height<=244,'compact cards: '+name);
      assert.ok(metrics.details.top<=365,'details remain near the top: '+name);
    }
    if(metrics.record)assert.ok(metrics.record.height>=52 && metrics.record.height<=60,'record rows remain compact and tappable: '+name);
    return metrics;
  }
  for(const width of [320,344,360,375,380,381,390,412,430,480,600,639]) {
    const test=await context(true), page=test.page;
    await page.setViewportSize({width,height:width<=380?740:844});
    phoneLayouts.push(await checkPhone(page,width+'px'));
    if([360,390].includes(width))await page.screenshot({path:join(output,version+'-'+width+'px.png')});
    await page.locator('#toggleSearch').click();
    const popup=await page.locator('#searchPopover').boundingBox();
    assert.ok(popup.x>=0 && popup.x+popup.width<=width,'search popup remains inside phone screen');
    assert.equal(await page.locator('#searchInput').evaluate(el=>el===document.activeElement),true);
    if(width===360)await page.screenshot({path:join(output,version+'-search.png')});
    await page.locator('#searchInput').fill('x'.repeat(80));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'long query stays onscreen');
    await page.locator('#clearSearch').click();await page.locator('#closeSearch').click();
    assert.equal(await page.locator('.rec .mid .c').first().evaluate(el=>getComputedStyle(el).fontSize),'14px');
    assert.equal(await page.locator('.rec .mid .n').first().evaluate(el=>getComputedStyle(el).fontSize),'11.5px');
    assert.equal(await page.locator('.rec .amt').first().evaluate(el=>getComputedStyle(el).fontSize),'15px');
    await page.locator('#allMonths').check();await page.locator('#allMonths').uncheck();
    await page.locator('#categoryFilter').selectOption('饮品');assert.equal(await page.locator('#listCount').innerText(),'1 笔记录');
    await page.locator('#categoryFilter').selectOption('');
    await page.locator('#editBudget').click();
    assert.equal(await page.locator('#budgetInput').isVisible(),true,'budget editor visible at '+width);
    assert.ok((await page.locator('#budgetForm').boundingBox()).width>(await page.locator('.budget-card').boundingBox()).width-40,'budget editor spans the entire card');
    await page.locator('#cancelBudget').click();
    await page.addStyleTag({content:':root{--safe-t:28px;--safe-b:24px}'});
    assert.equal(await page.locator('.topbar').evaluate(el=>getComputedStyle(el).paddingTop),'6px','native host must not add CSS safe-area padding a second time');
    assert.equal(await page.locator('.tabbar').evaluate(el=>getComputedStyle(el).paddingBottom),'9px','native navigation safe area must not be duplicated');
    await page.locator('[data-view="stats"]').click();
    assert.ok((await page.locator('.statgrid .card').first().boundingBox()).height<=74,'compact statistics at '+width);
    await page.locator('[data-view="list"]').click();await page.locator('#fab').click();
    assert.equal(await page.locator('#sheetSave').isVisible(),true,'entry save visible at '+width);
    await test.ctx.close();
  }
  results.push({phoneLayouts});
  const short=await context(true,null,{viewport:{width:360,height:480}});
  await short.page.locator('#toggleSearch').click();
  assert.equal(await short.page.locator('#searchInput').evaluate(el=>{
    const r=el.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===el;
  }),true,'search input remains reachable in a short viewport');
  await short.ctx.close();
  for(const width of [320,360,390]) {
    for(const scenario of ['empty','overspent','large']) {
      const exampleRows=scenario==='empty'?[]:scenario==='overspent'?[{...rows[0],amount:800000}]:[{...rows[0],amount:99999999999},{...rows[2],amount:99999999999}];
      const test=await context(true,null,{viewport:{width,height:740},rows:exampleRows,config:{budgets:scenario==='empty'?{}:{[month]:600000}}});
      await checkPhone(test.page,width+'px / '+scenario,scenario!=='large');
      if(scenario==='overspent')assert.match(await test.page.locator('#budgetCaption').innerText(),/已超出预算/);
      if(scenario==='large')assert.equal(await test.page.locator('#sumExp').innerText(),'¥999,999,999.99');
      if(width===360&&scenario==='empty')await test.page.screenshot({path:join(output,version+'-empty.png')});
      await test.ctx.close();
    }
  }
  for(const [width,scale] of [[360,3.375],[390,2.75]]) {
    const test=await context(true,null,{viewport:{width,height:740},deviceScaleFactor:scale});
    await test.page.addStyleTag({content:'.summary .big,.summary .split b,.budget-value,.brandmark strong{font-weight:700}'});
    await checkPhone(test.page,width+'px / density '+scale+' / bold');
    await test.ctx.close();
  }
  for(const width of [640,768,960,1440]) {
    const test=await context(false,null,{viewport:{width,height:1000}});
    assert.equal(await test.page.locator('.overview').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2,'desktop keeps two cards at '+width);
    assert.ok((await test.page.locator('.summary').boundingBox()).height>=225,'desktop summary is not forced into phone layout');
    if(width===1440)await test.page.screenshot({path:join(output,version+'-desktop.png')});
    await test.ctx.close();
  }
  const safeWeb=await context(false);
  await safeWeb.page.addStyleTag({content:':root{--safe-t:28px;--safe-b:24px}'});
  assert.equal(await safeWeb.page.locator('.topbar').evaluate(el=>getComputedStyle(el).paddingTop),'34px','PWA must retain its own safe area');
  await safeWeb.ctx.close();
  results.push('320–639px: compact cards and single-row filters; zero/unset, overspent, large amounts, bold and two density factors; 640/768/960/1440px desktop preserved');
  results.push('Android CSS avoids duplicate safe areas while PWA retains them');
  const legacy=await context(true,{value:'123456',known:false});
  assert.equal(await legacy.page.locator('#lock').isVisible(),true);
  for(const digit of '123456')await legacy.page.locator('#pad').getByRole('button',{name:digit,exact:true}).click();
  await legacy.page.locator('[data-k="ok"]').click();await legacy.page.waitForFunction(()=>document.getElementById('lock').hidden);
  await legacy.page.reload({waitUntil:'networkidle'});assert.equal(await legacy.page.locator('#lock').isVisible(),true);
  for(const digit of '123456')await legacy.page.locator('#pad').getByRole('button',{name:digit,exact:true}).click();
  await legacy.page.waitForFunction(()=>document.getElementById('lock').hidden);
  await legacy.page.evaluate(()=>window.MoneyBookPlatform.resume(true));assert.equal(await legacy.page.locator('#lock').isVisible(),true);
  results.push('legacy native 6-digit PIN with initially unknown length unlocks; reload and lifecycle resume lock again');
  await legacy.ctx.close();assert.deepEqual(errors,[]);
  writeFileSync(join(output,'results.json'),JSON.stringify({version,results,errors},null,2));
  const summary=results.map(result=>result.phoneLayouts?{phoneLayouts:result.phoneLayouts.map(({width,overview,details})=>({width,cardsHeight:overview.height,detailsTop:details.top}))}:result);
  console.log(JSON.stringify({version,results:summary,errors},null,2));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
