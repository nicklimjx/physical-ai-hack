import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  CommandEnvelopeSchema, CommandResultSchema, OperatorInputSchema, OperatorResponseSchema,
} from '@ember/contracts';
import type { PreviewRuntime } from './runtime/index.js';

const json = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
};

async function body(request: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const part of request) {
    raw += part;
    if (raw.length > 32_000) throw new Error('Request body too large');
  }
  return JSON.parse(raw || '{}');
}

export function createRoutes(runtime: PreviewRuntime) {
  const clients = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    const host = request.headers.host;
    const origin = request.headers.origin;
    if (host && !/^127\.0\.0\.1(?::\d+)?$/.test(host) && !/^localhost(?::\d+)?$/.test(host)) {
      json(response, 403, { error: 'Loopback requests only' });
      return;
    }
    if (origin) {
      try {
        if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) {
          json(response, 403, { error: 'Local origin required' });
          return;
        }
      } catch {
        json(response, 403, { error: 'Invalid origin' });
        return;
      }
    }
    if (request.method === 'GET' && request.url === '/api/world') {
      json(response, 200, runtime.getWorld());
      return;
    }
    if (request.method === 'GET' && request.url === '/api/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
      clients.add(response);
      response.write(`event: world\ndata: ${JSON.stringify(runtime.getWorld())}\n\n`);
      const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15_000);
      request.on('close', () => { clearInterval(heartbeat); clients.delete(response); });
      return;
    }
    if (request.method === 'POST' && request.url === '/api/commands') {
      try {
        const parsed = CommandEnvelopeSchema.safeParse(await body(request));
        const current = runtime.getWorld();
        if (!parsed.success) {
          json(response, 400, { error: 'Invalid command envelope', issues: parsed.error.issues });
          return;
        }
        const staleRun = parsed.data.runId !== current.snapshot.runId;
        json(response, 200, CommandResultSchema.parse({
          schemaVersion: 1, runId: current.snapshot.runId, commandId: parsed.data.commandId,
          status: staleRun ? 'rejected' : 'unavailable', reason: staleRun ? 'stale_run' : 'preview_runtime',
          appliedRevision: null, missionIds: [],
          message: staleRun ? 'Command belongs to a different run.' : 'Preview mode: commands are validated but not applied.',
        }));
      } catch (error) {
        json(response, 400, { error: error instanceof Error ? error.message : 'Invalid request' });
      }
      return;
    }
    if (request.method === 'POST' && request.url === '/api/operator-input') {
      try {
        const parsed = OperatorInputSchema.safeParse(await body(request));
        if (!parsed.success) {
          json(response, 400, { error: 'Invalid operator input', issues: parsed.error.issues });
          return;
        }
        const current = runtime.getWorld();
        const staleRun = parsed.data.runId !== current.snapshot.runId;
        json(response, 200, OperatorResponseSchema.parse({
          schemaVersion: 1, runId: current.snapshot.runId, requestId: parsed.data.requestId,
          status: 'unavailable', text: staleRun ? 'Input belongs to a different run.' : 'Operator orchestration is unavailable in preview.',
          commandResult: null, announcements: [],
        }));
      } catch (error) {
        json(response, 400, { error: error instanceof Error ? error.message : 'Invalid request' });
      }
      return;
    }
    if (request.url === '/api/voice/token' || request.url === '/api/voice/audio') {
      json(response, 503, { error: 'Voice is unavailable in preview' });
      return;
    }
    json(response, 404, { error: 'Not found' });
  });
  return { server, clients };
}
