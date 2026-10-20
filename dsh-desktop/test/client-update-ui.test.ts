import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let playwright: any;
try {playwright=require(process.env.EAC_BROWSER_TEST_PLAYWRIGHT || 'playwright');}
catch(error){if(process.env.EAC_BROWSER_TEST_PLAYWRIGHT)throw error;}
const source=readFileSync(new URL('../../tauri-shell/src/client-update.html',import.meta.url),'utf8');
test('update page preserves chosen directory, saves manual source and gates install confirmation',
  {skip:!playwright && 'V4 requires existing Playwright and browser'},async t=>{
  const browser=await playwright.chromium.launch({headless:true,channel:process.env.EAC_BROWSER_TEST_CHANNEL||(process.platform==='win32'?'msedge':undefined)});
  t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:760,height:800}});
  await page.addInitScript(()=>{});
  await page.evaluate(()=>{
    const w=window as any;w.calls=[];w.selection={schemaVersion:1,releaseChannel:'stable',selectionMode:'auto',preferredSourceId:'github',geoCountry:null,geoDetectedAt:null,localPath:'',customUrl:''};w.presentation={phase:'idle'};
    w.dshDesktop={updates:{subscribe:()=>()=>{}},_call:async(method:string,p:any)=>{
      w.calls.push({method,p});if(method==='client-update.configure')w.selection=p.selection;
      if(method==='client-update.check')w.presentation={phase:'available',version:'6.0.1'};
      if(method==='client-update.download')w.presentation={phase:'ready',version:'6.0.1'};
      if(method==='client-update.settings')return {selection:w.selection,presentation:w.presentation,currentVersion:'6.0.0',effectiveSourceId:w.selection.preferredSourceId,giteeConfigured:false};
      return w.presentation;
    }};w.__DSH_DIRECTORY_PICKER__={pick:async()=> 'G:\\离线 更新包'};
  });
  await page.setContent(source);await page.waitForFunction(()=>document.getElementById('version')?.textContent==='当前版本 6.0.0');
  assert.equal(await page.locator('#source option[value=gitee]').isDisabled(),true);
  await page.selectOption('#source','local');await page.click('#choose');await page.waitForFunction(()=> (document.getElementById('local') as HTMLInputElement).value==='G:\\离线 更新包');
  await page.click('#save');await page.waitForFunction(()=> (window as any).selection.selectionMode==='manual');
  assert.equal(await page.inputValue('#local'),'G:\\离线 更新包');
  await page.click('#check');await page.waitForSelector('#download:visible');await page.click('#download');await page.waitForSelector('#install:visible');
  page.once('dialog',(dialog:any)=>dialog.dismiss());await page.click('#install');
  assert.equal(await page.evaluate(()=> (window as any).calls.some((c:any)=>c.method==='client-update.prepare')),false);
  page.once('dialog',(dialog:any)=>dialog.accept());await page.click('#install');await page.waitForFunction(()=> (window as any).calls.some((c:any)=>c.method==='client-update.prepare'));
  assert.equal(await page.evaluate(()=> document.documentElement.scrollWidth<=window.innerWidth),true);
});

test('UI checkpoint confirms persisted drafts, rejects unsaved ones and exports only owned preferences',
  {skip:!playwright && 'V4 requires existing Playwright and browser'},async t=>{
  const browser=await playwright.chromium.launch({headless:true,channel:process.env.EAC_BROWSER_TEST_CHANNEL||(process.platform==='win32'?'msedge':undefined)});
  t.after(()=>browser.close());const page=await browser.newPage();
  await page.route('http://eac-fixture.test/**',(route:any)=>route.fulfill({status:200,contentType:'text/html',body:'<div data-composer-card><div contenteditable="true" data-composer-input>durable draft</div></div>'}));
  await page.goto('http://eac-fixture.test/');
  await page.evaluate(()=>{
    const w=window as any;w.checkpoints=[];w.dshDesktop={_call:async(method:string,value:any)=>{w.checkpoints.push({method,value});return {ok:true};}};
    localStorage.setItem('dsh.conversation.session-test',JSON.stringify({draft:'durable draft',view:null}));localStorage.setItem('foreign-auth-token','must-not-export');
  });
  const checkpoint=readFileSync(new URL('../../tauri-shell/src/update-ui-checkpoint.js',import.meta.url),'utf8');
  await page.evaluate(checkpoint+'('+JSON.stringify('a'.repeat(64))+')');
  await page.waitForFunction(()=> (window as any).checkpoints.length===1);
  const first=await page.evaluate(()=> (window as any).checkpoints[0]);assert.equal(first.value.draftSaved,true);assert.deepEqual(Object.keys(first.value.preferences),['dsh.conversation.session-test']);
  await page.evaluate(()=>{(window as any).__EAC_UPDATE_UI__.release();document.querySelector('[contenteditable]')!.textContent='unsaved draft';});
  await page.evaluate(checkpoint+'('+JSON.stringify('b'.repeat(64))+')');await page.waitForFunction(()=> (window as any).checkpoints.length===2);
  assert.equal(await page.evaluate(()=> (window as any).checkpoints[1].value.draftSaved),false);
  await page.evaluate(()=>{(window as any).__EAC_UPDATE_UI__.release();localStorage.clear();localStorage.setItem('dsh.conversation',JSON.stringify({draft:'home draft'}));document.querySelector('[contenteditable]')!.textContent='home draft';});
  await page.evaluate(checkpoint+'('+JSON.stringify('c'.repeat(64))+')');await page.waitForFunction(()=> (window as any).checkpoints.length===3);
  assert.equal(await page.evaluate(()=> (window as any).checkpoints[2].value.draftSaved),true);
  await page.evaluate(()=>{(window as any).__EAC_UPDATE_UI__.release();const rail=document.createElement('div');rail.className='fixture_rail';document.querySelector('[data-composer-card]')!.appendChild(rail);});
  await page.evaluate(checkpoint+'('+JSON.stringify('d'.repeat(64))+')');await page.waitForFunction(()=> (window as any).checkpoints.length===4);
  assert.equal(await page.evaluate(()=> (window as any).checkpoints[3].value.draftSaved),false);

});

test('restart checkpoint freezes interaction and reads existing preferences without restoring an old snapshot',
  {skip:!playwright && 'V4 requires existing Playwright and browser'},async t=>{
  const browser=await playwright.chromium.launch({headless:true,channel:process.env.EAC_BROWSER_TEST_CHANNEL||(process.platform==='win32'?'msedge':undefined)});t.after(()=>browser.close());const page=await browser.newPage();
  await page.route('http://eac-fixture.test/**',(route:any)=>route.fulfill({status:200,contentType:'text/html',body:'<button id="send">Send</button>'}));await page.goto('http://eac-fixture.test/');
  await page.evaluate(()=>{const w=window as any;w.receipts=[];w.clicks=0;document.getElementById('send')!.addEventListener('click',()=>w.clicks++);localStorage.setItem('dsh.locale','zh-CN');localStorage.setItem('foreign-token','private');w.dshDesktop={_call:async(method:string,value:any)=>{w.receipts.push({method,value});return {ok:true};}};});
  const source=readFileSync(new URL('../../tauri-shell/src/update-boot-ui.js',import.meta.url),'utf8');const checkpoint={nonce:'a'.repeat(64),origin:'http://eac-fixture.test',preferences:{'dsh.locale':'zh-CN'}};
  await page.evaluate(source+'('+JSON.stringify(checkpoint)+')');const good=await page.evaluate(()=> (window as any).receipts[0]);assert.equal(good.method,'client-update.ui-restore-checkpoint');assert.equal(good.value.readable,true);
  await page.evaluate(()=>document.getElementById('send')!.click());assert.equal(await page.evaluate(()=> (window as any).clicks),0);
  await page.evaluate(()=>localStorage.setItem('dsh.locale','en-US'));await page.evaluate(source+'('+JSON.stringify(checkpoint)+')');assert.equal(await page.evaluate(()=> (window as any).receipts[1].value.readable),false);assert.equal(await page.evaluate(()=>localStorage.getItem('dsh.locale')),'en-US');
  await page.evaluate(()=> (window as any).__EAC_UPDATE_BOOT__.release());await page.click('#send');assert.equal(await page.evaluate(()=> (window as any).clicks),1);assert.equal(await page.evaluate(()=>localStorage.getItem('foreign-token')),'private');
});
