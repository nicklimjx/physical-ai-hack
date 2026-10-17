import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { OperatorInput, OperatorResponse, WorldResponse } from '@ember/contracts';
import { useCommands, type CommandHandler } from './commands.js';
import './dashboard.css';

export interface DashboardProps {
  world: WorldResponse;
  onReload(): void;
  selectedIds?: readonly string[];
  onSelect?(id: string): void;
  onCommand?: CommandHandler;
  onOperatorInput?(input: OperatorInput): Promise<OperatorResponse>;
  targetPosition?: { x: number; y: number } | null;
}
const label = (value: string) => value.replaceAll('_', ' ');
const percent = (value: number) => `${Math.round(value * 100)}%`;
const time = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

export function Dashboard({ world, onReload, selectedIds = [], onSelect, onCommand, onOperatorInput, targetPosition }: DashboardProps) {
  const { snapshot, definition } = world;
  const { feedback, pending, send } = useCommands(snapshot.runId, onCommand);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusSquad, setFocusSquad] = useState('');
  const [regionId, setRegionId] = useState('');
  const [text, setText] = useState('');
  const [reply, setReply] = useState<{ runId: string; status: string; text: string } | null>(null);
  const inputRequest = useRef<string | null>(null);
  const currentRun = useRef(snapshot.runId);
  currentRun.current = snapshot.runId;
  useEffect(() => { setReply(null); inputRequest.current = null; setText(''); setFocusSquad(''); setRegionId(''); }, [snapshot.runId]);
  const select = (id: string) => { setFocusSquad(id); onSelect?.(id); };
  const selectedDrone = snapshot.drones.find(drone => selectedIds.includes(drone.id));
  const squad = snapshot.squads.find(item => selectedIds.includes(item.id) || item.id === selectedDrone?.squadId) ?? snapshot.squads.find(item => item.id === focusSquad) ?? snapshot.squads[0];
  const regions = definition.regions.filter(region => region.kind !== 'water' && region.kind !== 'base');
  const targetRegion = regions.find(region => region.id === regionId) ?? regions.find(region => region.kind === 'neighborhood') ?? regions[0];
  const indices = definition.staticCells.flatMap((cell, index) => cell.regionId === targetRegion?.id ? [index] : []);
  const usingMapTarget = Boolean(targetPosition && !regionId);
  const target = usingMapTarget ? targetPosition! : (indices.length ? {
    x: indices.reduce((sum, index) => sum + index % definition.width + 0.5, 0) / indices.length * definition.cellSizeM,
    y: indices.reduce((sum, index) => sum + Math.floor(index / definition.width) + 0.5, 0) / indices.length * definition.cellSizeM,
  } : null);
  const currentReply = reply?.runId === snapshot.runId ? reply : null;
  const inputPending = currentReply?.status === 'pending';
  const busy = pending || inputPending;
  async function submitText(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy || inputRequest.current) return;
    const runId = snapshot.runId;
    if (!onOperatorInput) { setReply({ runId, status: 'unavailable', text: 'Operator transport not connected. No instruction applied.' }); return; }
    const requestId = crypto.randomUUID();
    inputRequest.current = requestId;
    setReply({ runId, status: 'pending', text: 'Operator input submitted. Awaiting response…' });
    try {
      const response = await onOperatorInput({ schemaVersion: 1, runId, requestId, text: value, committed: true });
      if (currentRun.current !== runId || inputRequest.current !== requestId) return;
      if (response.runId !== runId || response.requestId !== requestId) {
        setReply({ runId, status: 'rejected', text: 'Mismatched operator response discarded.' });
      } else {
        const result = response.commandResult;
        setReply({ runId, status: result?.status ?? response.status, text: `${response.text}${result ? ` · ${result.message} (${result.reason})` : ''}` });
      }
    } catch (error) {
      if (currentRun.current === runId && inputRequest.current === requestId) setReply({ runId, status: 'unavailable', text: error instanceof Error ? error.message : 'Operator request failed.' });
    } finally { if (inputRequest.current === requestId) inputRequest.current = null; }
  }
  const wind = snapshot.weather.windMps;
  return <aside className="dashboard ec-dashboard" aria-label="Incident command dashboard">
    <div className="ec-section-head"><div><span className="ec-eyebrow">INCIDENT COMMAND</span><h2>Fleet overview</h2></div><button className="ec-icon-button" onClick={() => setSettingsOpen(!settingsOpen)} aria-expanded={settingsOpen} aria-controls="ec-settings">{settingsOpen ? 'Close' : 'Settings'} ⚙</button></div>
    <div className="ec-mode"><span className={`ec-status-dot ${world.preview ? '' : 'ready'}`}/><b>{world.preview ? 'FIXTURE PREVIEW' : 'LOCAL AUTONOMY'}</b><span>{snapshot.settings.paused ? 'PAUSED' : `${snapshot.settings.speed}×`} · {time(snapshot.simSeconds)}</span></div>
    <button className="ec-start-demo" disabled={busy || world.preview} onClick={() => void send({ type: 'start_demo' })}>Start Demo <small>Autonomous firefighting and evolving incidents</small></button>
    <p className="ec-note">Simulation is stylised; cruise speed 60 m/s is a shared demo constant, separate from sim-clock speed and fire spread. Voice: {world.providers.find(provider => provider.provider === 'voice')?.status === 'ready' ? 'configured, access unverified' : 'unavailable; typed input is available'}.</p>
    {world.preview && <p className="ec-caveat">Static fixture, not a running response. Commands require an authoritative callback; reloading is not reset.</p>}
    <div className="ec-metrics"><div><b>{snapshot.metrics.burningCells}</b><span>burning cells</span></div><div><b>{snapshot.squads.length}</b><span>firefighter groups</span></div><div><b>{snapshot.metrics.threatenedStructures}</b><span>observed risk*</span></div></div>
    <small className="ec-note">* Threatened structures, not a claim of homes saved.</small>
    {settingsOpen && <Settings key={snapshot.runId} world={world} busy={busy} send={send}/>}
    {feedback && <div className={`ec-feedback ${feedback.status}`} role="status"><b>{feedback.status}</b> {feedback.message}{feedback.status === 'accepted' && <small>Accepted is applied/assigned, not physically completed. World display follows snapshots.</small>}</div>}
    <section className="ec-section"><div className="ec-section-head"><h3>Firefighter groups & missions</h3><span>{snapshot.drones.length} aircraft</span></div>
      <div className="ec-squads">{snapshot.squads.map(item => {
        const mission = snapshot.missions.find(entry => entry.id === item.missionId);
        const drones = snapshot.drones.filter(drone => drone.squadId === item.id);
        const battery = drones.length ? drones.reduce((sum, drone) => sum + drone.battery, 0) / drones.length : 0;
        return <div key={item.id} className={`ec-squad-card ${squad?.id === item.id ? 'is-selected' : ''}`}>
          <button className="ec-squad-select" onClick={() => select(item.id)} aria-pressed={squad?.id === item.id}><i style={{ background: ({ 'group-1': '#d98d78', 'group-2': '#8bb9cd', 'group-3': '#cdb575', 'group-4': '#a9e3a2', 'group-5': '#d4d9e4', 'group-6': '#d0a6ee', 'group-7': '#f0b9dc', 'group-8': '#b7c7ff' } as Record<string, string>)[item.id] ?? '#cdb575' }}/><b>{item.name}</b><span>{mission?.pinned ? '⌖ HUMAN PIN' : mission?.source === 'human' ? 'HUMAN' : 'AUTO'}</span></button>
          <div className="ec-mission-line"><span>{mission ? `${label(mission.type)} · ${mission.status}` : 'Available · no active mission'}</span><b>{mission ? percent(mission.progress) : 'Ready'}</b></div>
          {mission && <progress max={1} value={mission.progress} aria-label={`${item.name} mission progress`}/>}
          <div className="ec-resource-line"><span>Payload <b>{percent(item.payload)}</b></span><span>Battery avg <b>{drones.length ? percent(battery) : 'n/a'}</b></span></div>
          <div className="ec-drone-list">{drones.map(drone => <button key={drone.id} onClick={() => select(item.id)} aria-pressed={selectedIds.includes(item.id)} title={`${drone.id}: ${drone.status}, battery ${percent(drone.battery)}, payload ${percent(drone.payload)}`}>{drone.id.replace('drone-', 'D')}{selectedIds.includes(item.id) ? ' ◉' : ''}</button>)}</div>
        </div>;
      })}</div>
      {squad && <details className="ec-command-box"><summary>Manual group controls · {squad.name}</summary><div className="ec-section-head"><b>Direct group {squad.name}</b><small>Human authority</small></div>
        <label className="ec-field">Target <select value={usingMapTarget ? '' : targetRegion?.id ?? ''} onChange={event => setRegionId(event.target.value)}>{targetPosition && <option value="">Map point · {Math.round(targetPosition.x)} E / {Math.round(targetPosition.y)} N</option>}{regions.map(region => <option key={region.id} value={region.id}>{region.name} · centre</option>)}</select></label>
        <div className="ec-command-grid"><button disabled={busy || !target} onClick={() => target && void send({ type: 'assign', squadId: squad.id, missionType: 'monitor', target })}>Patrol selected region</button><button disabled={busy} onClick={() => void send({ type: 'recall', squadId: squad.id })}>Recall</button><button disabled={busy} onClick={() => void send({ type: 'resume_auto', squadId: squad.id })}>Resume auto</button></div>
        <small className="ec-note">Assignments request a human pin. Resume auto releases human control. Server validates feasibility.</small>
      </details>}
    </section>
    <section className="ec-section"><div className="ec-section-head"><h3>Local risk reports</h3><span>{world.risks.length} reports</span></div>
      {!world.risks.length && <p className="ec-empty">No local reports. Ground truth is not AI knowledge.</p>}
      {world.risks.map(report => {
        const age = Math.max(0, snapshot.simSeconds - report.sampledAtSimSeconds);
        const stale = snapshot.simSeconds > report.validUntilSimSeconds;
        return <article className={`ec-risk ${stale ? 'is-stale' : ''}`} key={report.id}><div className="ec-section-head"><b>{definition.regions.find(region => region.id === report.regionId)?.name ?? report.regionId}</b><span>{label(report.classification)}</span></div><p>{report.summary}</p><div className="ec-report-meta"><span>{report.provider === 'rules' ? 'LOCAL RULES ASSESSMENT' : 'LOCAL ASSESSMENT'}</span><span>{stale ? 'STALE' : 'CURRENT'} · {Math.floor(age)}s sim age</span></div><div className="ec-source-list">{report.sourceDroneIds.map(id => <button key={id} onClick={() => onSelect?.(id)} aria-pressed={selectedIds.includes(id)}>{id}</button>)}</div><details><summary>Evidence · {report.observationIds.length} observations</summary><ul>{report.evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}</ul><small>{report.id} · {report.observationIds.join(', ') || 'No observation IDs'}<br/>Valid until {time(report.validUntilSimSeconds)}{report.confidence !== null ? ` · model certainty ${percent(report.confidence)}, not hazard probability` : ' · confidence not provided'}</small></details></article>;
      })}
    </section>
    <section className="ec-section"><div className="ec-section-head"><h3>Evidence trail</h3><span>OBSERVE → ACT</span></div><ol className="ec-event-feed">{snapshot.events.slice(-8).map(event => <li key={event.id}><time>{time(event.atSimSeconds)}</time><div><b>{event.type}</b><p>{event.summary}</p></div></li>)}</ol>{!snapshot.events.length && <p className="ec-empty">No execution evidence yet.</p>}</section>
    <section className="ec-section"><h3>Operator text</h3><form className="ec-operator-form" onSubmit={submitText}><label htmlFor="ec-operator-text" className="ec-note">Same orchestration path as voice, no microphone required.</label><textarea id="ec-operator-text" rows={2} maxLength={2000} value={text} onChange={event => setText(event.target.value)} placeholder="Alpha fight Community 2. Bravo monitor Community 1. Alpha recall. Alpha resume."/><button disabled={busy || !text.trim()}>{inputPending ? 'Processing…' : 'Send instruction / question'}</button></form>{currentReply && <div className={`ec-feedback ${currentReply.status}`} role="status"><b>{currentReply.status}</b> {currentReply.text}</div>}</section>
    <div className="ec-dashboard-foot"><span>Wind → E {wind.x.toFixed(1)} / N {wind.y.toFixed(1)} m/s<br/>Revision {snapshot.revision} · {snapshot.runId}</span><button onClick={onReload}>Reload preview</button></div>
  </aside>;
}

function Settings({ world, busy, send }: { world: WorldResponse; busy: boolean; send: ReturnType<typeof useCommands>['send'] }) {
  const { snapshot } = world;
  const [speed, setSpeed] = useState(snapshot.settings.speed);
  const [spread, setSpread] = useState(snapshot.settings.spreadMultiplier);
  const [windX, setWindX] = useState(String(snapshot.weather.windMps.x));
  const [windY, setWindY] = useState(String(snapshot.weather.windMps.y));
  const [confirmReset, setConfirmReset] = useState(false);
  const windValid = windX.trim() !== '' && windY.trim() !== '' && Number.isFinite(Number(windX)) && Number.isFinite(Number(windY));
  return <section id="ec-settings" className="ec-settings" aria-label="Simulation settings"><div className="ec-section-head"><h3>Simulation controls</h3><button disabled={busy} onClick={() => void send({ type: 'pause', paused: !snapshot.settings.paused })}>{snapshot.settings.paused ? 'Resume' : 'Pause'}</button></div>
    <small className="ec-note">Draft values below. Apply explicitly; current {snapshot.settings.speed}× speed / {snapshot.settings.spreadMultiplier} spread.</small>
    <label className="ec-slider">Time speed <b>{speed}×</b><input type="range" min="0.1" max="10" step="0.1" value={speed} onChange={event => setSpeed(Number(event.target.value))}/><button disabled={busy} onClick={() => void send({ type: 'set_speed', speed })}>Apply</button></label>
    <label className="ec-slider">Fire spread <b>{spread}×</b><input type="range" min="0" max="5" step="0.1" value={spread} onChange={event => setSpread(Number(event.target.value))}/><button disabled={busy} onClick={() => void send({ type: 'set_spread', multiplier: spread })}>Apply</button></label>
    <div className="ec-wind"><label>Wind east m/s<input type="number" step="0.1" value={windX} onChange={event => setWindX(event.target.value)}/></label><label>Wind north m/s<input type="number" step="0.1" value={windY} onChange={event => setWindY(event.target.value)}/></label><button disabled={busy || !windValid} onClick={() => void send({ type: 'set_weather', weather: { ...snapshot.weather, windMps: { x: Number(windX), y: Number(windY) } } })}>Apply wind</button></div>
    <small className="ec-note">Wind blows toward east/north. Speed advances time; spread changes fire behaviour. Ignite from the tactical map.</small>
    <div className="ec-reset">{confirmReset ? <><span>Reset ends this run and clears orders.</span><button disabled={busy} onClick={() => { void send({ type: 'reset' }); setConfirmReset(false); }}>Confirm reset</button><button onClick={() => setConfirmReset(false)}>Cancel</button></> : <button onClick={() => setConfirmReset(true)}>Reset simulation…</button>}</div>
  </section>;
}
