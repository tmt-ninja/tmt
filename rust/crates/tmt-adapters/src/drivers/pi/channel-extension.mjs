// Loaded only for a TMT-enrolled interactive launch. The private socket carries
// one request per connection. Never put enrollment coordinates into a Pi turn.
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';

const maxFrame = 2 * 1024 * 1024;
const timeout = 30_000;

export default function (pi) {
  const path = process.env.TMT_PI_CHANNEL_SOCKET;
  const generation = process.env.TMT_PI_CHANNEL_GENERATION;
  const resume = process.env.TMT_PI_CHANNEL_RESUME;
  // Avoid passing launch credentials to tools or nested Pi processes.
  delete process.env.TMT_PI_CHANNEL_SOCKET;
  delete process.env.TMT_PI_CHANNEL_GENERATION;
  delete process.env.TMT_PI_CHANNEL_RESUME;
  if (!path || !generation) return;
  const connections = new Set();
  const waiting = new Map();
  let session, server, retired = false, promptDepth = 0, compacting = false;
  function retire() {
    retired = true;
    for (const socket of connections) socket.destroy();
    server?.close();
    waiting.clear();
  }
  pi.on('session_start', (event, ctx) => {
    if (retired || session || ctx.mode !== 'tui' || event.reason !== 'startup') return retire();
    const id = ctx.sessionManager.getSessionId();
    if (!id || (resume && id !== resume)) return retire();
    session = id;
    server = createServer(socket => {
      connections.add(socket);
      let size = 0, submitted = false, chunks = [], expectation;
      const timer = setTimeout(() => socket.destroy(), timeout);
      socket.on('error', () => socket.destroy());
      socket.once('close', () => {
        clearTimeout(timer);
        connections.delete(socket);
        if (expectation && waiting.get(expectation)?.socket === socket) waiting.delete(expectation);
      });
      socket.write(JSON.stringify({version:1, session, pid:process.pid}) + '\n');
      socket.on('data', bytes => {
        size += bytes.length;
        if (submitted || size > maxFrame) return socket.destroy();
        chunks.push(bytes);
        if (!bytes.includes(10)) return;
        submitted = true;
        const line = Buffer.concat(chunks); chunks = [];
        let frame;
        try { frame = JSON.parse(line.toString('utf8')); } catch { return socket.destroy(); }
        const refuse = () => socket.end('{"outcome":"refused"}\n');
        if (retired || frame?.version !== 1 || frame.session !== session ||
            frame.generation !== generation || !Number.isSafeInteger(frame.deadline) ||
            frame.deadline <= Date.now() || frame.deadline > Date.now()+timeout ||
            typeof frame.attempt !== 'string' || !frame.attempt ||
            typeof frame.content !== 'string' || typeof frame.urgent !== 'boolean' ||
            ctx.sessionManager.getSessionId() !== session || promptDepth || compacting ||
            ctx.signal?.aborted || (!ctx.isIdle() && !ctx.signal)) return refuse();
        // One request can have only one observer. Reject a second submission
        // while its first connection is live, even if its content differs.
        if (waiting.has(frame.attempt)) return refuse();
        expectation = frame.attempt;
        waiting.set(expectation, { socket, frame });
        const options = { expandPromptTemplates:false };
        if (!ctx.isIdle()) options.deliverAs = frame.urgent ? 'steer' : 'followUp';
        try { pi.sendUserMessage(frame.content, options); } catch { socket.destroy(); }
      });
    });
    server.maxConnections = 64;
    server.on('error', retire);
    server.listen(path);
  });
  pi.on('session_shutdown', retire);
  pi.on('ui_prompt_start', () => { promptDepth++; });
  pi.on('ui_prompt_end', () => { promptDepth = Math.max(0,promptDepth-1); });
  pi.on('session_before_compact', () => { compacting = true; });
  pi.on('session_compact', () => { compacting = false; });
  pi.on('session_compact_failed', () => { compacting = false; });
  pi.on('agent_settled', (_, ctx) => { if (ctx.isIdle()) compacting = false; });
  pi.on('message_start', ({message}, ctx) => {
    if (retired || ctx.sessionManager.getSessionId() !== session || message.role !== 'user') return;
    const parts = message.content;
    const text = typeof parts === 'string' ? parts :
      Array.isArray(parts) && parts.length === 1 && parts[0].type === 'text' ? parts[0].text : null;
    for (const [attempt, {socket,frame}] of waiting) {
      if (frame.content !== text || Date.now() >= frame.deadline) continue;
      waiting.delete(attempt);
      socket.end(JSON.stringify({outcome:'started', attempt, generation, session,
        sha256:createHash('sha256').update(text).digest('hex')}) + '\n');
      return;
    }
  });
}
