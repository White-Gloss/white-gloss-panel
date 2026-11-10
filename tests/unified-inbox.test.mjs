import test from 'node:test';
import assert from 'node:assert/strict';
import {combineInboxData,renderUnifiedInboxList} from '../public/unified-inbox.js';

test('shared inbox merges channel previews by date and links to the channel detail',()=>{
  const items=combineInboxData({
    mailbox:{messages:[{id:'00000000-0000-4000-8000-000000000001',fromName:'E-Mail Kunde',preview:'Neue Anfrage',receivedAt:'2026-11-10T12:00:00Z',read:false}]},
    chats:{threads:[{id:'00000000-0000-4000-8000-000000000002',name:'Chat Kunde',last:{text:'Bitte zurückrufen'},lastAt:'2026-11-10T13:00:00Z',unread:2}]},
    whatsapp:{conversations:[{conversationKey:'4915123456789',senderPhone:'+4915123456789',profileName:'WhatsApp Kunde',lastBody:'Fahrzeugfoto',lastReceivedAt:'2026-11-10T14:00:00Z'}]}
  });
  assert.deepEqual(items.map(item=>item.channel),['WhatsApp','Kundenchat','E-Mail']);
  const html=renderUnifiedInboxList(items);
  assert.match(html,/href="#chat=00000000-0000-4000-8000-000000000002"/);
  assert.match(html,/href="#mail=00000000-0000-4000-8000-000000000001"/);
  assert.match(html,/href="#whatsapp=4915123456789"/);
  assert.match(html,/aria-label="2 ungelesen"/);
});

test('shared inbox filters unread items and escapes provider content',()=>{
  const items=combineInboxData({
    mailbox:{messages:[{id:'00000000-0000-4000-8000-000000000001',fromName:'<img src=x>',preview:'<script>alert(1)</script>',receivedAt:'2026-11-10T12:00:00Z',read:false}]},
    chats:{threads:[]},
    whatsapp:{conversations:[{conversationKey:'4915123456789',profileName:'Gelesen',lastBody:'Schon bearbeitet',lastReceivedAt:'2026-11-10T13:00:00Z'}]}
  });
  const html=renderUnifiedInboxList(items,{filter:'unread'});
  assert.match(html,/&lt;img src=x&gt;/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/Schon bearbeitet/);
  assert.doesNotMatch(html,/<script>/);
});
