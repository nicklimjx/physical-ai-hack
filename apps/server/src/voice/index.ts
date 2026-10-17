import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Announcement } from '@ember/contracts';

export interface VoiceModule {
  transcriptionToken(signal: AbortSignal): Promise<{ token: string; expiresAt: number }>;
  audio(announcementId: string, signal: AbortSignal): Promise<{ audio: Uint8Array; contentType: string }>;
}

export interface VoiceRuntime {
  getCurrent(): { runId: string; announcements: readonly Announcement[] };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function withTimeout(parent?: AbortSignal, ms = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Voice provider timeout')), ms);
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort(); else parent?.addEventListener('abort', abort, { once: true });
  return { signal: controller.signal, clear: () => { clearTimeout(timer); parent?.removeEventListener('abort', abort); } };
}

export function createVoiceModule(runtime: VoiceRuntime, options: {
  apiKey?: string;
  voiceId?: string;
  fetcher?: typeof fetch;
} = {}): VoiceModule {
  const fetcher = options.fetcher ?? fetch;
  const key = () => options.apiKey ?? process.env.ELEVENLABS_API_KEY;
  return {
    async transcriptionToken(signal) {
      if (signal.aborted) throw signal.reason;
      const apiKey = key();
      if (!apiKey) throw new Error('ElevenLabs voice is unavailable: ELEVENLABS_API_KEY is not configured');
      const response = await fetcher('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', { method: 'POST', headers: { 'xi-api-key': apiKey }, signal });
      if (!response.ok) throw new Error(`ElevenLabs token request failed (${response.status})`);
      const data = await response.json() as { token?: string };
      if (!data.token) throw new Error('ElevenLabs token response was invalid');
      return { token: data.token, expiresAt: Date.now() + 15 * 60_000 };
    },
    async audio(id, signal) {
      if (signal.aborted) throw signal.reason;
      const before = runtime.getCurrent();
      const approved = before.announcements.find((item) => item.id === id && item.runId === before.runId && item.expiresAt > Date.now());
      if (!approved) throw new Error('Announcement is not currently approved');
      const apiKey = key(); const voiceId = options.voiceId ?? process.env.ELEVENLABS_VOICE_ID;
      if (!apiKey || !voiceId) throw new Error('ElevenLabs TTS unavailable: configure ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID');
      const generated = await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_22050_32`, {
        method: 'POST', headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ text: approved.text, model_id: 'eleven_flash_v2_5' }), signal,
      });
      if (!generated.ok) throw new Error(`ElevenLabs TTS request failed (${generated.status})`);
      const audio = new Uint8Array(await generated.arrayBuffer());
      const after = runtime.getCurrent();
      const stillApproved = after.runId === before.runId && after.announcements.some((item) => item.id === id && item.runId === after.runId && item.text === approved.text && item.expiresAt > Date.now());
      if (!stillApproved || signal.aborted) throw new Error('Announcement expired or changed during synthesis');
      return { audio, contentType: generated.headers.get('content-type') ?? 'audio/mpeg' };
    },
  };
}

async function readJson(req: IncomingMessage): Promise<any> {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 4000) throw new Error('Request too large'); }
  return JSON.parse(raw || '{}');
}

export function createVoiceHandlers(voice: VoiceModule) {
  return {
    async token(_req: IncomingMessage, res: ServerResponse) {
      const timeout = withTimeout(undefined, 12_000);
      try { sendJson(res, 200, await voice.transcriptionToken(timeout.signal)); }
      catch { sendJson(res, 503, { error: 'Voice unavailable' }); }
      finally { timeout.clear(); }
    },
    async audio(req: IncomingMessage, res: ServerResponse) {
      let id: unknown;
      try { id = (await readJson(req)).announcementId; }
      catch { sendJson(res, 400, { error: 'Invalid request body' }); return; }
      if (typeof id !== 'string' || !id || id.length > 100) { sendJson(res, 400, { error: 'A current announcementId is required' }); return; }
      const timeout = withTimeout(undefined, 12_000);
      try {
        const result = await voice.audio(id, timeout.signal);
        if (timeout.signal.aborted) throw timeout.signal.reason;
        res.writeHead(200, { 'content-type': result.contentType, 'cache-control': 'no-store' });
        res.end(Buffer.from(result.audio));
      } catch { sendJson(res, 404, { error: 'Approved current audio is unavailable' }); }
      finally { timeout.clear(); }
    },
  };
}

export const voiceUnavailable: VoiceModule = {
  async transcriptionToken(signal) { if (signal.aborted) throw signal.reason; throw new Error('Voice is unavailable in preview'); },
  async audio(_id, signal) { if (signal.aborted) throw signal.reason; throw new Error('Voice is unavailable in preview'); },
};
