import { useEffect, useMemo, useRef, useState } from 'react';
import type { Announcement, CommandEnvelope, OperatorInput, WorldResponse } from '@ember/contracts';
import { createEmberClient } from './client/index.js';
import { ScenePreview } from './scene/index.js';
import { TacticalMap } from './tactical/index.js';
import { Dashboard } from './dashboard/index.js';
import { VoicePanel } from './voice/index.js';
import { deriveMapPrior, mapPriorKey, quantizePriorWeather, type ViewMode } from './view-mode.js';
import './autonomy-ui.css';

const client = createEmberClient();

export default function App() {
  const [world, setWorld] = useState<WorldResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [targetPosition, setTargetPosition] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState('');
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [commandMessage, setCommandMessage] = useState('');
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [tacticalMain, setTacticalMain] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('natural');
  const currentRunId = useRef<string | null>(null);
  const streamReceived = useRef(false);

  useEffect(() => {
    const abort = new AbortController();
    const acceptWorld = (next: WorldResponse) => {
      if (currentRunId.current !== next.snapshot.runId) {
        setSelected([]);
        setTargetPosition(null);
        setAnnouncements([]);
        setCommandMessage('');
      }
      currentRunId.current = next.snapshot.runId;
      setWorld((previous) => {
        if (previous?.snapshot.runId !== next.snapshot.runId) return next;
        const risks = [...new Map([...previous.risks, ...next.risks].filter(report => report.runId === next.snapshot.runId).map(report => [report.id, report])).values()].slice(-100);
        return { ...(previous.snapshot.revision > next.snapshot.revision ? previous : next), risks };
      });
      setError('');
    };
    const stop = client.subscribe((next) => {
      streamReceived.current = true;
      acceptWorld(next);
    }, (eventError) => setError(eventError.message), (event) => {
      if (event.runId !== currentRunId.current) return;
      if (event.type === 'announcement') {
        setAnnouncements((items) => [...items.filter((item) => item.id !== event.announcement.id && item.expiresAt > Date.now()), event.announcement].slice(-16));
      } else if (event.type === 'risk') {
        setWorld((previous) => previous && ({ ...previous, risks: [...previous.risks.filter((item) => item.id !== event.report.id), event.report].slice(-100) }));
      }
    }, () => {
      setAnnouncements([]);
      setConnectionEpoch((epoch) => epoch + 1);
    });
    client.getWorld(abort.signal).then((next) => {
      if (!streamReceived.current) acceptWorld(next);
    }).catch((fetchError) => {
      if (!abort.signal.aborted) setError(String(fetchError));
    });
    return () => {
      abort.abort();
      stop();
    };
  }, []);

  const submitInput = async (input: OperatorInput) => {
    const result = await client.submitOperatorInput({ ...input, selectedIds: selected, ...(targetPosition ? { targetPosition } : {}) });
    if (result.runId !== currentRunId.current) throw new Error('Response belongs to an old run.');
    setCommandMessage(result.text);
    return result;
  };
  const onCommand = async (command: CommandEnvelope) => {
    if (!currentRunId.current || command.runId !== currentRunId.current) throw new Error('Command belongs to an old or disconnected run.');
    const result = await client.sendCommand(command);
    if (result.runId === currentRunId.current) setCommandMessage(result.message);
    return result;
  };
  const callbacks = {
    onCommand,
    onOperatorInput: submitInput,
    selectedIds: selected,
    onSelect: (id: string) => setSelected([world?.snapshot.squads.find(squad => squad.id === id || squad.droneIds.includes(id))?.id ?? id]),
    targetPosition,
    onTargetSelect: setTargetPosition,
  };
  const reloadPreview = () => client.reloadPreview().then((next) => {
    if (currentRunId.current !== next.snapshot.runId) {
      setSelected([]);
      setTargetPosition(null);
      setAnnouncements([]);
      setCommandMessage('');
    }
    currentRunId.current = next.snapshot.runId;
    setWorld(next);
    setError('');
  }).catch((reloadError) => setError(reloadError.message));

  const priorKey = world ? mapPriorKey(world.definition, world.snapshot.weather) : '';
  const mapPrior = useMemo(() => world ? deriveMapPrior(world.definition, quantizePriorWeather(world.snapshot.weather)) : new Map(), [priorKey]);
  if (!world) return <main className="loading">{error || 'Connecting to local preview…'}</main>;
  const aiStates = world.providers.filter(provider => provider.provider === 'jev' || provider.provider === 'gpt');
  const externalAssessmentSeen = world.risks.some(report => report.provider === 'jev');
  const rulesFallback = world.risks.some(report => report.provider === 'rules') || aiStates.some(provider => provider.status === 'unavailable' || provider.status === 'error');
  const autonomyLabel = externalAssessmentSeen ? (rulesFallback ? 'AI ACTIVITY · RULES FALLBACK AVAILABLE' : 'AI ACTIVITY RECORDED') : rulesFallback ? 'LOCAL RULES FALLBACK' : 'AI CONFIGURED · ACTIVITY UNVERIFIED';
  return (
    <main className="app">
      <header className="topbar">
        <a className="brand"><span>✳</span> EMBER <b>COMMAND</b></a>
        <div className="run-status"><i/> {world.preview ? 'SIMULATION PREVIEW' : autonomyLabel} <span>·</span> {world.providers.find((provider) => provider.provider === 'voice')?.status === 'ready' ? 'VOICE CONFIGURED · ACCESS UNVERIFIED' : 'VOICE UNAVAILABLE · TYPED INPUT AVAILABLE'}</div>
        <div className="clock">SIM TIME <b>{Math.floor(world.snapshot.simSeconds)}s</b></div>
      </header>
      {error && <div role="status" className="connection-error">Connection issue: {error}</div>}
      {commandMessage && <div role="status" className="connection-error">{commandMessage}</div>}
      <section className="content">
        <section className={`stage ${tacticalMain ? 'tactical-main' : ''}`}>
          <div className="scene-view" inert={tacticalMain}><ScenePreview definition={world.definition} snapshot={world.snapshot} incidents={world.incidents ?? []} reports={world.risks} mapPrior={mapPrior} mode={viewMode} selectedIds={selected} onSelect={callbacks.onSelect}/></div>
          <div className="tactical-view" inert={!tacticalMain}><TacticalMap {...callbacks} definition={world.definition} snapshot={world.snapshot} incidents={world.incidents ?? []} reports={world.risks} mapPrior={mapPrior} mode={viewMode} mainView={tacticalMain}/></div>
          <div className="view-toolbar" role="group" aria-label="Map display mode">
            {(['natural', 'thermal', 'jev'] as const).map(mode => <button key={mode} aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)}>{mode === 'jev' ? 'JEV' : mode === 'thermal' ? 'Thermal' : 'Natural'}</button>)}
            <button className="swap-view-button" onClick={() => setTacticalMain(!tacticalMain)}>Swap View</button>
          </div>
          <button className="inset-swap-hitarea" onClick={() => setTacticalMain(!tacticalMain)} aria-label={`Swap ${tacticalMain ? '3D' : 'tactical'} inset with main view`} title="Swap inset with main view"/>
          <div className="legend"><span>● ACTIVE FIRE</span><span>● FIREFIGHTER GROUPS</span><span>● WOODLAND</span></div>
          <VoicePanel connectionEpoch={connectionEpoch} runId={world.snapshot.runId} announcements={announcements} onCommittedInput={submitInput} status={world.providers.find((provider) => provider.provider === 'voice')?.status ?? 'unavailable'}/>
        </section>
        <Dashboard {...callbacks} world={world} onReload={reloadPreview}/>
      </section>
      <footer><span>EMBER COMMAND <i>·</i> LOCAL SIMULATION CONCEPT</span><span>Not operational fire guidance · {world.preview ? 'Fixture data only' : 'Stylised simulation'}</span></footer>
    </main>
  );
}
