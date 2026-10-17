import { useEffect, useRef, useState } from 'react';
import type { Announcement, OperatorInput, OperatorResponse, ProviderState } from '@ember/contracts';

export interface VoicePanelProps {
  runId: string;
  connectionEpoch?: number;
  announcements: readonly Announcement[];
  onCommittedInput(input: OperatorInput): Promise<OperatorResponse>;
  status: ProviderState['status'];
}

type Turn = { id: number; released: boolean; submitted: boolean; captured: boolean; committed: string; finalizeTimer?: ReturnType<typeof setTimeout> };

export function VoicePanel({ runId, connectionEpoch = 0, announcements, onCommittedInput, status }: VoicePanelProps) {
  const [partial, setPartial] = useState('');
  const [committed, setCommitted] = useState('');
  const [typed, setTyped] = useState('');
  const [message, setMessage] = useState(status === 'ready' ? 'Ready' : 'Speech unavailable - typing remains available');
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const socket = useRef<WebSocket | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const source = useRef<MediaStreamAudioSourceNode | null>(null);
  const processor = useRef<ScriptProcessorNode | null>(null);
  const playback = useRef<HTMLAudioElement | null>(null);
  const playbackUrl = useRef<string | null>(null);
  const playbackAbort = useRef<AbortController | null>(null);
  const playbackGeneration = useRef(0);
  const handled = useRef(new Set<string>());
  const queue = useRef<{ item: Announcement; operator: boolean }[]>([]);
  const speaking = useRef(false);
  const lastNoncritical = useRef(0);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turn = useRef<Turn | null>(null);
  const turnId = useRef(0);
  const keyboardHeld = useRef(false);
  const initialized = useRef(false);
  const latest = useRef({ runId, connectionEpoch, onCommittedInput });
  latest.current = { runId, connectionEpoch, onCommittedInput };

  function stopAudio() {
    if (cooldownTimer.current) { clearTimeout(cooldownTimer.current); cooldownTimer.current = null; }
    playbackGeneration.current++;
    playbackAbort.current?.abort(); playbackAbort.current = null;
    queue.current = [];
    if (playback.current) { playback.current.pause(); playback.current.src = ''; playback.current = null; }
    if (playbackUrl.current) { URL.revokeObjectURL(playbackUrl.current); playbackUrl.current = null; }
    speaking.current = false;
  }
  function stopCapture() {
    processor.current?.disconnect(); processor.current = null;
    source.current?.disconnect(); source.current = null;
    stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null;
    void audioContext.current?.close(); audioContext.current = null;
  }
  function closeTurn() {
    const active = turn.current;
    if (active?.finalizeTimer) clearTimeout(active.finalizeTimer);
    stopCapture(); socket.current?.close(); socket.current = null; turn.current = null;
  }
  function interruptForListening() { stopAudio(); }

  useEffect(() => {
    turnId.current++; closeTurn(); stopAudio(); setPartial(''); setCommitted('');
    handled.current.clear();
    for (const item of announcements) handled.current.add(item.id);
    initialized.current = true;
    setMessage(status === 'ready' ? 'Ready' : 'Speech unavailable - typing remains available');
  }, [runId, connectionEpoch]);
  useEffect(() => { if (status !== 'ready') { closeTurn(); stopAudio(); } }, [status]);
  useEffect(() => () => { turnId.current++; closeTurn(); stopAudio(); }, []);

  async function submit(text: string, active?: Turn) {
    const value = text.trim();
    if (!value || busyRef.current || (active && active.submitted)) return;
    if (!active && turn.current) { turnId.current++; closeTurn(); }
    if (active) active.submitted = true;
    stopAudio();
    busyRef.current = true; setBusy(true); setCommitted(value); setMessage('Processing committed speech'); setPartial('');
    const requestRun = latest.current.runId;
    const requestConnection = latest.current.connectionEpoch;
    try {
      const response = await latest.current.onCommittedInput({ schemaVersion: 1, runId: requestRun, requestId: crypto.randomUUID(), text: value, committed: true });
      if (requestRun !== latest.current.runId || requestConnection !== latest.current.connectionEpoch) return;
      setMessage(response.status === 'answered' ? response.text : 'Operator input unavailable');
      if (response.status === 'answered' && response.runId === requestRun) {
        const accepted = response.commandResult === null || response.commandResult.status === 'accepted';
        if (accepted) enqueue(response.announcements, true);
      }
    } catch { if (requestRun === latest.current.runId && requestConnection === latest.current.connectionEpoch) setMessage('Could not submit input'); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function enqueue(items: readonly Announcement[], operator = false) {
    if (status !== 'ready') { for (const item of items) handled.current.add(item.id); return; }
    const now = Date.now();
    for (const item of items) {
      if (item.runId !== latest.current.runId || item.expiresAt <= now) continue;
      if (handled.current.has(item.id)) {
        if (operator) {
          const pending = queue.current.find(entry => entry.item.id === item.id);
          if (pending) { queue.current = queue.current.filter(entry => entry !== pending); queue.current.unshift({ item, operator: true }); }
        }
        continue;
      }
      handled.current.add(item.id);
      const related = new Set([...item.missionIds, ...item.reportIds]);
      queue.current = queue.current.filter(({ item: old }) =>
        old.runId !== item.runId || ![...old.missionIds, ...old.reportIds].some((id) => related.has(id)));
      const queued = { item, operator };
      if (operator || item.priority === 'critical') queue.current.unshift(queued); else queue.current.push(queued);
    }
    queue.current = queue.current.slice(0, 4);
    void playNext();
  }
  async function playNext() {
    if (speaking.current || muted || status !== 'ready' || turn.current) return;
    let next = queue.current.shift();
    while (next && (next.item.runId !== latest.current.runId || next.item.expiresAt <= Date.now())) next = queue.current.shift();
    if (!next) return;
    if (!next.operator && next.item.priority !== 'critical' && Date.now() - lastNoncritical.current < 15_000) {
      queue.current.unshift(next);
      if (!cooldownTimer.current) cooldownTimer.current = setTimeout(() => { cooldownTimer.current = null; void playNext(); }, Math.max(1, 15_000 - (Date.now() - lastNoncritical.current)));
      return;
    }
    if (!next.operator && next.item.priority !== 'critical') lastNoncritical.current = Date.now();
    const { item } = next;
    speaking.current = true;
    const generation = ++playbackGeneration.current;
    const controller = new AbortController(); playbackAbort.current = controller;
    try {
      const response = await fetch('/api/voice/audio', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ announcementId: item.id }) });
      if (!response.ok || generation !== playbackGeneration.current || item.runId !== latest.current.runId || item.expiresAt <= Date.now() || muted || turn.current) return;
      const blob = await response.blob();
      if (generation !== playbackGeneration.current || muted || turn.current || item.runId !== latest.current.runId || item.expiresAt <= Date.now()) return;
      const url = URL.createObjectURL(blob); const audio = new Audio(url); playback.current = audio; playbackUrl.current = url;
      audio.onended = () => { if (playbackUrl.current === url) { URL.revokeObjectURL(url); playbackUrl.current = null; } if (generation !== playbackGeneration.current) return; playback.current = null; speaking.current = false; void playNext(); };
      await audio.play();
    } catch { if (!controller.signal.aborted) setMessage('Narration unavailable'); }
    finally {
      if (generation === playbackGeneration.current && (!playback.current || playback.current.paused)) {
        playback.current = null;
        if (playbackUrl.current) { URL.revokeObjectURL(playbackUrl.current); playbackUrl.current = null; }
        speaking.current = false; playbackAbort.current = null; void playNext();
      }
    }
  }

  async function startMic() {
    if (status !== 'ready' || busyRef.current || turn.current) return;
    interruptForListening();
    const active: Turn = { id: ++turnId.current, released: false, submitted: false, captured: false, committed: '' };
    turn.current = active; setMessage('Listening'); setPartial(''); setCommitted('');
    active.finalizeTimer = setTimeout(() => {
      if (turn.current === active) { setMessage('Speech connection timed out - use typed input'); closeTurn(); }
    }, 20_000);
    const valid = () => turn.current === active && active.id === turnId.current;
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!valid()) { mic.getTracks().forEach((t) => t.stop()); return; }
      stream.current = mic;
      const tokenResponse = await fetch('/api/voice/token');
      if (!valid()) return;
      if (!tokenResponse.ok) throw new Error('Token unavailable');
      const { token } = await tokenResponse.json() as { token: string };
      if (!valid()) return;
      const ws = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&token=${encodeURIComponent(token)}&audio_format=pcm_16000&commit_strategy=manual`);
      socket.current = ws;
      ws.onmessage = (event) => {
        if (!valid()) return;
        const data = JSON.parse(event.data) as { message_type?: string; text?: string; error?: string };
        if (data.message_type === 'partial_transcript') setPartial(data.text ?? '');
        if (data.message_type === 'committed_transcript' || data.message_type === 'committed_transcript_with_timestamps') {
          const text = data.text?.trim();
          if (!text || active.submitted) return;
          active.committed = text; setCommitted(text); setPartial('');
          if (active.released) { closeTurn(); void submit(text, active); }
        }
        if (data.message_type === 'error' || data.message_type === 'auth_error') { setMessage(data.error ?? 'Speech transcription failed'); closeTurn(); }
      };
      ws.onerror = () => { if (valid()) { setMessage('Speech connection failed'); closeTurn(); } };
      ws.onclose = () => { if (valid()) { setMessage('Speech connection closed'); closeTurn(); } };
      ws.onopen = async () => {
        if (!valid()) return;
        if (active.released) { finalize(active); return; }
        try {
          const context = new AudioContext({ sampleRate: 16000 }); audioContext.current = context;
          const input = context.createMediaStreamSource(mic); source.current = input;
          const node = context.createScriptProcessor(4096, 1, 1); processor.current = node;
          node.onaudioprocess = (event) => {
            if (!valid() || active.released || ws.readyState !== WebSocket.OPEN) return;
            active.captured = true;
            const samples = event.inputBuffer.getChannelData(0); const pcm = new Int16Array(samples.length);
            for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
            let binary = ''; for (const byte of new Uint8Array(pcm.buffer)) binary += String.fromCharCode(byte);
            ws.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: btoa(binary), sample_rate: 16000, commit: false }));
          };
          input.connect(node); node.connect(context.destination);
          if (active.released) stopCapture();
        } catch { if (valid()) { setMessage('Microphone unavailable - use typed input'); closeTurn(); } }
      };
      if (active.released && ws.readyState === WebSocket.OPEN) finalize(active);
    } catch { if (valid()) { setMessage('Microphone unavailable - use typed input'); closeTurn(); } }
  }
  function finalize(active: Turn) {
    stopCapture();
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: '', sample_rate: 16000, commit: true }));
      active.finalizeTimer = setTimeout(() => {
        if (turn.current !== active) return;
        if (active.committed && !active.submitted) { const text = active.committed; closeTurn(); void submit(text, active); }
        else { setMessage(active.submitted ? 'Transcript committed' : 'No speech detected'); closeTurn(); }
      }, 4000);
    } else { setMessage('Speech connection unavailable - use typed input'); closeTurn(); }
  }
  function endMic() {
    const active = turn.current; if (!active || active.released) return;
    active.released = true; setMessage('Finalizing transcript'); stopCapture();
    if (!active.captured && !active.committed) { setMessage('No speech captured - use typed input'); closeTurn(); return; }
    const ws = socket.current;
    if (active.committed && !active.submitted) { const text = active.committed; closeTurn(); void submit(text, active); return; }
    if (ws?.readyState === WebSocket.OPEN) finalize(active);
  }

  const keyboardActions = useRef({ startMic, endMic, closeTurn, stopAudio });
  keyboardActions.current = { startMic, endMic, closeTurn, stopAudio };
  useEffect(() => {
    const editable = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'KeyT' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || editable(event.target)) return;
      event.preventDefault();
      keyboardHeld.current = true;
      keyboardActions.current.stopAudio();
      void keyboardActions.current.startMic();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'KeyT' || !keyboardHeld.current) return;
      event.preventDefault(); keyboardHeld.current = false;
      keyboardActions.current.endMic();
    };
    const blur = () => { keyboardHeld.current = false; keyboardActions.current.closeTurn(); keyboardActions.current.stopAudio(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); blur(); };
  }, []);
  useEffect(() => { if (muted) stopAudio(); else void playNext(); }, [muted]);
  useEffect(() => {
    if (!initialized.current) return;
    enqueue(announcements);
  }, [announcements, runId, connectionEpoch]);

  return <div className="voice-panel" aria-live="polite">
    <span className="mic">◉</span><span><b>{busy ? 'PROCESSING' : status === 'ready' ? 'VOICE READY' : 'VOICE UNAVAILABLE'}</b><small>{message}{committed ? ` - ${committed}` : partial ? ` - ${partial}` : ''}</small></span>
    <b className="voice-key-hint">Hold T to talk</b>
    <button aria-label="Hold to speak, or hold T outside text fields" disabled={status !== 'ready' || busy} onPointerDown={(event) => { event.preventDefault(); void startMic(); }} onPointerUp={endMic} onPointerCancel={endMic} onPointerLeave={endMic}>🎙 Hold</button>
    <button type="button" aria-pressed={muted} onClick={() => setMuted(!muted)}>{muted ? 'UNMUTE' : 'MUTE NARRATION'}</button>
    <form onSubmit={(event) => { event.preventDefault(); void submit(typed); setTyped(''); }}><input value={typed} onChange={(event) => setTyped(event.target.value)} aria-label="Type operator input" placeholder="Type instead"/><button disabled={busy || !typed.trim()}>Send</button></form>
  </div>;
}
