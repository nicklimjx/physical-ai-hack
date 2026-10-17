import {
  CommandEnvelopeSchema, CommandResultSchema, OperatorInputSchema, OperatorResponseSchema, WorldResponseSchema, WorldStreamEventSchema,
  type CommandEnvelope, type CommandResult, type OperatorInput, type OperatorResponse, type WorldResponse, type WorldStreamEvent,
} from '@ember/contracts';

export interface EmberClient {
  getWorld(signal?: AbortSignal): Promise<WorldResponse>;
  sendCommand(command: CommandEnvelope, signal?: AbortSignal): Promise<CommandResult>;
  submitOperatorInput(input: OperatorInput, signal?: AbortSignal): Promise<OperatorResponse>;
  subscribe(onWorld: (world: WorldResponse) => void, onError: (error: Error) => void, onEvent?: (event: WorldStreamEvent) => void, onConnection?: (connected: boolean) => void): () => void;
  reloadPreview(signal?: AbortSignal): Promise<WorldResponse>;
}

async function post<T>(path: string, value: unknown, schema: { parse(input: unknown): T }, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value), signal });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${JSON.stringify(payload)}`);
  return schema.parse(payload);
}

export function createEmberClient(): EmberClient {
  return {
    async getWorld(signal) {
      const response = await fetch('/api/world', { signal });
      if (!response.ok) throw new Error(`World request failed (${response.status})`);
      return WorldResponseSchema.parse(await response.json());
    },
    sendCommand(command, signal) {
      return post('/api/commands', CommandEnvelopeSchema.parse(command), CommandResultSchema, signal);
    },
    submitOperatorInput(input, signal) {
      return post('/api/operator-input', OperatorInputSchema.parse(input), OperatorResponseSchema, signal);
    },
    subscribe(onWorld, onError, onEvent, onConnection) {
      let stopped = false;
      let source: EventSource | null = null;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let runId: string | null = null;
      const connect = () => {
        if (stopped) return;
        source = new EventSource('/api/events');
        let connected = false;
        source.addEventListener('world', (event) => {
          try {
            const world = WorldResponseSchema.parse(JSON.parse((event as MessageEvent).data));
            if (!connected) { connected = true; onConnection?.(true); }
            runId = world.snapshot.runId;
            onWorld({ ...world, announcements: [] });
          } catch (error) {
            onError(error instanceof Error ? error : new Error('Invalid world event'));
          }
        });
        for (const type of ['risk', 'mission', 'announcement'] as const) {
          source.addEventListener(type, (event) => {
            try {
              if (!runId) return;
              const payload: unknown = JSON.parse((event as MessageEvent).data);
              const field = type === 'risk' ? 'report' : type;
              const parsed = WorldStreamEventSchema.parse({ type, schemaVersion: 1, runId, [field]: payload });
              if (parsed.type === 'risk' && parsed.report.runId !== runId) return;
              if (parsed.type === 'announcement' && parsed.announcement.runId !== runId) return;
              onEvent?.(parsed);
            } catch (error) {
              onError(error instanceof Error ? error : new Error('Invalid stream event'));
            }
          });
        }
        source.onerror = () => {
          onConnection?.(false);
          onError(new Error('Live connection interrupted; reconnecting.'));
          source?.close();
          if (!stopped) reconnectTimer = setTimeout(connect, 1200);
        };
      };
      connect();
      return () => {
        stopped = true;
        source?.close();
        source = null;
        if (reconnectTimer) clearTimeout(reconnectTimer);
      };
    },
    async reloadPreview(signal) {
      return this.getWorld(signal);
    },
  };
}
