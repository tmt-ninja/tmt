import {
  binary,
  decimal,
  decodeHeader,
  encodeBinary,
  Envelope,
  requireValue,
} from '@tmt/colab-client';
import type { Admission } from './admission.js';
import { UPDATE_ENVELOPE_BYTES, type ObjectEntry } from './objects.js';

/** Admission owns fresh issuer/role/lifetime checks; sealing never recreates that policy. */
export type OwnAuthor = (device: string, revision: string) => Uint8Array | Promise<Uint8Array>;

/** The same Colab own-update envelope for native Writer and the hosted original publisher. */
export async function sealOwnUpdate(
  admission: Admission,
  head: { seq: bigint; hash: Uint8Array },
  update: Uint8Array,
  author: OwnAuthor,
): Promise<ObjectEntry> {
  const a = admission;
  requireValue(a.root !== null && a.head !== null);
  await author(a.registration.deviceId, a.head.revision.toString());
  const envelope = await Envelope.seal(
    {
      space: a.space,
      page: a.page,
      epoch: a.epoch,
      kind: 'update',
      namespace: 'own',
      authorDevice: a.registration.deviceId,
      membershipRevision: a.head.revision.toString(),
      streamSeq: String(head.seq + 1n),
      prevHash: head.hash,
    },
    a.root,
    a.registration.keys.sign,
    update,
  );
  return {
    seq: decodeHeader(envelope.header()).context.streamSeq,
    envelopeHash: encodeBinary(await envelope.hash()),
    envelope: encodeBinary(envelope.toBytes()),
  };
}

/** The membership revision a sealed own entry cites. The serve admits an append only at its current
 * membership head, so an entry that cites an earlier one can never be taken. */
export function sealedRevision(entry: ObjectEntry): bigint {
  const envelope = Envelope.fromBytes(binary(entry.envelope, UPDATE_ENVELOPE_BYTES));
  return decimal(decodeHeader(envelope.header()).context.membershipRevision);
}

/** Whether a sealed own entry is a checkpoint rather than an update. */
export function sealedKind(entry: ObjectEntry): 'update' | 'checkpoint' {
  const envelope = Envelope.fromBytes(binary(entry.envelope, UPDATE_ENVELOPE_BYTES));
  const { kind } = decodeHeader(envelope.header()).context;
  requireValue(kind === 'update' || kind === 'checkpoint');
  return kind;
}

/** The v1 JSON envelope of one update: base64 of the update and its framing, plus 2 KiB. */
const LEGACY_UPDATE_JSON = 354_304;
/** A sealed entry saved before #5876 holds a v1 JSON envelope: the one browser-side conversion,
 * lossless and under the same hash, so a write pending across the upgrade is still sent. */
export function currentEntry(entry: ObjectEntry): ObjectEntry {
  const bytes = binary(entry.envelope, LEGACY_UPDATE_JSON);
  if (bytes[0] !== 0x7b) return entry;
  return { ...entry, envelope: encodeBinary(Envelope.fromJson(bytes).toBytes()) };
}
