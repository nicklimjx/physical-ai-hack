import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  CommandEnvelopeSchema, CommandResultSchema, OperatorInputSchema, OperatorResponseSchema,
} from '@ember/contracts';
import { WorldStreamEventSchema } from '@ember/contracts';
import { createAnnouncementStore, type RouteServices, type RuntimeHooks } from './services.js';

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

export function createRoutes(runtime: RuntimeHooks, services: RouteServices = {}) {
  const clients = new Set<ServerResponse>();
  const announcements = services.announcements ?? createAnnouncementStore(() => runtime.getWorld());
  const currentWorld = () => ({ ...runtime.getWorld(), announcements: [] });
  const publish = (value: unknown) => {
    const event = WorldStreamEventSchema.parse(value);
    if (event.runId !== runtime.getWorld().snapshot.runId) return;
    if (event.type === 'announcement' && !announcements.approve(event.announcement)) return;
    const payload = event.type === 'world' ? { ...event.world, announcements: [] }
      : event.type === 'risk' ? event.report : event.type === 'mission' ? event.mission : event.announcement;
    for (const client of clients) {
      if (client.writableLength > 4_000_000) { client.destroy(); clients.delete(client); }
      else if (event.type !== 'world' || client.writableLength < 1_000_000) client.write(`event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`);
    }
  };
  const unsubscribe = runtime.subscribe?.(publish);
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
      json(response, 200, currentWorld());
      return;
    }
    if (request.method === 'GET' && request.url === '/api/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
      clients.add(response);
      response.write(`event: world\ndata: ${JSON.stringify(currentWorld())}\n\n`);
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
        if (!staleRun && runtime.applyCommand) {
          json(response, 200, CommandResultSchema.parse(runtime.applyCommand(parsed.data)));
          return;
        }
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
        if (!staleRun && services.submitOperatorInput) {
          const abort = new AbortController();
          response.on('close', () => abort.abort());
          const result = OperatorResponseSchema.parse(await services.submitOperatorInput(parsed.data, abort.signal));
          if (result.runId !== runtime.getWorld().snapshot.runId) {
            json(response, 409, { error: 'Operator response belongs to an old run' });
            return;
          }
          for (const announcement of result.announcements) {
            publish({ type: 'announcement', schemaVersion: 1, runId: result.runId, announcement });
          }
          json(response, 200, result);
          return;
        }
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
    if ((request.method === 'GET' && request.url === '/api/voice/token') || (request.method === 'POST' && request.url === '/api/voice/audio')) {
      if (!services.voice) {
        json(response, 503, { error: 'Voice is unavailable' });
        return;
      }
      const abort = new AbortController();
      response.on('close', () => abort.abort());
      try {
        if (request.url === '/api/voice/token') {
          json(response, 200, await services.voice.transcriptionToken(abort.signal));
        } else {
          const payload = await body(request);
          const keys = payload && typeof payload === 'object' ? Object.keys(payload) : [];
          const id = (payload as { announcementId?: unknown } | null)?.announcementId;
          const approved = keys.length === 1 && typeof id === 'string' ? announcements.resolve(id) : null;
          if (!approved) { json(response, 404, { error: 'Current approved announcement not found' }); return; }
          const result = await services.voice.audio(approved.id, abort.signal);
          if (!announcements.resolve(approved.id)) { json(response, 409, { error: 'Announcement expired or run changed' }); return; }
          response.writeHead(200, { 'content-type': result.contentType, 'cache-control': 'no-store' });
          response.end(result.audio);
        }
      } catch (error) {
        json(response, 503, { error: error instanceof Error ? error.message : 'Voice unavailable' });
      }
      return;
    }
    json(response, 404, { error: 'Not found' });
  });
  server.on('close', () => { unsubscribe?.(); announcements.clear(); });
  return { server, clients, publish, announcements };
}
