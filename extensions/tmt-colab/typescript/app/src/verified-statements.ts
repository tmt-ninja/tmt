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
 * full. Every caller gets its own copy, so no caller can change what a later hit returns.
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

/** A copy no caller shares: plain objects, arrays, maps and byte arrays are copied; a class instance
 * (a wrap envelope) keeps its bytes in private fields, so it cannot be changed and is kept. */
function fresh<T>(value: T): T {
  if (value instanceof Uint8Array) return value.slice() as T;
  if (Array.isArray(value)) return value.map(fresh) as T;
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [fresh(k), fresh(v)])) as T;
  if (value !== null && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fresh(v)])) as T;
  }
  return value;
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
  if (known) return fresh(known);
  const result = await envelope.verifyNext(space, owner, previous);
  if (verified.size >= VERIFIED_STATEMENTS) verified.clear();
  verified.set(id, fresh(result));
  return result;
}

/** For tests: forget every kept result. */
export function forgetVerifiedStatements() {
  verified.clear();
}
