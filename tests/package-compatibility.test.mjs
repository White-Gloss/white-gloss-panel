import test from 'node:test';
import assert from 'node:assert/strict';
import {assessmentSeed} from '../src/assessment.mjs';
import {packageMinutes,extraIncluded} from '../src/catalog.mjs';

for(const [id,legacy,current,price,minutes] of [
  ['basis','Basisreinigung','White-Gloss Classic',14900,180],
  ['premium','Reinigung & Politur','White-Gloss Signature',34900,360],
  ['keramik','Keramikschutz','White-Gloss Ceramic',89900,2880],
]) {
  test('name-only requests retain package identity, duration and price: '+legacy,()=>{
    for(const name of [legacy,current]) for(const amountCents of [price,price+1234]) {
      const source={package:name,vehicleClass:'Kompaktklasse',amountCents,pickupCents:0,extras:[]};
      const copy=structuredClone(source),seed=assessmentSeed(source);
      const line=seed.lines.find(item=>item.kind==='package');
      assert.equal(line.catalogId,id);
      assert.equal(packageMinutes[line.catalogId],minutes);
      assert.equal(extraIncluded(line.catalogId,'glas'),id==='keramik');
      assert.equal(extraIncluded(line.catalogId,'leder'),id==='keramik');
      assert.equal(seed.lines.reduce((sum,item)=>sum+item.amountCents,0),amountCents);
      assert.deepEqual(source,copy);
    }
  });
}
