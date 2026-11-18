import { digest, encodeBinary, frame, statement, text } from '@tmt/colab-client';

/** At most this many verified statements are kept; the cache is cleared when it is full. A space
 * log holds at most 4,096 statements (`Admission` budget). */
export const VERIFIED_STATEMENTS = 4096;

/**
 * Owner-log statements this tab already verified (#6456). Every page open restores the same space
 * log and used to verify each statement again. A statement is reused only when everything its
 * verification read is identical: the exact envelope bytes, the space, the owner key, and the
 * previous head it was verified after (revision, hash and the owner member's keys), so a changed
 * key or membership head never reuses an old result. Only successes are kept, in memory, for this
 * tab: never persisted, never shared with another tab. A new or changed statement is verified in
 * full. A result is shared, so callers treat it as read-only.
 */
const verified = new Map<string, statement.Verified>();

async function key(
  bytes: Uint8Array,
  space: string,
  owner: Uint8Array,
  previous: statement.Head | null,
): Promise<string> {
  const head = previous
    ? [
        text(previous.revision.toString()),
        previous.hash,
        text(previous.ownerMember.id),
        previous.ownerMember.signingKey,
        previous.ownerMember.encryptionKey,
      ]
    : [text('genesis')];
  return encodeBinary(
    await digest(
      frame(text('tmt-colab-verified-statement-v1'), text(space), owner, ...head, bytes),
    ),
  );
}

/** `envelope.verifyNext(space, owner, previous)` for the envelope parsed from exactly `bytes`. */
export async function verifyStatement(
  bytes: Uint8Array,
  envelope: statement.Envelope,
  space: string,
  owner: Uint8Array,
  previous: statement.Head | null,
): Promise<statement.Verified> {
  const id = await key(bytes, space, owner, previous);
  const known = verified.get(id);
  if (known) return known;
  const result = await envelope.verifyNext(space, owner, previous);
  if (verified.size >= VERIFIED_STATEMENTS) verified.clear();
  verified.set(id, result);
  return result;
}

/** For tests: forget every kept result. */
export function forgetVerifiedStatements() {
  verified.clear();
}
