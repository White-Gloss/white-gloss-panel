import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';

const ready={configured:true,enabled:true,mode:'read-only',bridgeConfigured:true};
async function fixture(t,{status=ready,statusOk=true,chatOk=true,chat=async()=>({ok:true,reply:'Antwort'}),history=async()=>({requests:[]}),synthetic=false}={}){
  const dom=new JSDOM('<div id="agent-root"></div>',{url:'https://panel.example.invalid'});
  t.after(()=>dom.window.close());
  const root=dom.window.document.querySelector('#agent-root'),calls=[],historyCalls=[];
  const fetchImpl=async(url,options={})=>{
    if(url==='/api/agent/requests'){historyCalls.push(url);return {ok:true,json:history};}
    if(url.startsWith('/api/agent/requests/'))throw Error('saved answers must not load automatically');
    calls.push({url,options});
    if(url==='/api/agent')return {ok:statusOk,json:async()=>status};
    assert.equal(url,'/api/agent/chat');
    return {ok:chatOk,json:async()=>chat(JSON.parse(options.body))};
  };
  const module=await import('../public/agent.js').catch(()=>null);
  assert.equal(typeof module?.mountAgent,'function','Agent mount must exist');
  await module.mountAgent(root,{fetchImpl,synthetic});
  const input=root.querySelector('[name=message]'),consent=root.querySelector('[name=confirmed]');
  const submit=()=>root.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  return {root,calls,historyCalls,input,consent,submit,tick,dom};
}

test('settings adds Hermes alongside existing assistant without nesting settings forms',async t=>{
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(source,/import\s*\{mountAgent\}\s*from '\.\/agent\.js'/);
  assert.match(source,/mountAgent\(\$\('#agent-root'\),\{synthetic\}\)/);
  assert.match(source,/mountAssistantSettings\(\$\('#assistant-settings'\),\{synthetic\}\)/);
  const settingsFunction=source.split('\n').find(line=>line.startsWith('function settingsPage()'));
  const html=new Function('state','heading','notice','input','esc',settingsFunction+';return settingsPage();')(
    {settings:{standaloneAuth:true},integrations:{}},()=>'',()=>'',(label,name)=>`<input name="${name}">`,value=>String(value??''));
  const dom=new JSDOM(html);t.after(()=>dom.window.close());
  const root=dom.window.document.querySelector('#agent-root');assert.ok(root);
  assert.equal(root.closest('form'),null);
  assert.ok(dom.window.document.querySelector('#assistant-settings'));
  assert.ok(dom.window.document.querySelector('#settingsform [name=numberAudit]'));
  assert.ok(dom.window.document.querySelector('#settingsform [name=qontoKey]'));
});

test('consent is required per prompt, parent submit stays isolated and successful text is escaped',async t=>{
  const f=await fixture(t,{chat:async()=>({ok:true,reply:'<img src=x onerror=alert(1)> & hello'})});
  assert.match(f.root.textContent,/Nur lesend/);
  assert.match(f.root.textContent,/Nachricht.*Hermes-Instanz/);
  assert.match(f.root.textContent,/Auftragszusammenfassungen/,'consent must disclose the CRM snapshot that the backend attaches');
  assert.doesNotMatch(f.root.textContent,/Keine automatische Übertragung von Paneldaten/);
  assert.match(f.root.textContent,/Keine Kundennachrichten, Rechnungen oder Zahlungen/);
  let parentSubmits=0;f.root.parentElement.addEventListener('submit',()=>parentSubmits++);
  f.input.value='Meine Frage';f.submit();await f.tick();assert.equal(f.calls.length,1);
  f.consent.checked=true;f.submit();await f.tick();
  assert.equal(f.calls.length,2);assert.equal(parentSubmits,0);
  const payload=JSON.parse(f.calls[1].options.body);
  assert.equal(payload.message,'Meine Frage');assert.equal(payload.confirmed,true);
  assert.match(payload.requestId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(f.calls[1].options.credentials,'same-origin');
  assert.equal(f.root.querySelector('[data-agent-output]').textContent,'<img src=x onerror=alert(1)> & hello');
  assert.equal(f.root.querySelector('img'),null);
  assert.equal(f.consent.checked,false);assert.equal(f.input.value,'');
  f.input.value='Nächste Frage';f.submit();await f.tick();assert.equal(f.calls.length,2);
  assert.equal(f.dom.window.localStorage.length,0);assert.equal(f.dom.window.sessionStorage.length,0);
});

test('changing a confirmed prompt revokes consent and invalid messages never transmit',async t=>{
  const f=await fixture(t);
  f.input.value='Erster Entwurf';f.consent.checked=true;
  f.input.value='Geänderter Entwurf';f.input.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
  assert.equal(f.consent.checked,false);f.submit();await f.tick();assert.equal(f.calls.length,1);
  for(const text of ['   ','x'.repeat(4001)]){
    f.input.value=text;f.consent.checked=true;f.submit();await f.tick();assert.equal(f.calls.length,1);
  }
});

test('application failure retains prompt and requires renewed consent before explicit retry',async t=>{
  let attempt=0;
  const f=await fixture(t,{chat:async()=>++attempt===1?{ok:false,error:'Bridge verweigert'}:{ok:true,reply:'Gelesen'}});
  f.input.value='Bitte erhalten';f.consent.checked=true;f.submit();await f.tick();
  assert.equal(f.input.value,'Bitte erhalten');assert.equal(f.consent.checked,false);
  assert.match(f.root.querySelector('[data-agent-status]').textContent,/Bridge verweigert/);
  assert.equal(f.root.querySelector('[data-agent-status]').classList.contains('error'),true);
  assert.equal(f.root.querySelector('[data-agent-output]').textContent,'');
  assert.equal(f.calls.length,2);f.submit();await f.tick();assert.equal(f.calls.length,2);
  f.consent.checked=true;f.submit();await f.tick();assert.equal(f.calls.length,3);
  assert.equal(JSON.parse(f.calls[1].options.body).requestId,JSON.parse(f.calls[2].options.body).requestId);
});

test('pending submission blocks concurrency; ambiguous failure retains identity without automatic retry',async t=>{
  let reject;
  const pending=new Promise((resolve,rejectFn)=>{reject=rejectFn;});
  let attempt=0;
  const f=await fixture(t,{chat:async()=>++attempt===1?pending:{ok:true,reply:'Teilantwort',incomplete:true}});
  f.input.value='Bleibt erhalten';f.consent.checked=true;f.submit();f.submit();await f.tick();
  assert.equal(f.calls.length,2);assert.equal(f.input.disabled,true);
  assert.equal(f.root.querySelector('[type=submit]').disabled,true);
  reject(Error('Verbindung abgebrochen'));await f.tick();
  assert.equal(f.input.value,'Bleibt erhalten');assert.equal(f.input.disabled,false);
  assert.equal(f.consent.checked,false);assert.equal(f.calls.length,2);
  assert.match(f.root.querySelector('[data-agent-status]').textContent,/unklar|Unklar/);
  f.consent.checked=true;f.submit();await f.tick();
  const first=JSON.parse(f.calls[1].options.body),retry=JSON.parse(f.calls[2].options.body);
  assert.deepEqual(retry,first);
  assert.equal(f.root.querySelector('[data-agent-output]').textContent,'Teilantwort');
  assert.match(f.root.querySelector('[data-agent-status]').textContent,/unvollständig/);
  f.input.value='Neue Frage';f.consent.checked=true;f.submit();await f.tick();
  assert.notEqual(JSON.parse(f.calls[3].options.body).requestId,first.requestId);
});

test('HTTP status and malformed reply failures stay errors and preserve the editor',async t=>{
  for(const options of [{chatOk:false,chat:async()=>({ok:true,reply:'Must not display',error:'HTTP verweigert'})},{chat:async()=>({ok:true})},{chat:async()=>{throw SyntaxError('Ungültiges JSON');}}]){
    const f=await fixture(t,options);
    f.input.value='Nicht verlieren';f.consent.checked=true;f.submit();await f.tick();
    assert.equal(f.input.value,'Nicht verlieren');assert.equal(f.consent.checked,false);
    assert.equal(f.root.querySelector('[data-agent-status]').classList.contains('error'),true);
    assert.equal(f.root.querySelector('[data-agent-output]').textContent,'');
    assert.equal(f.calls.length,2);
  }
  const f=await fixture(t,{statusOk:false,status:{error:'Status nicht verfügbar'}});
  assert.equal(f.input.disabled,true);assert.match(f.root.textContent,/Status nicht verfügbar/);
});

test('history reloads metadata after sending without fetching the saved answer',async t=>{
  let listed=0;
  const f=await fixture(t,{history:async()=>({requests:++listed>1?[{requestId:'11111111-1111-4111-8111-111111111111',state:'completed',createdAt:1,answerExpired:false}]:[]})});
  assert.equal(f.historyCalls.length,1);
  f.input.value='Neue sichtbare Anfrage';f.consent.checked=true;f.submit();await f.tick();
  assert.equal(f.historyCalls.length,2);
  assert.match(f.root.querySelector('[data-agent-history]').textContent,/Antwort gespeichert/);
  assert.ok(f.root.querySelector('[data-agent-recover]'),'the saved answer stays available without being fetched automatically');
});

test('unconfigured, disabled, missing bridge, unsafe mode and synthetic remain honestly unavailable',async t=>{
  for(const status of [{...ready,configured:false},{...ready,enabled:false},{...ready,bridgeConfigured:false},{...ready,mode:'write'}]){
    const f=await fixture(t,{status});
    assert.equal(f.root.querySelector('[type=submit]').disabled,true);
    assert.match(f.root.textContent,/nicht|deaktiviert/i);
    f.submit();await f.tick();assert.equal(f.calls.length,1);
  }
  const f=await fixture(t,{synthetic:true});
  assert.equal(f.root.querySelector('[type=submit]').disabled,true);
  assert.match(f.root.textContent,/Testbereich/);
});
