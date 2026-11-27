import { RecipientKey, sign, signingKey, strictVerify, text } from '@tmt/colab-client';

import { readAdmittedRecord, record, writeAdmittedRecord } from './storage.js';

export interface DeviceKeys {
  sign: CryptoKey;
  signPublic: Uint8Array<ArrayBuffer>;
  enc: RecipientKey;
}
interface Stored {
  sign: CryptoKey;
  signPublic: Uint8Array<ArrayBuffer>;
  enc: CryptoKey;
  encPublic: Uint8Array<ArrayBuffer>;
}

/** Only Colab-owned records; Remote's keyring and private bytes never enter here. */
export async function deviceKeys(deviceId: string): Promise<DeviceKeys> {
  return navigator.locks.request(`colab-keys:${deviceId}`, async () => {
    let stored = await record<Stored>(`keys:${deviceId}`);
    if (!stored) {
      const pair = (await crypto.subtle.generateKey('Ed25519', false, [
        'sign',
        'verify',
      ])) as CryptoKeyPair;
      const enc = await RecipientKey.generate();
      stored = {
        sign: pair.privateKey,
        signPublic: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
        enc: enc.handle(),
        encPublic: enc.publicKey(),
      };
      await record(`keys:${deviceId}`, stored);
    }
    signingKey(stored.sign);
    const probe = text('tmt-colab-keyring-check-v1');
    if (!(await strictVerify(stored.signPublic, await sign(stored.sign, probe), probe)))
      throw new Error('Device signing key mismatch');
    return {
      sign: stored.sign,
      signPublic: new Uint8Array(stored.signPublic),
      enc: await RecipientKey.fromHandle(stored.enc, stored.encPublic),
    };
  });
}

/** Browser-local encryption keys; never certified, exported or shared across purposes. */
export type LocalKeyPurpose = 'title' | 'draft';

/** `title` keeps its original record and lock names so existing hints keep decrypting. */
async function localKey(purpose: LocalKeyPurpose, deviceId: string): Promise<CryptoKey> {
  return navigator.locks.request(`colab-${purpose}-key:${deviceId}`, async () => {
    let key = await record<CryptoKey>(`${purpose}-key:${deviceId}`);
    if (key === undefined) {
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]);
      await record(`${purpose}-key:${deviceId}`, key);
    }
    return checkedLocalKey(key, purpose);
  });
}

function checkedLocalKey(key: unknown, purpose: LocalKeyPurpose): CryptoKey {
  if (
    !(key instanceof CryptoKey) ||
    key.type !== 'secret' ||
    key.extractable ||
    key.algorithm.name !== 'AES-GCM' ||
    (key.algorithm as AesKeyAlgorithm).length !== 256 ||
    !key.usages.includes('encrypt') ||
    !key.usages.includes('decrypt')
  )
    throw new Error(`Local ${purpose} key unavailable`);
  return key;
}
/** Browser-local title encryption only. */
export const titleKey = (deviceId: string) => localKey('title', deviceId);
/** Browser-local unsent-draft encryption only. */
export const draftKey = (deviceId: string) => localKey('draft', deviceId);

/** Recovery reads use the existing key. A missing key cannot open a kept draft. */
export async function readDraftKey(deviceId: string): Promise<CryptoKey> {
  return checkedLocalKey(await record<CryptoKey>(`draft-key:${deviceId}`), 'draft');
}

export async function legacyBlockDraftKey(device: string, check: () => void) {
  const key = await readAdmittedRecord<CryptoKey>(`draft-key:${device}`, check);
  check();
  return key === undefined ? undefined : checkedLocalKey(key, 'draft');
}

/** Resolve the local block-draft key only for the current verified owner. */
export async function ownerBlockDraftKey(
  space: string,
  root: string,
  check: () => void,
  create: boolean,
): Promise<CryptoKey | undefined> {
  const name = `owner-block-draft-key:${space}:${root}`;
  return navigator.locks.request(name, async () => {
    check();
    const stored = await readAdmittedRecord<{ root: string; key: CryptoKey }>(name, check);
    check();
    if (stored !== undefined) {
      if (stored?.root !== root) throw new Error('Block draft owner mismatch');
      return checkedLocalKey(stored.key, 'draft');
    }
    if (!create) return undefined;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await writeAdmittedRecord(name, { root, key }, check);
    check();
    return key;
  });
}
