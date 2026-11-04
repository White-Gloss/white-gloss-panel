// Operator-Hinweis im Annahmeprotokoll: Vorab-Bestätigung des Kunden vorhanden, alt unterschrieben oder fehlend.
import test from 'node:test';
import assert from 'node:assert/strict';
import {protocolFormHTML} from '../dist/client/protocol-form.js';

const form=handover=>protocolFormHTML({kind:'intake',order:{wg:'WG-1',source:{name:'Erika'},handover:{intake:handover}},company:{}});
test('warning appears without a prior signature and for old signatures without the new confirmation',()=>{
  assert.match(form(undefined),/Keine Vorab-Unterschrift des Kunden/);
  const old=form({mode:'contactless',signature:'sig',keyMethod:'deposit',keyLocation:'Briefkasten'});
  assert.match(old,/Vorab-Unterschrift ohne die neue Bestätigung/);assert.match(old,/bereits vorab im Kundenportal unterschrieben/);
});
test('no warning and a confirmation note when the customer confirmed that only White Gloss fills the protocol',()=>{
  const html=form({mode:'contactless',signature:'sig',operatorOnlyProtocol:true,keyMethod:'deposit',keyLocation:'Briefkasten'});
  assert.doesNotMatch(html,/Vorab-Unterschrift ohne|Keine Vorab-Unterschrift/);assert.match(html,/nur du das Übergabeprotokoll ausfüllst/);assert.match(html,/name="handoverOperatorOnly" value="true"/);
});
