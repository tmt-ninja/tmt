// Offline path-swap and streaming integrity tests. No auth or HTTP dependency.
'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {prepare,upload} = require('../../src/deploy_firestore/hosting-file.cjs');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function world(t, bytes = Buffer.from('hello')) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'tmt-hosting-stream-')));
  t.after(() => fs.rmSync(root,{recursive:true}));
  const file = path.join(root,'file.js');
  fs.writeFileSync(file,bytes);
  return {file,reference:{path:file,length:bytes.length,sha256:sha(bytes)},
    open:()=>fs.openSync(file,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)};
}
async function collect(stream) {
  const chunks=[];
  for await(const bytes of stream) chunks.push(bytes);
  return Buffer.concat(chunks);
}
test('capture and upload use one deterministic streaming gzip identity',async(t)=>{
  const w=world(t);
  const prepared=await prepare(w.reference);
  const sent=upload(w.reference,prepared);
  const gzip=await collect(sent.body);
  await sent.completion;
  assert.deepEqual(prepared,{sha256:sha(gzip),length:gzip.length});
  assert.equal(gzip[9],255);
  assert.deepEqual(zlib.gunzipSync(gzip),Buffer.from('hello'));
  assert.deepEqual(gzip,Buffer.from([31,139,8,0,0,0,0,0,0,255,203,72,205,201,201,7,0,134,166,16,54,5,0,0,0]));
});
test('empty and above-former-cap files stream without a product size cap',async(t)=>{
  for(const bytes of [Buffer.alloc(0),crypto.randomBytes(4*1024*1024+17)]) {
    const w=world(t,bytes);
    const prepared=await prepare(w.reference);
    const sent=upload(w.reference,prepared);
    const gzip=await collect(sent.body);
    await sent.completion;
    assert.deepEqual(zlib.gunzipSync(gzip),bytes);
    assert.equal(sha(gzip),prepared.sha256);
  }
});
for(const mutation of ['truncated','grown','digest','symlink']) test('capture-to-upload '+mutation+' change refuses before HTTP',async(t)=>{
  const w=world(t);
  const prepared=await prepare(w.reference);
  if(mutation==='symlink') {
    fs.renameSync(w.file,w.file+'.original');
    fs.symlinkSync(w.file+'.original',w.file);
  } else fs.writeFileSync(w.file,mutation==='truncated'?'short'.slice(0,4):mutation==='grown'?'longer':'other');
  let httpCalls=0;
  assert.throws(()=>{ const sent=upload(w.reference,prepared); httpCalls++; sent.close(); });
  assert.equal(httpCalls,0);
});
test('a changed expected compressed identity is refused by the stream',async(t)=>{
  const w=world(t);
  const prepared=await prepare(w.reference);
  const sent=upload(w.reference,{...prepared,sha256:'0'.repeat(64)});
  await assert.rejects(collect(sent.body),/identity changed/);
  await assert.rejects(sent.completion,/identity changed/);
});
test('non-regular files and bad length bounds refuse before upload',async(t)=>{
  const w=world(t);
  await assert.rejects(prepare({...w.reference,path:path.dirname(w.file)}),/integrity/);
  await assert.rejects(prepare({...w.reference,length:Number.MAX_SAFE_INTEGER+1}),/integrity/);
});
