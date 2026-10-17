import { useEffect, useRef, useState } from 'react';
import type { OperatorInput, WorldResponse } from '@ember/contracts';
import { createEmberClient } from './client/index.js';
import { ScenePreview } from './scene/index.js';
import { TacticalMap } from './tactical/index.js';
import { Dashboard } from './dashboard/index.js';
import { VoicePanel } from './voice/index.js';

const client = createEmberClient();

export default function App() {
  const [world, setWorld] = useState<WorldResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const currentRunId = useRef<string | null>(null);
  const streamReceived = useRef(false);

  useEffect(() => {
    const abort = new AbortController();
    const acceptWorld = (next: WorldResponse) => {
      if (currentRunId.current !== next.snapshot.runId) setSelected([]);
      currentRunId.current = next.snapshot.runId;
      setWorld(next);
      setError('');
    };
    const stop = client.subscribe((next) => {
      streamReceived.current = true;
      acceptWorld(next);
    }, (eventError) => setError(eventError.message));
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

  const submitInput = (input: OperatorInput) => client.submitOperatorInput(input);
  const reloadPreview = () => client.reloadPreview().then((next) => {
    if (currentRunId.current !== next.snapshot.runId) setSelected([]);
    currentRunId.current = next.snapshot.runId;
    setWorld(next);
    setError('');
  }).catch((reloadError) => setError(reloadError.message));

  if (!world) return <main className="loading">{error || 'Connecting to local preview…'}</main>;
  return (
    <main className="app">
      <header className="topbar">
        <a className="brand"><span>✳</span> EMBER <b>COMMAND</b></a>
        <div className="run-status"><i/> SIMULATION PREVIEW <span>·</span> AUTONOMY OFFLINE</div>
        <div className="clock">DAYLIGHT RESPONSE <b>00:28</b></div>
      </header>
      {error && <div role="status" className="connection-error">Connection issue: {error}</div>}
      <section className="content">
        <section className="stage">
          <ScenePreview definition={world.definition} snapshot={world.snapshot} selectedIds={selected} onSelect={(id) => setSelected([id])}/>
          <div className="stage-inset"><TacticalMap definition={world.definition} snapshot={world.snapshot} selectedIds={selected} onSelect={(id) => setSelected([id])}/></div>
          <div className="legend"><span>● ACTIVE FIRE</span><span>● SQUADS</span><span>● WOODLAND</span></div>
          <VoicePanel runId={world.snapshot.runId} announcements={world.announcements} onCommittedInput={submitInput} status={world.providers.find((provider) => provider.provider === 'voice')?.status ?? 'unavailable'}/>
        </section>
        <Dashboard world={world} onReload={reloadPreview}/>
      </section>
      <footer><span>EMBER COMMAND <i>·</i> LOCAL SIMULATION CONCEPT</span><span>Not operational fire guidance · Fixture data only</span></footer>
    </main>
  );
}
