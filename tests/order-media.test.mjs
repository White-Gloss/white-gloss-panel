import test from 'node:test';import assert from 'node:assert/strict';
import {PHOTO_LIMIT,validatePhoto} from '../server/order-media.mjs';
test('gallery uses exact 50 MiB and rejects disguised or oversized files',()=>{
 assert.equal(PHOTO_LIMIT,52428800);
 assert.throws(()=>validatePhoto(Buffer.from('<svg onload="alert(1)"></svg>'),'image/png'),/vollständiges/);
 assert.throws(()=>validatePhoto(Buffer.alloc(PHOTO_LIMIT+1),'image/jpeg'),/50 MiB/);
 assert.throws(()=>validatePhoto(Buffer.from('ftypheic'),'image/heic'),/HEIC/);
});
