/** Test-only own-stream persistence double. No production Writer or sync proof. */
import { AskController } from '../src/ask-attempt.js';
import { AskRecordStore } from '../src/ask-record-store.js';
import type { AdmittedSelection, AskDestination } from '../src/ask-intent.js';
import type { RemoteClient } from '../src/ask-remote.js';
import type { PreviewAttempt } from '../src/ask-preview.js';
import type { OwnState } from '../src/fold-protocol.js';
import { deviceKeys } from '../src/keyring.js';
import { record } from '../src/storage.js';
import { readAskRecords, type AskLedgerView } from '../src/ask-records.js';
import { destination, RemoteDouble, selection } from './ask-fixtures.js';

export async function fixtureAttempt(
  input: AdmittedSelection,
  destination: AskDestination,
  options: {
    unavailable?: boolean;
    published?(views: readonly AskLedgerView[]): Promise<void>;
    mode?: RemoteDouble['mode'];
    operationId?: string;
    issuedAt?: number;
    retryOf?: string | null;
  } = {},
) {
  const captured = structuredClone(input);
  const target = structuredClone(destination);
  const remote = new RemoteDouble();
  remote.mode = options.mode ?? 'accepted';
  const port: RemoteClient = {
    context: async () => ({
      machineId: target.machine,
      deviceId: captured.senderDevice,
      grantRevision: target.grantRevision,
      deviceName: target.deviceName,
      expiresAtMs: target.grantExpiresAt,
      mode: target.mode,
    }),
    listAgents: async () => [{ id: target.agent, name: target.agentName }],
    send: (input) => remote.send(input),
    operation: (id) => remote.operation(id),
    result: (id) => remote.result(id),
    sendNow: (id) => remote.sendNow(id),
  };
  const keys = await deviceKeys(captured.senderDevice);
  const storageKey = `test:ask-own:${captured.space}:${captured.page}:${captured.senderDevice}`;
  let own = (await record<OwnState>(storageKey)) ?? {};
  const store = new AskRecordStore({
    space: captured.space,
    page: captured.page,
    deviceId: captured.senderDevice,
    publicKey: keys.signPublic,
    readOwn: () => own,
    async publish(root, key, value) {
      const latest = (await record<OwnState>(storageKey)) ?? {};
      const writer = (latest[captured.senderDevice] ??= {
        threads: {},
        messages: {},
        intents: {},
        replies: {},
      });
      if (
        writer[root][key] !== undefined &&
        JSON.stringify(writer[root][key]) !== JSON.stringify(value)
      )
        throw new Error('Fixture own conflict');
      writer[root][key] = structuredClone(value);
      await record(storageKey, latest);
      own = latest;
      await options.published?.(await readAskRecords(own, captured, () => keys.signPublic));
    },
  });
  const controller = new AskController({
    store,
    remote: port,
    key: keys.sign,
    selection: () => captured,
  });
  await controller.destinations();
  const preview = controller.prepare(target, {
    operationId: options.operationId,
    issuedAt: options.issuedAt,
  });
  let state: PreviewAttempt['state'] = { state: 'preview' };
  let pending: ReturnType<PreviewAttempt['send']> | undefined;
  const attempt: PreviewAttempt = {
    preview,
    available: !options.unavailable,
    get state() {
      return state;
    },
    send() {
      if (pending) return pending;
      state = { state: 'preparing' };
      pending = controller.send(preview, options.retryOf).then((view) => {
        state = { state: view.state };
        return { ...state, adopted: true };
      });
      return pending;
    },
  };
  return { attempt, remote, keys };
}

/** #5872: what reading the ask views of a page with many asks costs on the main thread. The store
 * answers every read the observation loop makes; `uncached` reads the same records the way every
 * read used to, decoding and verifying each signed ask again. */
export async function askViewReads(options: { asks: number; reads: number; quote?: number }) {
  const captured = selection();
  if (options.quote) captured.quote = 'q'.repeat(options.quote);
  const device = captured.senderDevice;
  const keys = await deviceKeys(device);
  const own: OwnState = {};
  const store = new AskRecordStore({
    space: captured.space,
    page: captured.page,
    deviceId: device,
    publicKey: keys.signPublic,
    readOwn: () => own,
    async publish(root, key, value) {
      const writer = (own[device] ??= { threads: {}, messages: {}, intents: {}, replies: {} });
      writer[root][key] = structuredClone(value);
    },
  });
  const controller = new AskController({
    store,
    remote: new RemoteDouble(),
    key: keys.sign,
    selection: () => captured,
  });
  await controller.destinations();
  for (let i = 0; i < options.asks; i++) await controller.send(controller.prepare(destination()));
  const signer = (writer: string) => (writer === device ? keys.signPublic : undefined);
  const time = async (read: () => Promise<unknown>) => {
    const started = performance.now();
    for (let i = 0; i < options.reads; i++) await read();
    return performance.now() - started;
  };
  const uncached = await time(() => readAskRecords(own, captured, signer));
  const verify = crypto.subtle.verify.bind(crypto.subtle);
  let verified = 0;
  crypto.subtle.verify = (...args: Parameters<SubtleCrypto['verify']>) => {
    verified++;
    return verify(...args);
  };
  try {
    const cached = await time(() => store.views());
    return { views: (await store.views()).length, uncached, cached, verified };
  } finally {
    crypto.subtle.verify = verify;
  }
}
