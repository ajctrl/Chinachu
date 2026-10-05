'use strict';
// Optional browser regression suite: set CHINACHU_PLAYWRIGHT_MODULE to a local Playwright install.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require(process.env.CHINACHU_PLAYWRIGHT_MODULE || 'playwright');
const base = path.resolve(__dirname, '../web');
(async()=>{const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {const page=await browser.newPage();const errors=[],saved=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error'){errors.push(message.text());console.error(message.text());}});
await page.route('http://chinachu.test/**',route=>{
 const pathname=new URL(route.request().url()).pathname;
 if(pathname==='/') return route.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><link rel="stylesheet" href="/lib/webawesome/dist-cdn/styles/themes/default.css"><link rel="stylesheet" href="/ui.css"><script src="/runtime.js"></script><script src="/ui.js"></script><script type="module" src="/components.js"></script><button id="trigger">Open</button>'});
 if(pathname.startsWith('/api/')) {
  if(route.request().method()==='GET') return route.fulfill({json:{types:['GR'],channels:['27','unknown'],reserve_titles:['元のタイトル'],hour:{start:2,end:23},duration:{min:60,max:3600}}});
  saved.push({path:pathname,method:route.request().method(),body:route.request().postDataJSON()});
  return route.fulfill({status:route.request().method()==='POST'?201:200,json:{}});
 }
 const file=base+pathname;
 if(!fs.existsSync(file)) return route.fulfill({status:404});
 return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream',body:fs.readFileSync(file)});
});
await page.goto('http://chinachu.test/');
await page.evaluate(()=>window.chinachuComponentsReady);
await page.locator('#trigger').focus();
await page.evaluate(()=>{
 window.form=ChinachuUI.createForm({fields:[
 {key:'c:v',label:'映像コーデック',input:{type:'radios',val:'copy',items:['copy','h264']}},
 {key:'s',label:'サイズ',input:{type:'select',val:'HD',items:['HD','SD']},depends:[{pointer:'/c:v',val:'copy',op:'!=='}]},
 {key:'channel',label:'チャンネル',input:{type:'checkboxes',val:['GR'],items:['GR','BS']}},
 {key:'hour',label:'時間',input:{type:'number',min:0,max:24,val:12}},
 ]});
 window.modal=ChinachuUI.createModal({title:'ルール編集',content:form.element,buttons:[{label:'保存',onSelect(e,m){window.result=form.getResult();m.close();}}]}).show();
});
await page.waitForFunction(()=>customElements.get('wa-dialog')&&document.querySelector('wa-dialog').shadowRoot.querySelector('dialog').open);
await page.waitForTimeout(600);
assert.equal(await page.getByRole('dialog').isVisible(),true);
await page.getByRole('radio',{name:'h264'}).check();
await page.waitForFunction(()=>!form.fields[1].element.hidden);
assert.deepEqual(await page.evaluate(()=>form.getResult()),{'c:v':'h264',s:'HD',channel:['GR'],hour:12});
await page.getByRole('button',{name:'保存',exact:true}).click();
await page.waitForTimeout(500);
assert.equal(await page.locator('wa-dialog').count(),0);
assert.deepEqual(await page.evaluate(()=>result),{'c:v':'h264',s:'HD',channel:['GR'],hour:12});
assert.equal(await page.evaluate(()=>document.activeElement.id),'trigger');
await page.evaluate(()=>{
 window.slider=new ChinachuUI.Slider({max:10,value:5});document.body.appendChild(slider);window.slides=0;slider.addEventListener('slide',()=>slides++);
 window.tokens=ChinachuUI.createTokenizer();document.body.appendChild(tokens);
 ChinachuUI.createTab({tabs:[{label:'One',content:'ONE'},{label:'Two',content:'TWO',onSelect(){window.tabSelected=true;}}]}).insertTo(document.body);
});
await page.waitForTimeout(600);
await page.getByRole('slider').focus();await page.keyboard.press('ArrowRight');
assert.equal(await page.evaluate(()=>slider.getValue()),6);
assert.equal(await page.evaluate(()=>slides),1);
await page.locator('wa-input').last().getByRole('textbox').fill('テスト');await page.keyboard.press('Enter');
assert.deepEqual(await page.evaluate(()=>tokens.getValues()),['テスト']);
await page.getByRole('tab',{name:'Two'}).click();await page.waitForTimeout(200);
assert.equal(await page.getByRole('tabpanel',{name:'Two'}).textContent(),'TWO');
assert.equal(await page.evaluate(()=>window.tabSelected),true);
await page.evaluate(()=>{
 window.scope={_cleanups:[],_requests:new Set()};
 Chinachu.withScope(scope,()=>{
  window.scopedButton=ChinachuUI.createButton({label:'Scoped action',onSelect(){window.callbackScope=Chinachu.scope;}});
  document.body.append(scopedButton);
  window.scopedModal=ChinachuUI.createModal({title:'Scoped modal',text:'Cleanup check'});
 });
});
await page.getByRole('button',{name:'Scoped action',exact:true}).click();
await page.waitForTimeout(100);
assert.equal(await page.evaluate(()=>callbackScope===scope),true);
await page.evaluate(()=>scopedModal.open());
await page.waitForTimeout(300);
await page.evaluate(()=>{scope._disposed=true;scope._cleanups.forEach(cleanup=>cleanup());});
await page.waitForTimeout(300);
assert.equal(await page.evaluate(()=>scopedModal.entity.isConnected),false);
await checkRuleActions(page,saved);
assert.deepEqual(errors,[]);
console.log('Browser UI checks passed: dialogs/focus, dependencies/results, slider, tokenizer, tabs, scoped cleanup, rule edit/new/from-program saves and channel selection.');
} finally {await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});


async function checkRuleActions(page, saved) {
    await page.evaluate(() => {
        const channel = { id: 'gr1', channel: '27', type: 'GR', sid: 101, name: 'テスト総合', programs: [] };
        const program = { id: 'program1', title: '番組から作成', category: 'anime', channel, flags: [], start: Date.now(), end: Date.now() + 1800000, seconds: 1800 };
        channel.programs.push(program);
        const second = { id: 'bs1', channel: 'BS09', type: 'BS', sid: 211, name: 'テストBS', programs: [] };
        window.global = { chinachu: { recorded: [], recording: [], reserves: [], schedule: [channel, second] } };
        const createForm = ChinachuUI.createForm;
        ChinachuUI.createForm = options => { window.latestForm = createForm(options); return window.latestForm; };
    });
    await page.addScriptTag({ url: '/channel-selector.js' });
    await page.addScriptTag({ url: '/class.js' });
    await page.evaluate(() => { new chinachu.ui.EditRule(0); });
    await page.getByRole('dialog', { name: 'ルール編集', exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => latestForm.getResult().channels), ['27', 'unknown']);
    const picker = page.locator('.channel-selector[aria-label="対象CH"]');
    await picker.locator('.channel-selector-picker > summary').click();
    await picker.getByRole('checkbox', { name: '[BS] テストBS' }).check();
    const start = page.locator('wa-input[aria-label="何時から"]').locator('input');
    await start.fill('25');
    assert.equal(await page.evaluate(() => latestForm.validate()), false);
    await start.fill('3');
    assert.equal(await page.evaluate(() => latestForm.validate()), true);
    await page.getByRole('button', { name: '変更', exact: true }).click();
    await page.getByRole('dialog', { name: '成功', exact: true }).waitFor();
    assert.equal(saved[0].method, 'PUT');
    assert.equal(saved[0].path, '/api/rules/0.json');
    assert.deepEqual(saved[0].body.channels, ['27', 'unknown', 'bs1']);
    assert.deepEqual(saved[0].body.hour, { start: 3, end: 23 });
    assert.deepEqual(saved[0].body.reserve_titles, ['元のタイトル']);
    await closeSuccess(page);

    await page.evaluate(() => { new chinachu.ui.NewRule(); });
    await page.getByRole('dialog', { name: '新規作成', exact: true }).waitFor();
    const titleField = page.locator('.chinachu-form-field').filter({ has: page.locator('label.chinachu-form-label', { hasText: /^対象タイトル$/ }) });
    await titleField.locator('wa-input').getByRole('textbox').fill('新しい番組');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: '作成', exact: true }).click();
    await page.getByRole('dialog', { name: '成功', exact: true }).waitFor();
    assert.equal(saved[1].method, 'POST');
    assert.deepEqual(saved[1].body.reserve_titles, ['新しい番組']);
    assert.deepEqual(saved[1].body.hour, { start: 0, end: 24 });
    assert.equal(saved[1].body.isEnabled, true);
    await closeSuccess(page);

    await page.evaluate(() => { new chinachu.ui.CreateRuleByProgram('program1'); });
    await page.getByRole('dialog', { name: '新規作成', exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => latestForm.getResult().channels), ['gr1']);
    await page.getByRole('button', { name: '作成', exact: true }).click();
    await page.getByRole('dialog', { name: '成功', exact: true }).waitFor();
    assert.deepEqual(saved[2].body.types, ['GR']);
    assert.deepEqual(saved[2].body.channels, ['gr1']);
    assert.deepEqual(saved[2].body.reserve_titles, ['番組から作成']);
}

async function closeSuccess(page) {
    await page.locator('wa-dialog[label="成功"] .chinachu-dialog-actions wa-button').click();
    await page.waitForFunction(() => !document.querySelector('wa-dialog'));
}
