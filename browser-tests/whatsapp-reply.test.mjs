// Real browser layout and manual reply flow; run only through the genuine Linux CI harness.
// All WhatsApp credentials, signatures, recipients and provider responses below are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {browserFixture,origin} from './harness.mjs';
import {ingestWhatsAppWebhook} from '../server/whatsapp.mjs';

const settings={phoneNumberId:'123456789012345',graphVersion:'v99.1',accessToken:'synthetic-browser-whatsapp-token',appSecret:'synthetic-browser-whatsapp-secret',verifyToken:'synthetic-browser-whatsapp-verify'};
const sender='491700000000';
const viewports=[{width:1280,height:850},{width:900,height:900},{width:390,height:844}];

async function signedWebhook(env,value){
  const raw=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:'synthetic-browser-waba',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:settings.phoneNumberId},...value}}]}]}));
  return ingestWhatsAppWebhook(env,raw,'sha256='+createHmac('sha256',settings.appSecret).update(raw).digest('hex'));
}
async function refreshThread(page){
  await Promise.all([
    page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/whatsapp'&&url.searchParams.has('conversation');}),
    page.locator('[data-wa-refresh]').click()
  ]);
  await page.locator('#whatsapp-root[aria-busy]').waitFor({state:'detached'});
}
async function assertReplyLayout(page,viewport){
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'WhatsApp view has no horizontal overflow');
  for(const selector of ['#whatsapp-reply-form textarea','[data-wa-reply-send]']){
    const element=page.locator(selector);await element.scrollIntoViewIfNeeded();
    const box=await element.evaluate(element=>{const rect=element.getBoundingClientRect(),style=getComputedStyle(element);return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height,fontSize:parseFloat(style.fontSize)};});
    assert.ok(box.left>=-1&&box.right<=viewport.width+1,selector+' fits horizontally: '+JSON.stringify(box));
    assert.ok(box.top>=-1&&box.bottom<=viewport.height+1,selector+' fits vertically after scrolling: '+JSON.stringify(box));
    assert.ok(box.width>=140,selector+' remains wide enough to read');
    assert.ok(box.height>=(selector.includes('textarea')?90:32),selector+' has usable height');
    assert.ok(box.fontSize>=(selector.includes('textarea')&&viewport.width<760?16:12),selector+' has readable text');
  }
}

for(const viewport of viewports)test(`WhatsApp direct reply and delivery status at ${viewport.width}x${viewport.height}`,async t=>{
  const f=await browserFixture(t,{viewport}),{page}=f,sends=[],providerMessageId='wamid.synthetic.browser.reply.'+viewport.width;
  page.setDefaultTimeout(10000);
  f.env.WHATSAPP_ADAPTERS={
    async check(){return {id:settings.phoneNumberId,verified_name:'Synthetischer Betrieb',display_phone_number:'+1 555 0000000'};},
    async sendReply(config,payload){sends.push({config,payload});return {messages:[{id:providerMessageId}]};}
  };
  await page.goto(origin+'/');
  const setup=await page.evaluate(async settings=>{
    const post=(path,body)=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const saved=await post('/api/whatsapp/settings',settings),checked=await post('/api/whatsapp/check',{});
    return {saved:saved.status,checked:checked.status};
  },settings);
  assert.deepEqual(setup,{saved:200,checked:200});
  const incoming=await signedWebhook(f.env,{contacts:[{wa_id:sender,profile:{name:'Synthetischer Kunde'}}],messages:[{from:sender,id:'wamid.synthetic.browser.incoming.'+viewport.width,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Hallo, ist eine Innenreinigung möglich?'}}]});
  assert.equal(incoming.received,1);

  await page.goto(origin+'/#whatsapp');
  await page.locator('[data-wa-conversation]').click();
  const textarea=page.locator('#whatsapp-reply-form textarea'),sendButton=page.locator('[data-wa-reply-send]');
  await textarea.waitFor({state:'visible'});
  assert.equal(await textarea.getAttribute('maxlength'),'4096');assert.equal(await textarea.evaluate(element=>element.readOnly),false);
  assert.equal(await sendButton.getAttribute('type'),'button');
  assert.match(await page.locator('#whatsapp-reply-form').textContent(),/\+491700000000/);
  assert.equal(await page.locator('#whatsapp-reply-form [name=recipient]').count(),0);
  const first='Guten Tag, eine Innenreinigung ist möglich.';
  await textarea.fill(first);await textarea.press('End');await textarea.press('Enter');
  assert.equal(await textarea.inputValue(),first+'\n','Enter inserts a newline');assert.equal(sends.length,0,'Enter never sends a message');
  const body=first+'\nWelche Fahrzeuggröße hat Ihr Auto?';await textarea.fill(body);
  await refreshThread(page);assert.equal(await textarea.inputValue(),body,'manual refresh preserves the draft');assert.equal(sends.length,0);
  await assertReplyLayout(page,viewport);

  const [sent]=await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/api/whatsapp/reply'&&response.request().method()==='POST'),sendButton.click()]);
  assert.equal(sent.status(),200);await page.locator('.whatsapp-message-outgoing [data-wa-delivery="accepted"]').waitFor();
  await page.locator('#whatsapp-root[aria-busy]').waitFor({state:'detached'});
  assert.equal(sends.length,1);assert.equal(sends[0].config.phoneNumberId,settings.phoneNumberId);
  assert.deepEqual(sends[0].payload,{messaging_product:'whatsapp',recipient_type:'individual',to:'+'+sender,type:'text',text:{preview_url:false,body}});
  assert.equal(await page.locator('.whatsapp-message-outgoing>div').textContent(),body);
  assert.equal(await page.locator('.whatsapp-message-outgoing [data-wa-delivery]').textContent(),'Von Meta angenommen');
  assert.equal(await textarea.inputValue(),'','accepted ledger entry clears the sent draft');

  await signedWebhook(f.env,{statuses:[{id:providerMessageId,recipient_id:sender,status:'delivered',timestamp:String(Math.floor(Date.now()/1000))}]});
  assert.equal(await page.locator('.whatsapp-message-outgoing [data-wa-delivery]').textContent(),'Von Meta angenommen','delivery updates appear only after refresh');
  await refreshThread(page);await page.locator('.whatsapp-message-outgoing [data-wa-delivery="delivered"]').waitFor();
  assert.equal(await page.locator('.whatsapp-message-outgoing [data-wa-delivery]').textContent(),'Zugestellt');
  assert.equal(await page.locator('.whatsapp-message-outgoing [data-wa-delivery="accepted"]').count(),0);
  assert.equal(sends.length,1,'refresh and status updates never resend');
  await assertReplyLayout(page,viewport);await f.screenshot('whatsapp-direct-reply-'+viewport.width);
  assert.equal(f.requests.filter(request=>request.path==='/api/whatsapp/reply'&&request.method==='POST').length,1);
  assert.equal(f.requests.some(request=>request.status>=400),false);assert.deepEqual(f.errors,[]);
});
