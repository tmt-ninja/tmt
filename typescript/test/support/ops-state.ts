import fs from 'node:fs';
import Database from 'better-sqlite3';

/**
 * A stored document of the Ops state database (`cron`, or one room's `checklist`), or
 * undefined when it is not stored yet. The file exists before the first Store creation has
 * committed its `documents` migration, and a writer may hold the lock meanwhile, so a missing
 * table or a busy database also means "not yet" for a poller. Every other error is real.
 */
export function storedDocument(
  database: string,
  kind: 'cron' | 'checklist',
  key = ''
): Buffer | undefined {
  if (!fs.existsSync(database)) return undefined;
  let db: Database.Database | undefined;
  try {
    db = new Database(database, { readonly: true, timeout: 200 });
    const row = db
      .prepare('SELECT body FROM documents WHERE kind = ? AND key = ?')
      .get(kind, key) as { body: Buffer } | undefined;
    return row?.body;
  } catch (error) {
    if (notStoredYet(error)) return undefined;
    throw error;
  } finally {
    db?.close();
  }
}

function notStoredYet(error: unknown): boolean {
  if (!(error instanceof Database.SqliteError)) return false;
  return (
    error.code === 'SQLITE_BUSY' ||
    error.code === 'SQLITE_LOCKED' ||
    error.message === 'no such table: documents'
  );
}

/** Independently authored shipped v2 input, never a new-build redirect used as legacy data. */
export function legacyCronSource(
  roomId: string,
  ownerId: string,
  message: string,
  anchorMs = 0
): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: 2,
      counters: { [roomId]: 1 },
      jobs: [
        {
          id: 'c1',
          roomId,
          ownerId,
          message,
          revision: 1,
          state: 'on',
          pause: null,
          schedule: { kind: 'every', seconds: 60, anchorMs, from: null, zone: 'UTC' },
        },
      ],
    })
  );
}

/** Frozen old bytes remain evidence; the marker is deliberately not a live jobs document. */
export function retainedCronSource(database: string): Buffer {
  const marker = storedDocument(database, 'cron');
  if (!marker) throw new Error('missing cron redirect');
  const sourceId = JSON.parse(marker.toString('utf8')).sourceId;
  if (typeof sourceId !== 'string') throw new Error('missing frozen source id');
  const db = new Database(database, { readonly: true });
  try {
    const row = db
      .prepare("SELECT body FROM documents WHERE kind='cron-cutover-source' AND key=?")
      .get(sourceId) as { body: Buffer } | undefined;
    if (!row) throw new Error('missing retained cron source');
    return row.body;
  } finally {
    db.close();
  }
}
