/** Colab-owned IndexedDB records. A write resolves only after durable transaction
 * completion, never just the individual put success. */
export async function record<T>(key: string): Promise<T | undefined>;
export async function record<T>(key: string, value: T): Promise<void>;
export async function record<T>(key: string, ...values: [T] | []): Promise<T | undefined | void> {
  if (values.length) await withRecords('readwrite', (store) => store.put(values[0], key));
  else return withRecords('readonly', (store) => store.get(key));
}
/** Deletion, like a write, resolves only after the transaction commits. */
export async function deleteRecord(key: string): Promise<void> {
  await withRecords('readwrite', (store) => store.delete(key));
}

/** Enumerate only legacy key names within the caller's bounded prefix, never their values. */
export function recordKeys(
  prefix: string,
  after: string | undefined,
  limit: number,
  check: () => void,
) {
  return withRecords('readonly', (store) => {
    check();
    const range = IDBKeyRange.bound(after ?? prefix, `${prefix}\uffff`, after !== undefined);
    return store.getAllKeys(range, limit);
  });
}

export function readAdmittedRecord<T>(key: string, check: () => void): Promise<T | undefined> {
  return withRecords('readonly', (store) => {
    check();
    return store.get(key);
  });
}

/** Check the current admission inside the storage transaction, before changing either record. */
export async function writeAdmittedRecord<T>(
  key: string,
  value: T,
  check: () => void,
  replace?: string,
): Promise<void> {
  await withRecords('readwrite', (store) => {
    check();
    const write = store.put(value, key);
    if (replace !== undefined) store.delete(replace);
    return write;
  });
}

async function withRecords<T>(
  mode: IDBTransactionMode,
  request: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('tmt-colab', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Device storage is blocked'));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction('keys', mode);
      try {
        const pending = request(transaction.objectStore('keys'));
        transaction.oncomplete = () => resolve(pending.result);
        transaction.onabort = () => reject(transaction.error ?? new Error('Device storage failed'));
        transaction.onerror = () => reject(transaction.error);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  } finally {
    database.close();
  }
}
