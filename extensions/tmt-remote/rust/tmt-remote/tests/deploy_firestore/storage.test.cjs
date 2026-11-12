'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { run } = require('../../src/deploy_firestore/helper.cjs');
const root = path.resolve(__dirname, '../fixtures/deploy_firestore/firebase-tools');
const project = 'demo-storage-fixture';
const bucket = 'fake-storage-fixture.invalid';
const account = 'synthetic-owner@example.invalid';
const policy = "rules_version = '2';\nservice firebase.storage {\n  match /b/{bucket}/o {\n    match /{allPaths=**} { allow read, write: if false; }\n  }\n}\n";
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function fixture(overrides = {}) {
  const state = { billing: { name: `projects/${project}/billingInfo`, projectId: project,
    billingEnabled: true, billingAccountName: 'billingAccounts/FAKE-FIXTURE-ONLY' },
    present: false, linked: false, rulesets: [], release: null, calls: [], ...overrides };
  const metadata = () => ({ name: bucket, projectNumber: '101010', location: 'US-EAST1', storageClass: 'STANDARD', ...state.metadata });
  const deps = { deadline: Date.now() + 30000,
    credential: async () => ({ account, token: 'SYNTHETIC_TOKEN_CANARY' }),
    http: async (url, options) => {
      state.calls.push({ url, method: options.method });
      const body = options.body && JSON.parse(options.body);
      if (url.endsWith('/oauth2/v3/userinfo')) return { status: 200, body: { email: account, email_verified: true } };
      if (url.includes('cloudbilling.googleapis.com')) {
        assert.equal(options.method, 'GET', 'billing is never changed');
        return { status: state.billingStatus ?? 200, body: state.billing };
      }
      if (url === `https://firebase.googleapis.com/v1beta1/projects/${project}`)
        return { status: 200, body: { projectId: project, projectNumber: '101010', state: 'ACTIVE', resources: { storageBucket: bucket } } };
      if (url.includes('firebasestorage.googleapis.com') && url.endsWith('/defaultBucket')) {
        assert.equal(options.method, 'POST'); assert.deepEqual(body, { location: 'us-east1' });
        if (!state.noBucketEffect) { state.present = true; state.linked = true; }
        if (state.loseBucketReply) { state.loseBucketReply = false; throw Error('synthetic lost reply'); }
        return { status: 200, body: { name: `projects/${project}/defaultBucket`, location: 'us-east1' } };
      }
      if (url.includes('firebasestorage.googleapis.com')) return { status: state.linked ? 200 : 404, body: state.linked ? { name: `projects/${project}/buckets/${bucket}` } : null };
      if (url.startsWith('https://storage.googleapis.com/storage/v1/b/')) return { status: state.present ? 200 : 404, body: state.present ? metadata() : null };
      if (url.includes('/rulesets?')) return { status: 200, body: { rulesets: state.rulesets.map(({ name }) => ({ name })) } };
      if (url.endsWith(`/projects/${project}/rulesets`) && options.method === 'POST') {
        const found = { name: `projects/${project}/rulesets/synthetic-ruleset-${state.rulesets.length}`, source: body.source };
        state.rulesets.push(found);
        if (state.loseRulesetReply) { state.loseRulesetReply = false; throw Error('synthetic lost reply'); }
        return { status: 200, body: found };
      }
      if (url.includes(`/projects/${project}/rulesets/`)) {
        const found = state.rulesets.find(r => url.endsWith('/' + r.name));
        return { status: found ? 200 : 404, body: found ?? null };
      }
      if (url.endsWith(`/projects/${project}/releases`) || url.includes('/releases/firebase.storage/')) {
        const name = `projects/${project}/releases/firebase.storage/${bucket}`;
        if (options.method === 'GET') return { status: state.release ? 200 : 404, body: state.release };
        const release = body.release ?? body;
        assert.equal(release.name, name, 'release is keyed to the exact bucket');
        state.release = release;
        if (state.mismatchReleaseReadback) {
          const foreign = { name: `projects/${project}/rulesets/mismatched-readback`, source: { files: [{ name: 'storage.rules', content: 'synthetic mismatched policy' }] } };
          state.rulesets.push(foreign);
          state.release = { name, rulesetName: foreign.name };
        }
        if (state.loseReleaseReply) { state.loseReleaseReply = false; throw Error('synthetic lost reply'); }
        return { status: 200, body: release };
      }
      assert.fail(`unexpected synthetic request ${options.method} ${url}`);
    } };
  async function call(operation, input) {
    deps.deadline = Date.now() + 30000;
    const value = await run(JSON.stringify({ version: 1, operation, input: { project, ...input }, account, budgetMs: 30000 }), root, deps);
    assert.ok(!JSON.stringify(value).includes('SYNTHETIC_TOKEN_CANARY'));
    assert.ok(!JSON.stringify(value).includes('billingAccounts/'));
    return Object.hasOwn(value, "result") ? value.result : value;
  }
  const inventory = (intent = { bucket: 'default', location: 'us-east1' }, original = null) => call('storage-inventory', { intent, original, policy });
  const step = (action, kind, checkpoint) => call(`${action}-storage-${kind}`, { checkpoint });
  return { state, inventory, step };
}
const checkpoint = plan => ({ plan, ruleset: null, metadataDigest: null, verified: false, bucketAttempted: false });
const mutations = f => f.state.calls.filter(c => c.method !== 'GET');
test('billing disabled differs from unreadable or malformed evidence and never mutates', async () => {
  for (const [overrides, error] of [
    [{ billing: { billingEnabled: false } }, 'billing-disabled'],
    [{ billing: { billingEnabled: true } }, 'unknown'],
    [{ billing: null }, 'unknown'],
    [{ billingStatus: 403, billing: {} }, 'permission-denied']]) {
    const f = fixture(overrides);
    assert.equal((await f.inventory()).error, error);
    assert.equal(mutations(f).length, 0);
  }
});
test('paid inventory freezes billing and policy fingerprints without a billing identifier', async () => {
  const f = fixture(); const plan = await f.inventory();
  assert.equal(plan.error, undefined, JSON.stringify({plan,calls:f.state.calls}));
  assert.equal(plan.bucket, bucket); assert.equal(plan.location, 'us-east1');
  assert.equal(plan.billingFingerprint, sha('billingAccounts/FAKE-FIXTURE-ONLY'));
  assert.equal(plan.policy, policy); assert.equal(plan.policyDigest, sha(policy));
  assert.equal(mutations(f).length, 0);
});
test('named buckets must already be linked and match immutable project and location', async () => {
  for (const changes of [{ present: false }, { linked: false }, { metadata: { projectNumber: '202020' } }, { metadata: { location: 'EUROPE-WEST1' } }]) {
    const f = fixture({ present: true, linked: true, ...changes });
    assert.equal((await f.inventory({ bucket, location: 'us-east1' })).error, 'storage-mismatch');
    assert.equal(mutations(f).length, 0);
  }
});
test('an existing default bucket can be re-linked without changing its metadata', async () => {
  const f = fixture({ present: true }); let cp = checkpoint(await f.inventory()); cp.bucketAttempted = true;
  assert.equal((await f.step('observe', 'bucket', cp)).state, 'absent');
  const reply = await f.step('apply', 'bucket', cp);
  assert.equal(reply.state, 'done'); assert.ok(reply.checkpoint.metadataDigest);
  assert.equal(mutations(f).length, 1);
});
test('a lost default provisioning reply is resolved by exact read-only observation', async () => {
  const f = fixture({ loseBucketReply: true }); const cp = checkpoint(await f.inventory()); cp.bucketAttempted = true;
  assert.equal((await f.step('apply', 'bucket', cp)).error, 'unknown');
  assert.equal((await f.step('observe', 'bucket', cp)).state, 'adopted');
  assert.equal(mutations(f).length, 1);
});
test('ruleset and release lost replies are observed without another mutation', async () => {
  const f = fixture({ present: true, linked: true, loseRulesetReply: true, loseReleaseReply: true });
  let cp = checkpoint(await f.inventory({ bucket }));
  assert.equal((await f.step('apply', 'ruleset', cp)).error, 'unknown');
  cp = (await f.step('observe', 'ruleset', cp)).checkpoint;
  assert.ok(cp.ruleset);
  assert.equal((await f.step('apply', 'release', cp)).error, 'unknown');
  assert.equal((await f.step('observe', 'release', cp)).state, 'satisfied');
  assert.equal(mutations(f).length, 2);
});
test('policy drift after consent refuses without replacing a newly observed foreign policy', async () => {
  const f = fixture({ present: true, linked: true }); const cp = checkpoint(await f.inventory({ bucket }));
  f.state.rulesets.push({ name: `projects/${project}/rulesets/foreign`, source: { files: [{ name: 'storage.rules', content: 'synthetic foreign policy' }] } });
  f.state.release = { name: `projects/${project}/releases/firebase.storage/${bucket}`, rulesetName: f.state.rulesets[0].name };
  assert.equal((await f.step('apply', 'release', cp)).error, 'rules-foreign');
  assert.equal(mutations(f).length, 0);
});

test('billing change after consent refuses before the first Storage mutation', async () => {
  const f = fixture(); const cp = checkpoint(await f.inventory()); cp.bucketAttempted = true;
  f.state.billing.billingAccountName = 'billingAccounts/OTHER-FAKE-FIXTURE';
  assert.equal((await f.step('apply', 'bucket', cp)).error, 'storage-mismatch');
  assert.equal(mutations(f).length, 0);
});
test('changed retention evidence on resume refuses without a mutation', async () => {
  const f = fixture({ present: true, linked: true }); const cp = checkpoint(await f.inventory({ bucket }));
  f.state.metadata = { retentionPolicy: { retentionPeriod: '604800' } };
  assert.equal((await f.step('apply', 'ruleset', cp)).error, 'storage-mismatch');
  assert.equal(mutations(f).length, 0);
});
test('a concurrently appearing default bucket is not ownership proof before the journaled attempt', async () => {
  const f = fixture(); const cp = checkpoint(await f.inventory());
  f.state.present = true; f.state.linked = true;
  assert.equal((await f.step('observe', 'bucket', cp)).error, 'storage-mismatch');
  assert.equal(mutations(f).length, 0);
});
test('a mismatching final policy read-back stays unknown and cannot claim completion', async () => {
  const f = fixture({ present: true, linked: true, mismatchReleaseReadback: true });
  let cp = checkpoint(await f.inventory({ bucket }));
  cp = (await f.step('apply', 'ruleset', cp)).checkpoint;
  assert.equal((await f.step('apply', 'release', cp)).error, 'unknown');
  assert.equal((await f.step('observe', 'release', cp)).error, 'rules-foreign');
  assert.equal(mutations(f).length, 2);
});
