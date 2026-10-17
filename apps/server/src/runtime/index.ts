import { randomUUID } from 'node:crypto';
import { createPreviewWorld } from '@ember/contracts/fixtures';
import {
  CommandEnvelopeSchema, MissionProposalSchema, OperatorBatchSchema, PlanningContextSchema, WorldResponseSchema,
  type CommandEnvelope, type CommandResult, type IncidentSummary, type MissionProposal,
  type Observation, type ObservedFire, type OperatorBatch, type PlanningContext, type RiskReport, type WorldResponse,
} from '@ember/contracts';
import { CRUISE_SPEED_MPS, burnablePosition, createDefinition, createSimulation } from '@ember/sim';

export interface Runtime {
  getWorld(): WorldResponse;
  subscribe(listener: (world: WorldResponse) => void): () => void;
  start(): void;
  stop(): void;
  sendCommand(command: CommandEnvelope): CommandResult;
  applyProposal(proposal: MissionProposal): CommandResult;
  applyOperatorBatch(batch: OperatorBatch): CommandResult;
  getPlanningContext(input?: { reports?: RiskReport[]; incidents?: IncidentSummary[]; observedFires?: ObservedFire[] }): PlanningContext;
  getLocalObservations(droneId: string): ReturnType<ReturnType<typeof createSimulation>['getLocalObservations']>;
  reset(): void;
}
export interface PreviewRuntime { getWorld(): WorldResponse }
export function createPreviewRuntime(initial: WorldResponse): PreviewRuntime {
  const world = structuredClone(initial);
  return { getWorld: () => structuredClone(world) };
}

function hasFiniteNumbers(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(hasFiniteNumbers);
  if (value !== null && typeof value === 'object') return Object.values(value).every(hasFiniteNumbers);
  return true;
}

export function createRuntime(initial: WorldResponse = createPreviewWorld()): Runtime {
  const makeRunId = () => `run-${randomUUID()}`;
  let definition = createDefinition(makeRunId(), initial.definition.seed);
  let simulation = createSimulation(definition);
  let state: WorldResponse = {
    ...structuredClone(initial), definition, snapshot: simulation.getSnapshot(), risks: [], announcements: [], preview: false,
    providers: [
      { provider: 'jev', status: 'unavailable', label: 'Assessment adapter not connected' },
      { provider: 'gpt', status: 'unavailable', label: 'Orchestrator adapter not connected' },
      { provider: 'voice', status: 'unavailable', label: 'Voice adapter not connected' },
    ],
  };
  const listeners = new Set<(world: WorldResponse) => void>();
  const dedup = new Map<string, { body: string; result: CommandResult }>();
  const priorities = new Map<string, number>();
  let knownReportIds = new Set<string>();
  let knownReports = new Map<string, RiskReport>();
  const observationCache = new Map<string, Observation>();
  let epoch = 0;
  let physicsTimer: ReturnType<typeof setInterval> | undefined;
  let snapshotTimer: ReturnType<typeof setInterval> | undefined;
  let demoStarted = false;
  let demoSchedule: { at: number; position: { x: number; y: number } }[] = [];

  const captureObservations = () => {
    for (const drone of simulation.getSnapshot().drones) {
      for (const observation of simulation.getLocalObservations(drone.id)) observationCache.set(observation.id, structuredClone(observation));
    }
    while (observationCache.size > 12000) observationCache.delete(observationCache.keys().next().value!);
  };
  let staging = false;
  const publish = () => {
    if (staging) return;
    state.snapshot = simulation.getSnapshot();
    state = WorldResponseSchema.parse(state);
    for (const listener of listeners) listener(structuredClone(state));
  };
  const result = (runId: string, commandId: string, status: CommandResult['status'], message: string, missionIds: string[] = []): CommandResult => ({
    schemaVersion: 1, runId, commandId, status, reason: message,
    appliedRevision: status === 'accepted' ? simulation.getSnapshot().revision : null, missionIds, message,
  });
  const squadCanReach = (squadId: string, target: { x: number; y: number }, requirePayload: boolean): boolean => {
    const snapshot = simulation.getSnapshot();
    const squad = snapshot.squads.find(item => item.id === squadId);
    if (!squad) return false;
    const drones = snapshot.drones.filter(item => item.squadId === squadId);
    if (drones.length === 0 || (requirePayload && squad.payload <= 0.05)) return false;
    return drones.every(drone => {
      const distance = Math.hypot(target.x - drone.position.x, target.y - drone.position.y);
      const returnDistance = Math.hypot(target.x - definition.base.x, target.y - definition.base.y);
      const energyNeeded = (distance + returnDistance) / CRUISE_SPEED_MPS * 0.0006 + 0.08;
      return drone.battery >= energyNeeded;
    });
  };
  const makeCandidates = (reports: RiskReport[], observations: PlanningContext['observations'], missions: PlanningContext['missions'], squads: PlanningContext['squads']) => {
    const latestReports = new Map<string, RiskReport>();
    for (const report of [...reports].sort((a, b) => b.sampledAtSimSeconds - a.sampledAtSimSeconds)) {
      if (!latestReports.has(report.regionId)) latestReports.set(report.regionId, report);
    }
    const evidenceTargets = [...latestReports.values()].flatMap(report => {
      const unique = new Map<string, Observation>();
      for (const item of observations.filter(item => report.observationIds.includes(item.id) && report.classification === 'active_fire' && item.observed.burning).sort((a, b) => b.observed.heat - a.observed.heat)) {
        const key = `${item.position.x}:${item.position.y}`;
        if (!unique.has(key)) unique.set(key, item);
      }
      return [...unique.values()].slice(0, 4).map(item => ({ report, target: item.position }));
    });
    const candidates: PlanningContext['feasibleCandidates'] = [];
    for (const squad of squads) {
      const active = missions.find(mission => mission.id === squad.missionId);
      if (active) candidates.push({ squadId: squad.id, type: active.type, target: active.target, reportIds: [] });
      if (active?.pinned) continue;
      candidates.push({ squadId: squad.id, type: 'hold', target: active?.target ?? definition.base, reportIds: [] });
      candidates.push({ squadId: squad.id, type: 'recall', target: definition.base, reportIds: [] });
      for (const region of definition.regions.filter(item => item.kind === 'neighborhood')) {
        const cells = definition.staticCells.flatMap((cell, index) => cell.regionId === region.id ? [index] : []);
        if (!cells.length) continue;
        const target = { x: cells.reduce((sum, index) => sum + (index % definition.width + 0.5) * definition.cellSizeM, 0) / cells.length, y: cells.reduce((sum, index) => sum + (Math.floor(index / definition.width) + 0.5) * definition.cellSizeM, 0) / cells.length };
        candidates.push({ squadId: squad.id, type: 'monitor', target, reportIds: [] });
      }
      for (const { report, target } of evidenceTargets) {
        if (!squadCanReach(squad.id, target, true)) continue;
        candidates.push({ squadId: squad.id, type: 'suppress', target, reportIds: [report.id] });
      }
    }
    const ranked = candidates.sort((a, b) => {
      const score = (candidate: typeof a) => {
        const report = reports.find(item => candidate.reportIds.includes(item.id));
        return report ? priorities.get(report.regionId) ?? 0 : 0;
      };
      return score(b) - score(a);
    });
    const perSquad = new Map(squads.map(squad => [squad.id, ranked.filter(candidate => candidate.squadId === squad.id).slice(0, 32)]));
    const fair: PlanningContext['feasibleCandidates'] = [];
    for (let offset = 0; fair.length < 96; offset++) {
      let added = false;
      for (const squad of squads) {
        const candidate = perSquad.get(squad.id)?.[offset];
        if (candidate) { fair.push(candidate); added = true; if (fair.length >= 96) break; }
      }
      if (!added) break;
    }
    return fair;
  };
  const apply = (raw: MissionProposal): CommandResult => {
    const parsed = MissionProposalSchema.safeParse(raw);
    if (!hasFiniteNumbers(raw) || !parsed.success) return result(definition.runId, 'proposal', 'rejected', 'Invalid proposal');
    const proposal = parsed.data;
    const snapshot = simulation.getSnapshot();
    if (proposal.runId !== definition.runId || proposal.decisionEpoch !== epoch) return result(definition.runId, 'proposal', 'rejected', 'Stale run or decision epoch');
    const assigned = new Set<string>();
    for (const assignment of proposal.assignments) {
      const squad = snapshot.squads.find(item => item.id === assignment.squadId);
      if (!squad || assigned.has(assignment.squadId)) return result(definition.runId, 'proposal', 'rejected', 'Unknown or duplicated squad');
      if (assignment.target.x < 0 || assignment.target.y < 0 || assignment.target.x >= definition.width * definition.cellSizeM || assignment.target.y >= definition.height * definition.cellSizeM) return result(definition.runId, 'proposal', 'rejected', 'Target outside map');
      if (proposal.missionVersions[assignment.squadId] !== squad.version) return result(definition.runId, 'proposal', 'rejected', 'Stale squad mission version');
      const current = snapshot.missions.find(mission => mission.id === squad.missionId);
      const keepingCurrent = current?.type === assignment.type && current.target.x === assignment.target.x && current.target.y === assignment.target.y;
      if (proposal.source === 'auto' && current?.pinned && !keepingCurrent) return result(definition.runId, 'proposal', 'rejected', 'Cannot replace human-pinned mission');
      if (assignment.reportIds.some(id => !knownReportIds.has(id))) return result(definition.runId, 'proposal', 'rejected', 'Unknown report reference');
      if (assignment.type === 'suppress') {
        const report = assignment.reportIds.map(id => knownReports.get(id)).find(item => item?.classification === 'active_fire');
        const observedFire = report?.observationIds.some(id => {
          const observation = observationCache.get(id);
          return observation?.runId === definition.runId && observation.observed.burning && observation.position.x === assignment.target.x && observation.position.y === assignment.target.y;
        });
        if (!observedFire) return result(definition.runId, 'proposal', 'rejected', 'Suppression requires a retained local observation of burning at this target');
      }
      const needsPayload = assignment.type === 'suppress' || assignment.type === 'protect_monitor';
      const resourceTarget = assignment.type === 'recall' ? definition.base : assignment.target;
      if (!keepingCurrent && assignment.type !== 'hold' && !squadCanReach(assignment.squadId, resourceTarget, needsPayload)) return result(definition.runId, 'proposal', 'rejected', 'Insufficient payload or return battery');
      assigned.add(assignment.squadId);
    }
    const next = structuredClone(snapshot);
    let pinsChanged = false;
    for (const assignment of proposal.assignments) {
      const squad = next.squads.find(item => item.id === assignment.squadId)!;
      const current = next.missions.find(mission => mission.id === squad.missionId);
      if (proposal.source === 'human' && current && !current.pinned && current.type === assignment.type && current.target.x === assignment.target.x && current.target.y === assignment.target.y) {
        current.pinned = true;
        current.source = 'human';
        current.version++;
        squad.version++;
        pinsChanged = true;
      }
    }
    const changedAssignments = proposal.assignments.filter(assignment => {
      const current = snapshot.missions.find(mission => mission.id === snapshot.squads.find(squad => squad.id === assignment.squadId)!.missionId);
      return !(current?.type === assignment.type && current.target.x === assignment.target.x && current.target.y === assignment.target.y);
    });
    const missions = changedAssignments.map(assignment => {
      const squad = next.squads.find(item => item.id === assignment.squadId)!;
      squad.version++;
      const mission = {
        id: `mission-${definition.runId}-${assignment.squadId}-${squad.version}`, squadId: assignment.squadId,
        type: assignment.type, status: assignment.type === 'hold' ? 'idle' as const : 'travelling' as const,
        target: assignment.target, source: proposal.source, pinned: proposal.source === 'human', progress: 0, version: squad.version,
      };
      squad.missionId = mission.id;
      return mission;
    });
    for (const assignment of changedAssignments) next.missions = next.missions.filter(mission => mission.squadId !== assignment.squadId);
    next.missions.push(...missions);
    if (changedAssignments.length > 0 || pinsChanged) { next.revision++; simulation.setSnapshot(next); publish(); }
    epoch++;
    return result(definition.runId, 'proposal', 'accepted', changedAssignments.length ? 'Assignments applied' : 'Current assignments kept',
      proposal.assignments.map(assignment => next.squads.find(squad => squad.id === assignment.squadId)!.missionId).filter((id): id is string => id !== null));
  };
  const reset = () => {
    epoch++;
    definition = createDefinition(makeRunId(), initial.definition.seed);
    simulation = createSimulation(definition);
    const preview = createPreviewWorld();
    state = { ...preview, definition, snapshot: simulation.getSnapshot(), risks: [], announcements: [], preview: false };
    state.providers = [
      { provider: 'jev', status: 'unavailable', label: 'Assessment adapter not connected' },
      { provider: 'gpt', status: 'unavailable', label: 'Orchestrator adapter not connected' },
      { provider: 'voice', status: 'unavailable', label: 'Voice adapter not connected' },
    ];
    priorities.clear(); knownReportIds.clear(); knownReports.clear(); observationCache.clear(); dedup.clear(); demoStarted = false; demoSchedule = []; publish();
  };

  return {
    getWorld: () => structuredClone(state),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() {
      if (physicsTimer) return;
      physicsTimer = setInterval(() => {
        const before = simulation.getSnapshot();
        const after = simulation.step(before, 0.1);
        while (demoSchedule.length && demoSchedule[0]!.at <= after.simSeconds && !after.settings.paused) {
          const target = demoSchedule.shift()!;
          const x = Math.floor(target.position.x / definition.cellSizeM), y = Math.floor(target.position.y / definition.cellSizeM);
          const index = y * definition.width + x;
          if (x >= 0 && y >= 0 && x < definition.width && y < definition.height && definition.staticCells[index]!.initialFuel > 0 && !['water', 'road'].includes(definition.staticCells[index]!.fuelClass) && after.dynamicCells[index]!.protection <= 0.05) {
            after.dynamicCells[index]!.heat = 1; after.dynamicCells[index]!.burnState = 'burning';
          }
        }
        if (after !== before) simulation.setSnapshot(after);
        captureObservations();
      }, 100);
      snapshotTimer = setInterval(publish, 200);
    },
    stop() {
      if (physicsTimer) clearInterval(physicsTimer);
      if (snapshotTimer) clearInterval(snapshotTimer);
      physicsTimer = undefined; snapshotTimer = undefined;
    },
    reset,
    getLocalObservations: droneId => {
      const observations = simulation.getLocalObservations(droneId);
      for (const observation of observations) observationCache.set(observation.id, structuredClone(observation));
      while (observationCache.size > 12000) observationCache.delete(observationCache.keys().next().value!);
      return observations;
    },
    getPlanningContext(input = {}) {
      const snapshot = simulation.getSnapshot();
      captureObservations();
      const observations = Array.from(observationCache.values());
      const reports = (input.reports ?? []).filter(report => report.runId === definition.runId
        && report.sampledAtSimSeconds <= snapshot.simSeconds && report.validUntilSimSeconds >= snapshot.simSeconds
        && report.observationIds.some(id => observationCache.has(id))
        && definition.regions.some(region => region.id === report.regionId));
      knownReportIds = new Set(reports.map(report => report.id));
      knownReports = new Map(reports.map(report => [report.id, report]));
      return PlanningContextSchema.parse({
        schemaVersion: 1, runId: definition.runId, decisionEpoch: epoch, definition, weather: snapshot.weather,
        observations, incidents: input.incidents ?? [], observedFires: input.observedFires ?? [], reports, squads: snapshot.squads, drones: snapshot.drones,
        missions: snapshot.missions, feasibleCandidates: makeCandidates(reports, observations, snapshot.missions, snapshot.squads),
        missionVersions: Object.fromEntries(snapshot.squads.map(squad => [squad.id, squad.version])),
        humanConstraints: snapshot.squads.flatMap(squad => {
          const mission = snapshot.missions.find(item => item.id === squad.missionId);
          return mission?.pinned ? [{ squadId: squad.id, kind: 'pinned' as const, missionId: mission.id, summary: 'Human-pinned mission' }] : [];
        }),
      });
    },
    applyProposal: apply,
    applyOperatorBatch(raw) {
      const parsed = OperatorBatchSchema.safeParse(raw);
      if (!hasFiniteNumbers(raw) || !parsed.success) return result(definition.runId, raw.requestId ?? 'invalid', 'rejected', 'Invalid operator action batch');
      const batch = parsed.data, body = JSON.stringify(batch), cached = dedup.get(batch.requestId);
      if (cached) return cached.body === body ? structuredClone(cached.result) : result(definition.runId, batch.requestId, 'rejected', 'Request ID reused with different content');
      const finish = (value: CommandResult) => {
        dedup.set(batch.requestId, { body, result: structuredClone(value) });
        while (dedup.size > 500) dedup.delete(dedup.keys().next().value!);
        return value;
      };
      const reject = (message: string) => finish(result(definition.runId, batch.requestId, 'rejected', message));
      if (batch.runId !== definition.runId || batch.decisionEpoch !== epoch) return reject('Stale run or decision epoch; no actions applied');
      const snapshot = simulation.getSnapshot(), groups = new Set<string>();
      for (const action of batch.actions) {
        const squad = snapshot.squads.find(s => s.id === action.squadId);
        if (!squad || groups.has(action.squadId)) return reject('Unknown group or contradictory actions for one group; no actions applied');
        if (batch.missionVersions[squad.id] !== squad.version) return reject('Stale mission version; no actions applied');
        if (action.type === 'resume_auto' && !snapshot.missions.find(m => m.id === squad.missionId)?.pinned) return reject('Resume requires an existing human pin; no actions applied');
        groups.add(squad.id);
      }
      const original = simulation, originalEpoch = epoch;
      const staged = createSimulation(definition);
      const next = structuredClone(snapshot);
      let resumed = false;
      for (const action of batch.actions.filter(a => a.type === 'resume_auto')) {
        const squad = next.squads.find(s => s.id === action.squadId)!, mission = next.missions.find(m => m.id === squad.missionId)!;
        mission.pinned = false; mission.source = 'auto'; mission.version++; squad.version++; resumed = true;
        if (mission.type === 'recall') {
          const patrols = makeCandidates([], [], [], [{ ...squad, missionId: null }]).filter(candidate => candidate.type === 'monitor');
          const patrol = patrols[next.squads.findIndex(s => s.id === squad.id) % patrols.length];
          if (patrol) { mission.type = 'monitor'; mission.target = patrol.target; mission.progress = 0; if (mission.status === 'idle') mission.status = 'travelling'; }
        }
      }
      if (resumed) next.revision++;
      staged.setSnapshot(next); simulation = staged; staging = true;
      try {
        const assignments = batch.actions.flatMap<MissionProposal['assignments'][number]>(action => action.type === 'assign' ? [{ squadId: action.squadId, type: action.missionType, target: action.target, reportIds: action.reportIds }] : action.type === 'recall' ? [{ squadId: action.squadId, type: 'recall' as const, target: definition.base, reportIds: [] }] : []);
        if (assignments.length) {
          const applied = apply({ schemaVersion: 1, runId: definition.runId, decisionEpoch: epoch, missionVersions: batch.missionVersions, assignments, source: 'human', summary: 'Operator action plan' });
          if (applied.status !== 'accepted') { simulation = original; epoch = originalEpoch; return reject(`${applied.message}; no actions applied`); }
        } else if (resumed) epoch++;
      } catch {
        simulation = original; epoch = originalEpoch;
        return reject('Operator batch could not be validated; no actions applied');
      } finally { staging = false; }
      const missionIds = simulation.getSnapshot().squads.filter(s => groups.has(s.id)).flatMap(s => s.missionId ? [s.missionId] : []);
      const accepted = finish(result(definition.runId, batch.requestId, 'accepted', 'All operator actions applied atomically; assignment is not arrival or completion', missionIds));
      publish();
      return accepted;
    },
    sendCommand(raw) {
      const parsed = CommandEnvelopeSchema.safeParse(raw);
      if (!hasFiniteNumbers(raw) || !parsed.success) return result(definition.runId, 'invalid', 'rejected', 'Invalid command envelope');
      const command = parsed.data;
      if (command.runId !== definition.runId) return result(definition.runId, command.commandId, 'rejected', 'Stale run');
      const body = JSON.stringify(command), cached = dedup.get(command.commandId);
      if (cached) return cached.body === body ? structuredClone(cached.result) : result(definition.runId, command.commandId, 'rejected', 'Command ID reused with different content');
      const payload = command.payload;
      let commandResult: CommandResult;
      if (payload.type === 'start_demo') {
        if (!demoStarted) {
          demoStarted = true;
          const next = simulation.getSnapshot(); next.settings.paused = false; next.revision++;
          simulation.setSnapshot(next);
          const origin = next.simSeconds;
          const positions = [{ x: 0.28, y: 0.24 }, { x: 0.77, y: 0.29 }, { x: 0.76, y: 0.73 }].map(target => burnablePosition(definition, target));
          demoSchedule = positions.map((position, index) => ({ at: origin + [0, 24, 48][index]!, position }));
          const first = demoSchedule.shift()!;
          const x = Math.floor(first.position.x / definition.cellSizeM), y = Math.floor(first.position.y / definition.cellSizeM), index = y * definition.width + x;
          if (definition.staticCells[index]!.initialFuel > 0 && !['water', 'road'].includes(definition.staticCells[index]!.fuelClass) && next.dynamicCells[index]!.protection <= 0.05) {
            next.dynamicCells[index]!.heat = 1; next.dynamicCells[index]!.burnState = 'burning'; simulation.setSnapshot(next);
          }
          publish();
        }
        commandResult = result(definition.runId, command.commandId, 'accepted', 'Demo armed for this run');
      } else if (payload.type === 'reset') {
        const oldRun = definition.runId; reset(); commandResult = result(oldRun, command.commandId, 'accepted', 'New run created');
      } else if (payload.type === 'set_priority') {
        if (!definition.regions.some(region => region.id === payload.regionId)) commandResult = result(definition.runId, command.commandId, 'rejected', 'Unknown region');
        else { priorities.set(payload.regionId, payload.priority); epoch++; commandResult = result(definition.runId, command.commandId, 'accepted', 'Priority updated'); }
      } else if (payload.type === 'pause' || payload.type === 'set_speed' || payload.type === 'set_spread' || payload.type === 'set_weather') {
        const next = simulation.getSnapshot();
        if (payload.type === 'pause') next.settings.paused = payload.paused;
        else if (payload.type === 'set_speed') next.settings.speed = payload.speed;
        else if (payload.type === 'set_spread') next.settings.spreadMultiplier = payload.multiplier;
        else next.weather = payload.weather;
        next.revision++; simulation.setSnapshot(next); if (command.source === 'human') epoch++;
        commandResult = result(definition.runId, command.commandId, 'accepted', 'Setting updated'); publish();
      } else if (payload.type === 'ignite') {
        const x = Math.floor(payload.position.x / definition.cellSizeM), y = Math.floor(payload.position.y / definition.cellSizeM);
        const index = y * definition.width + x;
        if (x < 0 || y < 0 || x >= definition.width || y >= definition.height || definition.staticCells[index]!.initialFuel <= 0) commandResult = result(definition.runId, command.commandId, 'rejected', 'Invalid ignition target');
        else { const next = simulation.getSnapshot(); next.dynamicCells[index]!.heat = 1; next.dynamicCells[index]!.burnState = 'burning'; next.revision++; simulation.setSnapshot(next); if (command.source === 'human') epoch++; commandResult = result(definition.runId, command.commandId, 'accepted', 'Ignition started'); publish(); }
      } else if (payload.type === 'assign' || payload.type === 'recall') {
        const squad = simulation.getSnapshot().squads.find(item => item.id === payload.squadId);
        if (!squad) commandResult = result(definition.runId, command.commandId, 'rejected', 'Unknown squad');
        else {
          const active = simulation.getSnapshot().missions.find(mission => mission.id === squad.missionId);
          const target = payload.type === 'assign' ? payload.target : active?.target ?? definition.base;
          const type = payload.type === 'assign' ? payload.missionType : 'recall';
          commandResult = apply({ schemaVersion: 1, runId: definition.runId, decisionEpoch: epoch, missionVersions: { [squad.id]: squad.version }, assignments: [{ squadId: squad.id, type, target, reportIds: [] }], source: command.source, summary: 'Operator mission command' });
          commandResult = { ...commandResult, commandId: command.commandId };
        }
      } else if (payload.type === 'resume_auto' && command.source !== 'human') {
        commandResult = result(definition.runId, command.commandId, 'rejected', 'Only a human may release a pin');
      } else if (payload.type === 'resume_auto') {
        const snapshot = simulation.getSnapshot();
        const squad = snapshot.squads.find(item => item.id === payload.squadId);
        if (!squad) commandResult = result(definition.runId, command.commandId, 'rejected', 'Unknown squad');
        else {
          const next = structuredClone(snapshot), current = next.missions.find(mission => mission.id === squad.missionId);
          if (!current?.pinned) commandResult = result(definition.runId, command.commandId, 'rejected', 'No human-pinned mission to resume');
          else {
            current.pinned = false; current.source = 'auto'; next.squads.find(item => item.id === squad.id)!.version++; current.version++;
            if (current.type === 'recall') {
              const patrols = makeCandidates([], [], [], [{ ...squad, missionId: null }]).filter(candidate => candidate.type === 'monitor');
              const patrol = patrols[snapshot.squads.findIndex(item => item.id === squad.id) % patrols.length];
              if (patrol) { current.type = 'monitor'; current.target = patrol.target; current.progress = 0; if (current.status === 'idle') current.status = 'travelling'; }
            }
            next.revision++; simulation.setSnapshot(next); epoch++; commandResult = result(definition.runId, command.commandId, 'accepted', 'Human pin released; auto control resumed'); publish();
          }
        }
      } else commandResult = result(definition.runId, command.commandId, 'accepted', 'Command accepted');
      dedup.set(command.commandId, { body, result: structuredClone(commandResult) });
      if (dedup.size > 500) dedup.delete(dedup.keys().next().value!);
      return commandResult;
    },
  };
}
