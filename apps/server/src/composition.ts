import { randomUUID } from 'node:crypto';
import type { CommandEnvelope, CommandResult, IncidentSummary, MissionProposal, Observation, ObservedFire, OperatorBatch, OperatorInput, OperatorResponse, PlanningContext, ProviderState, RiskReport, WorldResponse, WorldStreamEvent } from '@ember/contracts';
import { createIntelligence, type ProviderConfig } from './ai/index.js';
import { createAnnouncementStore, type RouteServices, type RuntimeHooks } from './services.js';
import { createObservedFireTracker } from './ai/incidents.js';
import { createVoiceModule } from './voice/index.js';

// Structural adapter for the runtime lane; no engine code is implemented here.
export interface LiveRuntime {
  getWorld(): WorldResponse;
  subscribe(listener: (world: WorldResponse) => void): () => void;
  sendCommand(command: CommandEnvelope): CommandResult;
  applyProposal(proposal: MissionProposal): CommandResult;
  applyOperatorBatch(batch: OperatorBatch): CommandResult;
  getPlanningContext(input?: { reports?: RiskReport[]; incidents?: IncidentSummary[]; observedFires?: ObservedFire[] }): PlanningContext;
  start(): void;
  stop(): void;
}

export function createComposition(runtime: LiveRuntime, providers?: ProviderConfig) {
  const listeners = new Set<(event: WorldStreamEvent) => void>();
  let runId = runtime.getWorld().snapshot.runId;
  let reports: RiskReport[] = [];
  let events: WorldResponse['snapshot']['events'] = [];
  let generation = 0;
  let running = false;
  let operatorBusy = false;
  let conversation: NonNullable<PlanningContext['conversation']> = [];
  const operatorRequests = new Map<string, { signature: string; response: Promise<OperatorResponse> }>();
  const announcedFires = new Set<string>();
  let missionStates = new Map<string, string>();
  let assessBusy = false, assessPending = false, planBusy = false, planPending = false;
  let assessmentTimer: ReturnType<typeof setInterval> | undefined;
  let planningTimer: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  let lifetime = new AbortController();
  const applied = new Map<string, { signature: string; result: CommandResult }>();
  const emit = (event: WorldStreamEvent) => { for (const listener of listeners) listener(event); };
  const freshReports = () => {
    const world = runtime.getWorld();
    return reports.filter((report) => report.runId === world.snapshot.runId && report.validUntilSimSeconds >= world.snapshot.simSeconds);
  };
  const fireTracker = createObservedFireTracker();
  const observedFires = () => {
    const world = runtime.getWorld();
    return fireTracker.update(world.definition, runtime.getPlanningContext().observations, reports, world.snapshot.simSeconds);
  };
  const context = (): PlanningContext => {
    const world = runtime.getWorld();
    const currentReports = freshReports();
    return { ...runtime.getPlanningContext({ reports: currentReports, incidents: ai.fuseIncidents(currentReports, world.snapshot.runId, world.snapshot.simSeconds), observedFires: observedFires() }), conversation: structuredClone(conversation) };
  };
  function remember(commandId: string, signature: string, action: () => CommandResult) {
    const previous = applied.get(commandId);
    if (previous) {
      if (previous.signature !== signature) throw new Error('Command ID reused with different content');
      return structuredClone(previous.result);
    }
    const result = action();
    applied.set(commandId, { signature, result: structuredClone(result) });
    while (applied.size > 500) applied.delete(applied.keys().next().value!);
    return result;
  }
  const ai = createIntelligence({
    definition: () => runtime.getWorld().definition,
    getCurrentContext: context,
    providers,
    async approveProposal(proposal, commandId, signal) {
      signal.throwIfAborted();
      return remember(commandId, JSON.stringify(proposal), () => {
        const live = context();
        if (proposal.runId !== live.runId || proposal.decisionEpoch !== live.decisionEpoch || proposal.assignments.some((assignment) => !live.feasibleCandidates.some((candidate) => JSON.stringify(candidate) === JSON.stringify(assignment)))) {
          return { schemaVersion: 1, runId: live.runId, commandId, status: 'rejected', reason: 'stale_or_infeasible', appliedRevision: null, missionIds: [], message: 'Proposal is no longer feasible.' };
        }
        const result = { ...runtime.applyProposal(proposal), commandId };
        if (result.status === 'accepted') note('mission', proposal.summary.replace('; awaiting scheduler', '') + ' · scheduler applied assignments.');
        return result;
      });
    },
    async applyOperatorBatch(batch, signal) {
      signal.throwIfAborted(); syncRun();
      if (batch.runId !== runId) throw new Error('Operator batch belongs to an old run');
      const result = runtime.applyOperatorBatch(batch);
      if (result.status === 'accepted') note('mission', 'Operator action plan applied atomically; arrival and completion are not yet confirmed.');
      return result;
    },
    async applyOperatorCommand(command, signal) {
      signal.throwIfAborted();
      syncRun();
      if (command.source !== 'human' || command.runId !== runId) throw new Error('Operator command belongs to an old or unauthorized run');
      const result = remember(command.commandId, JSON.stringify(command), () => runtime.sendCommand(command));
      signal.throwIfAborted();
      if (runtime.getWorld().snapshot.runId !== command.runId) throw new Error('Operator command belongs to an old run');
      return result;
    },
  });
  const voiceState: ProviderState = {
    provider: 'voice',
    status: process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID ? 'ready' : 'unavailable',
    label: process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID ? 'ElevenLabs configured; access unverified' : 'Voice unavailable: configure ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID',
  };
  const getWorld = (): WorldResponse => {
    const world = runtime.getWorld();
    return { ...world, risks: freshReports(), incidents: observedFires(), announcements: [], providers: [...ai.status(), voiceState], snapshot: { ...world.snapshot, events: [...world.snapshot.events, ...events].slice(-100) } };
  };
  const announcements = createAnnouncementStore(getWorld);
  const voice = createVoiceModule(announcements);
  const publishWorld = () => emit({ schemaVersion: 1, runId, type: 'world', world: getWorld() });
  function note(type: WorldResponse['snapshot']['events'][number]['type'], summary: string) {
    events = [...events, { id: randomUUID(), type, atSimSeconds: runtime.getWorld().snapshot.simSeconds, summary }].slice(-40);
  }
  function invalidate() {
    generation++;
    ai.invalidate();
    assessPending = false;
    planPending = false;
  }
  function syncRun() {
    const next = runtime.getWorld().snapshot.runId;
    if (next === runId) return;
    invalidate();
    runId = next;
    reports = [];
    events = [];
    conversation = [];
    operatorRequests.clear();
    applied.clear();
    announcedFires.clear();
    missionStates.clear();
    announcements.clear();
  }
  function brief(text: string, missionIds: string[] = [], reportIds: string[] = []) {
    const now = Date.now();
    note('mission', text);
    announce([{ schemaVersion: 1, runId, id: `brief:${randomUUID()}`, priority: 'important', text, createdAt: now, expiresAt: now + 30_000, missionIds, reportIds }]);
  }
  function trackExecution() {
    const world = runtime.getWorld();
    for (const mission of world.snapshot.missions) {
      const previous = missionStates.get(mission.id);
      missionStates.set(mission.id, mission.status);
      if (!previous || previous === mission.status) continue;
      const name = world.snapshot.squads.find(s => s.id === mission.squadId)?.name ?? mission.squadId;
      if (mission.status === 'returning' && mission.type !== 'recall') brief(`${name} returning to Command Base for resources; response is interrupted.`, [mission.id]);
      else if (mission.status === 'refilling') brief(`${name} at Command Base; beginning a three-second refill.`, [mission.id]);
      else if (previous === 'refilling' && mission.status === 'travelling') brief(`${name} resources replenished; rejoining the assigned mission.`, [mission.id]);
      else if (previous === 'refilling' && mission.type === 'recall' && mission.status === 'idle') brief(`${name} resources replenished; holding at Command Base until resumed.`, [mission.id]);
      else if (mission.type === 'suppress' && mission.status === 'idle' && mission.progress === 1) {
        const index = Math.floor(mission.target.y / world.definition.cellSizeM) * world.definition.width + Math.floor(mission.target.x / world.definition.cellSizeM);
        const place = world.definition.regions.find(r => r.id === world.definition.staticCells[index]?.regionId)?.name ?? 'assigned target';
        brief(`${name} completed suppression at ${place}; the target area is no longer burning. Other fires may remain.`, [mission.id]);
      }
    }
  }
  function announce(items: readonly WorldResponse['announcements'][number][]) {
    for (const announcement of items) {
      if (announcement.runId === runId && announcement.expiresAt > Date.now()) emit({ schemaVersion: 1, runId, type: 'announcement', announcement });
    }
  }
  async function assess() {
    if (!running) return;
    if (assessBusy) { assessPending = true; return; }
    assessBusy = true;
    const token = generation;
    try {
      const byDrone = new Map<string, Observation[]>();
      for (const observation of context().observations.sort((a, b) => b.sampledAtSimSeconds - a.sampledAtSimSeconds)) {
        const items = byDrone.get(observation.sourceDroneId) ?? [];
        if (items.length < 12) items.push(observation);
        byDrone.set(observation.sourceDroneId, items);
      }
      const observations: Observation[] = [];
      for (let offset = 0; observations.length < 256; offset++) {
        let added = false;
        for (const items of byDrone.values()) if (items[offset]) { observations.push(items[offset]!); added = true; if (observations.length >= 256) break; }
        if (!added) break;
      }
      if (!observations.length) return;
      note('observation', `${observations.length} local sensor observations sampled.`);
      const next = await ai.assessment.assess(observations, lifetime.signal);
      if (!running || generation !== token) return;
      const world = runtime.getWorld();
      reports = [...freshReports(), ...next.filter((report) => report.runId === world.snapshot.runId && report.validUntilSimSeconds >= world.snapshot.simSeconds)].slice(-256);
      note('assessment', `${next.length} local risk reports · ${next.some((report) => report.provider === 'jev') ? 'external assessment' : 'local rules fallback'}.`);
      for (const report of next) {
        emit({ schemaVersion: 1, runId, type: 'risk', report });
      }
      for (const fire of observedFires()) {
        if (fire.status === 'fresh' && !announcedFires.has(fire.id)) {
          announcedFires.add(fire.id);
          const place = fire.regionIds.map(id => world.definition.regions.find(r => r.id === id)?.name ?? id).join(', ');
          brief(`Local sensors report ${fire.name} at ${place}. Observed extent only; checking available groups.`, [], fire.reportIds.filter(id => freshReports().some(r => r.id === id)));
        }
      }
      publishWorld();
      void plan();
    } catch {
      if (running && generation === token) note('system', 'Assessment cancelled or unavailable; physical simulation continues.');
    } finally {
      assessBusy = false;
      if (assessPending && running) { assessPending = false; void assess(); }
    }
  }
  async function plan() {
    if (!running || operatorBusy) return;
    if (planBusy) { planPending = true; return; }
    planBusy = true;
    const token = generation;
    try {
      const live = context();
      if (!live.reports.length || !live.feasibleCandidates.length) return;
      const proposal = await ai.orchestrator.propose(live, lifetime.signal);
      if (!running || generation !== token || !proposal.assignments.length) return;
      const approved = await ai.approve(proposal, randomUUID(), lifetime.signal);
      if (!running || generation !== token) return;
      announce(approved.announcements);
      publishWorld();
    } catch {
      if (running && generation === token) note('system', 'Plan cancelled or rejected; existing missions continue.');
    } finally {
      planBusy = false;
      if (planPending && running) { planPending = false; void plan(); }
    }
  }
  const hooks: RuntimeHooks = {
    getWorld,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    applyCommand(command) {
      syncRun();
      if (command.runId !== runId) throw new Error('Command belongs to an old run');
      invalidate();
      const result = remember(command.commandId, JSON.stringify(command), () => runtime.sendCommand(command));
      syncRun();
      publishWorld();
      return result;
    },
    getPlanningContext: context,
  };
  const services: RouteServices = {
    announcements,
    voice: {
      async transcriptionToken(signal) {
        try { return await voice.transcriptionToken(AbortSignal.any([signal, AbortSignal.timeout(12_000)])); }
        catch { voiceState.status = 'error'; voiceState.label = 'Voice token unavailable; typed input remains available'; throw new Error(voiceState.label); }
      },
      async audio(id, signal) {
        try { return await voice.audio(id, AbortSignal.any([signal, AbortSignal.timeout(12_000)])); }
        catch { voiceState.label = 'Speech synthesis unavailable; typed input remains available'; throw new Error(voiceState.label); }
      },
    },
    async submitOperatorInput(input: OperatorInput, signal) {
      syncRun();
      if (input.runId !== runId) throw new Error('Operator input belongs to an old run');
      const signature = JSON.stringify(input), cached = operatorRequests.get(input.requestId);
      if (cached) {
        if (cached.signature !== signature) throw new Error('Request ID reused with different operator input');
        return structuredClone(await cached.response);
      }
      if (operatorBusy) throw new Error('An operator request is already processing');
      const perform = async () => {
        operatorBusy = true;
        invalidate();
        try {
          const response = await ai.orchestrator.respond(context(), input, AbortSignal.any([signal, lifetime.signal]));
          if (input.runId !== runId) throw new Error('Operator response belongs to an old run');
          if (response.status === 'answered' && !response.announcements.length) {
            const now = Date.now();
            response.announcements.push({ schemaVersion: 1, runId: response.runId, id: `reply:${randomUUID()}`, priority: 'critical', text: response.text, createdAt: now, expiresAt: now + 15_000, missionIds: response.commandResult?.missionIds ?? [], reportIds: [] });
          }
          conversation = [...conversation, { role: 'user' as const, content: input.text.slice(0, 2000) }, { role: 'assistant' as const, content: response.text.slice(0, 2000) }].slice(-16);
          return response;
        } finally {
          operatorBusy = false;
          if (running) publishWorld();
        }
      };
      const response = perform();
      operatorRequests.set(input.requestId, { signature, response });
      while (operatorRequests.size > 100) operatorRequests.delete(operatorRequests.keys().next().value!);
      return structuredClone(await response);
    },
  };
  return {
    runtime: hooks, services, metrics: ai.metrics,
    start() {
      if (running) return;
      running = true;
      lifetime = new AbortController();
      unsubscribe = runtime.subscribe(() => { syncRun(); trackExecution(); publishWorld(); });
      runtime.start();
      assessmentTimer = setInterval(() => { void assess(); }, 2500);
      planningTimer = setInterval(() => { void plan(); }, 4000);
      void assess();
    },
    stop() {
      running = false;
      lifetime.abort();
      if (assessmentTimer) clearInterval(assessmentTimer);
      if (planningTimer) clearInterval(planningTimer);
      unsubscribe?.();
      runtime.stop();
      ai.dispose();
      announcements.clear();
    },
  };
}
