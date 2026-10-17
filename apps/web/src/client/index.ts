import {
  CommandEnvelopeSchema, CommandResultSchema, OperatorInputSchema, OperatorResponseSchema, WorldResponseSchema,
  type CommandEnvelope, type CommandResult, type OperatorInput, type OperatorResponse, type WorldResponse,
} from '@ember/contracts';

export interface EmberClient {
  getWorld(signal?: AbortSignal): Promise<WorldResponse>;
  sendCommand(command: CommandEnvelope, signal?: AbortSignal): Promise<CommandResult>;
  submitOperatorInput(input: OperatorInput, signal?: AbortSignal): Promise<OperatorResponse>;
  subscribe(onWorld: (world: WorldResponse) => void, onError: (error: Error) => void): () => void;
  reloadPreview(signal?: AbortSignal): Promise<WorldResponse>;
}

async function post<T>(path: string, value: unknown, schema: { parse(input: unknown): T }, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value), signal });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${JSON.stringify(payload)}`);
  return schema.parse(payload);
}

export function createEmberClient(): EmberClient {
  let stopped = false;
  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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
    subscribe(onWorld, onError) {
      stopped = false;
      const connect = () => {
        if (stopped) return;
        source = new EventSource('/api/events');
        source.addEventListener('world', (event) => {
          try {
            onWorld(WorldResponseSchema.parse(JSON.parse((event as MessageEvent).data)));
          } catch (error) {
            onError(error instanceof Error ? error : new Error('Invalid world event'));
          }
        });
        source.onerror = () => {
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
