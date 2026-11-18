import { coreId, parseCapabilities, RefusalError, verifiedSessionRequest } from './operations.js';
import type { RemoteShell } from './remote-shell.js';

type Option = { key: string; label: string; disabled?: boolean };
type Outcome = 'submitted' | 'refused' | 'unconfirmed';
export interface CommandRun {
  options(identity: string, member: string): Promise<readonly Option[]>;
  submit(identity: string, command: string, choice: string): Promise<Outcome>;
}
const terminalId = (value: unknown): value is string =>
  typeof value === 'string' && /^term_[0-9a-f]{32}$/.test(value);
const utf8 = new TextEncoder();
export function singleCommand(text: string): boolean {
  const bytes = utf8.encode(text);
  return (
    !!text.trim() &&
    bytes.length <= 4096 &&
    new TextDecoder().decode(bytes) === text &&
    !text.includes('\u034f') &&
    !/[\p{Cc}\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/u.test(
      text,
    )
  );
}

function document(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid terminal response.');
  return value as Record<string, unknown>;
}
function targets(identity: string, member: string, value: unknown): Option[] {
  const reply = document(value);
  if (
    reply.identityId !== identity ||
    !Array.isArray(reply.terminals) ||
    reply.terminals.length > 8
  )
    throw new Error('Invalid terminal targets.');
  const seen = new Set<string>();
  return reply.terminals.map((value, index) => {
    const row = document(value);
    if (
      !terminalId(row.terminalId) ||
      seen.has(row.terminalId) ||
      row.ordinal !== index + 1 ||
      typeof row.busy !== 'boolean'
    )
      throw new Error('Invalid terminal target.');
    seen.add(row.terminalId);
    return {
      key: row.terminalId,
      label: `Run in Terminal ${index + 1} · ${member}`,
      disabled: row.busy,
    };
  });
}
function outcome(id: string, identity: string, choice: string, value: unknown): Outcome {
  const reply = document(value);
  const terminal = reply.terminalId;
  if (
    reply.operationId !== id ||
    (terminal !== undefined && (!terminalId(terminal) || (choice !== 'new' && terminal !== choice)))
  )
    throw new Error('Invalid command receipt.');
  if (reply.state === 'submitted' && reply.identityId === identity && terminalId(terminal))
    return 'submitted';
  if (
    (reply.state === 'refused' || reply.state === 'unconfirmed') &&
    ['admission', 'open', 'run', 'unknown'].includes(String(reply.stage)) &&
    (reply.state !== 'refused' || typeof reply.code === 'string')
  )
    return reply.state;
  throw new Error('Invalid command outcome.');
}

/** Only a current signed operation inventory enables Run; the server rechecks both effects. */
export function commandRun(shell: RemoteShell): CommandRun | undefined {
  const getSession = shell.session;
  if (!getSession) return;
  return {
    async options(identity, member) {
      if (!coreId(identity)) return [];
      const session = await getSession();
      shell.signal.throwIfAborted();
      const call = verifiedSessionRequest(session);
      const offered = await call('capabilities', crypto.randomUUID(), {}, parseCapabilities);
      if (
        !offered.includes('terminal.command.targets') ||
        !offered.includes('terminal.command.run')
      )
        return [];
      shell.signal.throwIfAborted();
      const list = await call(
        'terminal.command.targets',
        crypto.randomUUID(),
        { version: 1, operation: 'terminal.command.targets', input: { identityId: identity } },
        (value) => targets(identity, member, value),
      );
      return [...list, { key: 'new', label: 'Run in a new terminal' }];
    },
    async submit(identity, command, choice) {
      if (!coreId(identity) || !singleCommand(command) || (choice !== 'new' && !terminalId(choice)))
        return 'refused';
      const target = choice === 'new' ? { kind: 'new' } : { kind: 'existing', terminalId: choice };
      const session = await getSession();
      shell.signal.throwIfAborted();
      const call = verifiedSessionRequest(session);
      const id = crypto.randomUUID();
      const parse = (value: unknown) => outcome(id, identity, choice, value);
      try {
        return await call(
          'terminal.command.run',
          id,
          {
            version: 1,
            operation: 'terminal.command.run',
            input: { operationId: id, identityId: identity, target, command },
          },
          parse,
          true,
        );
      } catch (error) {
        if (error instanceof RefusalError) return 'refused';
        if (shell.signal.aborted) return 'unconfirmed';
        try {
          return await call('operation.show', crypto.randomUUID(), { operationId: id }, parse);
        } catch {
          return 'unconfirmed';
        }
      }
    },
  };
}
