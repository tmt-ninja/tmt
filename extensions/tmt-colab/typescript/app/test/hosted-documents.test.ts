import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vite-plus/test';
import * as c from '@tmt/colab-client';
import type { SealedDocument } from '../../../../tmt-remote/typescript/remote-client/src/sealed-sync.js';
import {
  hostedAuthority,
  hostedAuthoritySet,
  hostedCheckpoint,
  hostedCheckpointSet,
  hostedLog,
} from '../src/hosted-documents.js';

// Independent model originals; the mapping follows reviewed native documents/originals.rs.
const v = JSON.parse(
  readFileSync(new URL('../../../contracts/vectors/model-v1.json', import.meta.url), 'utf8'),
) as Record<string, string>;
const fromHex = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));
const header = c.decodeHeader(fromHex(v.header));
const scope = {
  space: header.context.space,
  page: header.context.page,
  epoch: header.context.epoch,
};
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const scalar = (values: Record<string, string | number | Uint8Array>) =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === 'number'
        ? { integerValue: String(value) }
        : value instanceof Uint8Array
          ? { bytesValue: Buffer.from(value).toString('base64') }
          : key === 'expiresAt'
            ? { timestampValue: value }
            : { stringValue: value },
    ]),
  );
const base = () => ({
  ...scope,
  epoch: Number(scope.epoch),
  uid: 'owner-uid',
  expiresAt: '2027-01-01T00:00:00Z',
});
function document(resource: string, id: string, fields: Record<string, unknown>): SealedDocument {
  const bytes = c.text(
    JSON.stringify(
      Object.fromEntries(Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    ),
  );
  return { target: { resource, id }, bytes, digest: hash(bytes) };
}
/** A log row: v2 bytes, or (legacy) the v1 JSON a row written before #5876 PR 2 holds. */
function update(legacy = false) {
  // Whitespace is part of a legacy original and must survive transport reconstruction.
  const json = c.text(
    ' \n' +
      JSON.stringify({
        header: c.encodeBinary(fromHex(v.header)),
        nonce: c.encodeBinary(new Uint8Array(12)),
        ciphertext: c.encodeBinary(fromHex(v.ciphertext)),
        signature: c.encodeBinary(fromHex(v.signature)),
      }) +
      '\n',
  );
  const raw = legacy ? json : local(json);
  const fields = scalar({
    ...base(),
    stream: header.context.authorDevice,
    seq: Number(header.context.streamSeq),
    hash: c.encodeBinary(fromHex(v.envelopeHash)),
    envelope: legacy ? c.decodeText(raw) : raw,
  });
  return {
    raw,
    fields,
    row: document(
      'log',
      `${scope.space}_${scope.page}_${scope.epoch}_${header.context.authorDevice}_${header.context.streamSeq}`,
      fields,
    ),
  };
}
/** A checkpoint's rows: 256 KiB bytesValue chunks of v2, or (legacy) 32 KiB base64url v1 JSON. */
async function checkpoint(kind: 'checkpoint' | 'html' = 'checkpoint', legacy = false) {
  const signer = await crypto.subtle.importKey(
    'pkcs8',
    c.concat(fromHex('302e020100300506032b657004220420'), fromHex(v.seed)),
    'Ed25519',
    false,
    ['sign'],
  );
  const root = await crypto.subtle.importKey('raw', fromHex(v.master), 'HKDF', false, [
    'deriveBits',
  ]);
  const envelope = await c.Envelope.seal(
    {
      ...header.context,
      kind,
      ...(kind === 'html'
        ? { namespace: 'content' as const, streamSeq: '0', prevHash: new Uint8Array(32) }
        : {}),
    },
    root,
    signer,
    new Uint8Array(legacy ? 50_000 : 300_000),
  );
  const object =
    kind === 'html'
      ? Buffer.from(await envelope.hash()).toString('hex')
      : c.decodeHeader(envelope.header()).objectId;
  const raw = legacy ? envelope.toJson() : envelope.toBytes(),
    size = legacy ? 32768 : 262144;
  const count = Math.ceil(raw.length / size);
  const rows = Array.from({ length: count }, (_, index) =>
    document(
      'checkpoints',
      `${scope.space}_${scope.page}_${scope.epoch}_${object}_${index}`,
      scalar({
        ...base(),
        object,
        index,
        seq: index + 1,
        count,
        bytes: legacy
          ? c.encodeBinary(raw.slice(index * size, (index + 1) * size))
          : raw.slice(index * size, (index + 1) * size),
      }),
    ),
  );
  return { raw, object, rows };
}
function authority(
  kind: 'membership' | 'chain' | 'wrap',
  recipient = '',
  raw = c.text('exact signed authority bytes'),
) {
  const subject = hash(raw),
    count = Math.ceil(raw.length / 32768);
  return {
    raw,
    rows: Array.from({ length: count }, (_, index) =>
      document(
        'authority',
        `${scope.space}_${scope.page}_${scope.epoch}_${kind}_${subject}_${index + 1}`,
        scalar({
          ...base(),
          kind,
          subject,
          recipient,
          seq: index + 1,
          count,
          bytes: c.encodeBinary(raw.slice(index * 32768, (index + 1) * 32768)),
        }),
      ),
    ),
  };
}

it('preserves the independent signed update bytes, header and envelope hash', async () => {
  const f = update(),
    result = await hostedLog(f.row, scope);
  expect(result.bytes).toEqual(local(f.raw));
  expect(result.header).toEqual(header);
  expect(result.hash).toEqual(fromHex(v.envelopeHash));
  expect(
    await c.strictVerify(
      fromHex(v.public),
      result.envelope.signature(),
      await c.signatureInput(result.envelope.header(), result.envelope.ciphertext()),
    ),
  ).toBe(true);
});

it.each([
  { stream: { stringValue: '00000000-0000-4000-8000-000000000123' } },
  { seq: { integerValue: '2' } },
  { hash: { stringValue: c.encodeBinary(new Uint8Array(32)) } },
  { epoch: { integerValue: '2' } },
  { extra: { stringValue: 'undeclared' } },
])('refuses unsigned routing or hash disagreement before any admission: %j', async (change) => {
  const f = update();
  await expect(
    hostedLog(document('log', f.row.target.id, { ...f.fields, ...change }), scope),
  ).rejects.toThrow();
});

it('rejects target substitution and changed fields even if each payload looks valid', async () => {
  const f = update();
  await expect(
    hostedLog({ ...f.row, target: { ...f.row.target, id: f.row.target.id + 'x' } }, scope),
  ).rejects.toThrow();
  await expect(hostedLog({ ...f.row, digest: '0'.repeat(64) }, scope)).rejects.toThrow();
});

it('reassembles a complete ordered checkpoint to its exact original', async () => {
  const f = await checkpoint();
  expect(f.rows.length).toBeGreaterThan(1);
  const result = await hostedCheckpoint(f.rows, scope);
  expect(result.bytes).toEqual(local(f.raw));
  expect(result.header.objectId).toBe(f.object);
  expect(result.header.context.kind).toBe('checkpoint');
});

it('refuses partial, duplicate, reordered and mixed checkpoint chunks', async () => {
  const f = await checkpoint();
  for (const rows of [f.rows.slice(1), [...f.rows].reverse(), [f.rows[0], ...f.rows.slice(0, -1)]])
    await expect(hostedCheckpoint(rows, scope)).rejects.toThrow();
  const mixed = JSON.parse(c.decodeText(f.rows[1].bytes));
  mixed.uid = { stringValue: 'other-owner-uid' };
  await expect(
    hostedCheckpoint(
      [f.rows[0], document('checkpoints', f.rows[1].target.id, mixed), ...f.rows.slice(2)],
      scope,
    ),
  ).rejects.toThrow();
});

it('reassembles bounded membership pieces and verifies the whole-original subject', async () => {
  const f = authority('membership', '', new Uint8Array(50_000).fill(7));
  expect(await hostedAuthority(f.rows, scope, 'membership', '')).toEqual(f.raw);
  await expect(hostedAuthority(f.rows.slice(1), scope, 'membership', '')).rejects.toThrow();
  const changed = JSON.parse(c.decodeText(f.rows[1].bytes));
  changed.bytes = { stringValue: c.encodeBinary(new Uint8Array(17_232).fill(8)) };
  await expect(
    hostedAuthority(
      [f.rows[0], document('authority', f.rows[1].target.id, changed)],
      scope,
      'membership',
      '',
    ),
  ).rejects.toThrow();
});

it('link-recipient wraps and chain records keep exact kind/recipient boundaries', async () => {
  const recipient = 'link:22222222-2222-4222-8222-222222222222';
  const wrap = authority('wrap', recipient),
    chain = authority('chain');
  expect(await hostedAuthority(wrap.rows, scope, 'wrap', recipient)).toEqual(wrap.raw);
  expect(await hostedAuthority(chain.rows, scope, 'chain', '')).toEqual(chain.raw);
  await expect(hostedAuthority(wrap.rows, scope, 'wrap', 'owner-uid')).rejects.toThrow();
  await expect(hostedAuthority(wrap.rows, scope, 'chain', '')).rejects.toThrow();
});

it('assembles an unordered discovery set by validated authority subject and piece sequence', async () => {
  const one = authority('membership', '', new Uint8Array(50_000).fill(7)),
    two = authority('membership', '', new Uint8Array(10).fill(8));
  const originals = await hostedAuthoritySet(
    [one.rows[1], two.rows[0], one.rows[0]],
    scope,
    'membership',
    '',
  );
  expect(originals).toHaveLength(2);
  expect(originals).toContainEqual(one.raw);
  expect(originals).toContainEqual(two.raw);
  expect(await hostedAuthoritySet([], scope, 'membership', '')).toEqual([]);
  await expect(hostedAuthoritySet([one.rows[0]], scope, 'membership', '')).rejects.toThrow();
  await expect(
    hostedAuthoritySet([...one.rows, ...one.rows], scope, 'membership', ''),
  ).rejects.toThrow();
  await expect(hostedAuthoritySet(one.rows, scope, 'chain', '')).rejects.toThrow();
});

it('assembles every piece of the declared checkpoint discovery without inventing a seq=1 filter', async () => {
  const f = await checkpoint();
  expect((await hostedCheckpointSet([...f.rows].reverse(), scope))[0].bytes).toEqual(local(f.raw));
  await expect(hostedCheckpointSet([f.rows[0]], scope)).rejects.toThrow();
  await expect(
    hostedCheckpointSet(f.rows, { ...scope, page: '00000000-0000-4000-8000-000000000123' }),
  ).rejects.toThrow();
});

it('partitions exactly the committed baseline original from the same complete checkpoint discovery', async () => {
  const baseline = await checkpoint('html'),
    ordinary = await checkpoint();
  const expected = fromHex(baseline.object);
  const originals = await hostedCheckpointSet(
    [...ordinary.rows, ...baseline.rows].reverse(),
    scope,
    expected,
  );
  expect(originals).toHaveLength(2);
  expect(originals.filter((value) => value.header.context.kind === 'html')).toHaveLength(1);
  expect(originals.find((value) => value.header.context.kind === 'html')?.bytes).toEqual(
    local(baseline.raw),
  );
  expect(
    originals.find((value) => value.header.context.kind === 'checkpoint')?.header.objectId,
  ).toBe(ordinary.object);
});

it('never guesses a missing baseline or admits the same original under several object IDs', async () => {
  const baseline = await checkpoint('html'),
    ordinary = await checkpoint();
  const expected = fromHex(baseline.object);
  await expect(hostedCheckpointSet(ordinary.rows, scope, expected)).rejects.toMatchObject({
    code: 'COLAB_HOSTED_RESHARE_REQUIRED',
  });
  const alias = 'a'.repeat(64);
  const duplicate = baseline.rows.map((row) => {
    const values = JSON.parse(c.decodeText(row.bytes));
    values.object.stringValue = alias;
    return document('checkpoints', row.target.id.replace(baseline.object, alias), values);
  });
  await expect(
    hostedCheckpointSet([...baseline.rows, ...duplicate], scope, expected),
  ).rejects.toMatchObject({ code: 'COLAB_HOSTED_RESHARE_REQUIRED' });
  await expect(hostedCheckpointSet(duplicate, scope, expected)).rejects.toMatchObject({
    code: 'COLAB_HOSTED_RESHARE_REQUIRED',
  });
  await expect(hostedCheckpointSet([baseline.rows[0]], scope, expected)).rejects.toThrow();
  await expect(
    hostedCheckpointSet(
      baseline.rows,
      { ...scope, epoch: String(Number(scope.epoch) + 1) },
      expected,
    ),
  ).rejects.toThrow();
});

it('keeps ordinary checkpoint header-object admission beside the selected baseline', async () => {
  const baseline = await checkpoint('html'),
    ordinary = await checkpoint(),
    expected = c.binary(
      c.encodeBinary(new Uint8Array(Buffer.from(baseline.object, 'hex'))),
      32,
      32,
    );
  const alias = 'a'.repeat(64);
  const rows = ordinary.rows.map((row) => {
    const fields = JSON.parse(c.decodeText(row.bytes));
    fields.object.stringValue = alias;
    return document('checkpoints', row.target.id.replace(ordinary.object, alias), fields);
  });
  await expect(hostedCheckpointSet([...baseline.rows, ...rows], scope, expected)).rejects.toThrow();
});

/** The local v2 form of a cloud original: v2 as is, a legacy v1 JSON row converted. */
function local(cloud: Uint8Array) {
  if (c.decodeText(cloud.slice(0, 4)) === 'TCOB') return cloud;
  const text = new TextDecoder().decode(cloud).trim();
  return c.Envelope.fromJson(new TextEncoder().encode(text)).toBytes();
}

it('reads legacy v1 rows as the same v2 original under the same hash', async () => {
  const log = update(true),
    read = await hostedLog(log.row, scope);
  expect(read.bytes).toEqual(local(log.raw));
  expect(read.hash).toEqual(fromHex(v.envelopeHash));
  const f = await checkpoint('checkpoint', true);
  expect(f.rows.length).toBeGreaterThan(1);
  expect((await hostedCheckpoint(f.rows, scope)).bytes).toEqual(local(f.raw));
  // One object never mixes the two forms.
  const mixed = JSON.parse(c.decodeText(f.rows[1].bytes));
  mixed.bytes = {
    bytesValue: Buffer.from(c.binary(mixed.bytes.stringValue, 32768)).toString('base64'),
  };
  await expect(
    hostedCheckpoint([f.rows[0], document('checkpoints', f.rows[1].target.id, mixed)], scope),
  ).rejects.toThrow();
});

it('writes and reads v2 rows in bytesValue chunks of 256 KiB', async () => {
  const f = await checkpoint();
  expect(f.rows.length).toBe(2);
  const first = JSON.parse(c.decodeText(f.rows[0].bytes));
  expect(Buffer.from(first.bytes.bytesValue, 'base64').length).toBe(262144);
  const log = JSON.parse(c.decodeText(update().row.bytes));
  expect(Object.keys(log.envelope)).toEqual(['bytesValue']);
});

it.each([
  ['unpadded', (value: string) => value.replace(/=+$/, '')],
  ['base64url alphabet', (value: string) => value.replaceAll('+', '-').replaceAll('/', '_') + '-'],
  ['non-canonical trailing bits', (value: string) => value.replace(/.=$/, 'B=')],
])('refuses a %s bytesValue', async (_, change) => {
  const f = update();
  const value = (f.fields.envelope as { bytesValue: string }).bytesValue;
  expect(value.endsWith('=')).toBe(true);
  await expect(
    hostedLog(
      document('log', f.row.target.id, { ...f.fields, envelope: { bytesValue: change(value) } }),
      scope,
    ),
  ).rejects.toThrow();
});
