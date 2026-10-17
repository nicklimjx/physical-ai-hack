import { randomUUID } from 'node:crypto';
import { AnnouncementSchema, CommandResultSchema, MissionProposalSchema, ObservationSchema, OperatorInputSchema, OperatorResponseSchema, PlanningContextSchema, RiskReportSchema,
  type Announcement, type CommandEnvelope, type CommandResult, type IncidentSummary, type MissionProposal, type Observation, type OperatorBatch, type OperatorInput, type OperatorResponse, type PlanningContext, type RiskReport, type WorldDefinition } from '@ember/contracts';
import { configFromEnvironment, createProviders, type ProviderConfig } from './providers.js';
import { interpretOperator } from './operator.js';
import { latestQueue } from './latest.js';
import { eligibleCandidates, fuseIncidents, groupObservations, observedTime, rulesSelection } from './policy.js';
export { fuseIncidents } from './policy.js';
export type { ProviderConfig } from './providers.js';

export class ModuleUnavailableError extends Error {
  constructor(module: string) { super(`${module} is unavailable in preview`); this.name = 'ModuleUnavailableError'; }
}
export interface AssessmentModule { assess(observations: readonly Observation[], signal: AbortSignal): Promise<readonly RiskReport[]> }
export interface OrchestratorModule {
  propose(context: PlanningContext, signal: AbortSignal): Promise<MissionProposal>;
  respond(context: PlanningContext, input: OperatorInput, signal: AbortSignal): Promise<OperatorResponse>;
}
export type PlanningInputs = { context: PlanningContext; incidents: readonly IncidentSummary[] };
export interface IntelligenceOptions {
  definition: WorldDefinition | (() => WorldDefinition);
  providers?: ProviderConfig;
  /** Read current authority facts, not a captured snapshot. Scheduler still revalidates atomically. */
  getCurrentContext?: () => PlanningContext;
  /** The only execution seam. Must validate/apply the whole batch atomically and deduplicate commandId. */
  approveProposal?: (proposal: MissionProposal, commandId: string, signal: AbortSignal) => Promise<CommandResult>;
  applyOperatorCommand?: (command: CommandEnvelope, signal: AbortSignal) => Promise<CommandResult>;
  applyOperatorBatch?: (batch: OperatorBatch, signal: AbortSignal) => Promise<CommandResult>;
}
function sameAuthority(a: PlanningContext, b: PlanningContext, squads: string[]) {
  return a.runId === b.runId && a.decisionEpoch === b.decisionEpoch && squads.every(id => a.missionVersions[id] === b.missionVersions[id]);
}
export function createIntelligence(options: IntelligenceOptions) {
  const providers = createProviders(options.providers ?? configFromEnvironment());
  let latest: PlanningContext | undefined;
  let generation = 0;
  const definition = () => typeof options.definition === 'function' ? options.definition() : options.definition;
  const current = () => options.getCurrentContext?.() ?? latest;
  function assertCurrent(context: PlanningContext, squadIds: string[], token: number) {
    const live = current();
    if (token !== generation || !live || !sameAuthority(context, live, squadIds) || definition().runId !== context.runId) throw new Error('Stale intelligence result discarded');
  }
  const assessments = latestQueue(async (observations: Observation[], signal) => {
    const def = structuredClone(definition()), token = generation;
    const reports: RiskReport[] = [];
    for (const [regionId, group] of groupObservations(observations, def)) {
      signal.throwIfAborted();
      let classification: RiskReport['classification'] = group.some(o => o.observed.burning) ? 'active_fire' : group.some(o => o.observed.nearbyStructures > 0 && o.observed.heat >= 0.35) ? 'high_risk' : group.some(o => o.observed.heat >= 0.2) ? 'watch' : 'no_issue';
      let provider: RiskReport['provider'] = 'rules', confidence: number | null = null;
      try {
        const result = await providers.assess({ regionId, observations: group }, signal);
        if (result) { classification = result.choice; confidence = result.confidence; provider = 'jev'; }
      } catch { signal.throwIfAborted(); providers.failed('jev'); }
      const sampled = Math.max(...group.map(o => o.sampledAtSimSeconds));
      reports.push(RiskReportSchema.parse({ schemaVersion: 1, runId: def.runId, id: `risk:${randomUUID()}`, observationIds: group.map(o => o.id), sourceDroneIds: [...new Set(group.map(o => o.sourceDroneId))], regionId, classification,
        summary: `${regionId}: ${classification} (${provider === 'jev' ? 'JEV' : 'rules fallback'})`, provider, confidence, sampledAtSimSeconds: sampled, validUntilSimSeconds: sampled + 15,
        evidence: group.map(o => `${o.id}: heat ${o.observed.heat.toFixed(2)}, burning ${o.observed.burning}, nearby structures ${o.observed.nearbyStructures}`),
      }));
    }
    signal.throwIfAborted();
    if (token !== generation || definition().runId !== def.runId) throw new Error('Stale assessment discarded');
    return reports;
  });
  const approved = new Map<string, { signature: string; result: CommandResult; announcements: Announcement[] }>();
  const cooldowns = new Map<string, number>();
  async function approve(proposalRaw: MissionProposal, commandId: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const proposal = MissionProposalSchema.parse(proposalRaw), context = current(), token = generation;
    const signature = JSON.stringify(proposal);
    const cached = approved.get(commandId);
    if (cached) {
      if (cached.signature !== signature || cached.result.runId !== context?.runId) throw new Error('Command ID reused with different proposal or run');
      return structuredClone({ result: cached.result, announcements: [] as Announcement[] });
    }
    if (!context) throw new Error('No current planning context');
    assertCurrent({ ...context, runId: proposal.runId, decisionEpoch: proposal.decisionEpoch, missionVersions: proposal.missionVersions }, proposal.assignments.map(a => a.squadId), token);
    const candidates = eligibleCandidates(context, proposal.source === 'human');
    const assigned = new Set<string>();
    for (const a of proposal.assignments) {
      if (assigned.has(a.squadId) || !candidates.some(c => JSON.stringify(c) === JSON.stringify(a))) throw new Error('Proposal is no longer feasible');
      assigned.add(a.squadId);
    }
    if (!options.approveProposal) throw new ModuleUnavailableError('Scheduler approval');
    const result = CommandResultSchema.parse(await options.approveProposal(proposal, commandId, signal));
    signal.throwIfAborted();
    if (result.runId !== proposal.runId || result.commandId !== commandId) throw new Error('Mismatched scheduler result');
    if (generation !== token || definition().runId !== proposal.runId || current()?.runId !== proposal.runId) throw new Error('Old-run approval discarded');
    const announcements: Announcement[] = [];
    if (result.status === 'accepted' && result.appliedRevision !== null && proposal.assignments.length && result.missionIds.length) {
      const actions = proposal.assignments.map(a => {
        const regionId = context.definition.staticCells[Math.floor(a.target.y / context.definition.cellSizeM) * context.definition.width + Math.floor(a.target.x / context.definition.cellSizeM)]?.regionId;
        const fire = context.observedFires?.find(f => f.status === 'fresh' && a.reportIds.some(id => f.reportIds.includes(id)) && a.target.x >= f.boundary[0]!.x && a.target.x <= f.boundary[2]!.x && a.target.y >= f.boundary[0]!.y && a.target.y <= f.boundary[2]!.y);
        const region = context.definition.regions.find(r => r.id === regionId)?.name ?? 'mapped target';
        const place = fire ? `${fire.name} in ${region}` : region;
        const name = context.squads.find(s => s.id === a.squadId)?.name ?? a.squadId;
        return `${name} ${a.type === 'suppress' ? `responding to observed fire at ${place}` : `${a.type.replace('_', ' ')} at ${place}`}`;
      });
      const now = Date.now();
      announcements.push(AnnouncementSchema.parse({ schemaVersion: 1, runId: proposal.runId, id: `announcement:${randomUUID()}`, priority: proposal.source === 'human' ? 'critical' : 'important', text: `${actions.join('; ')}. Assigned; arrival and completion not yet confirmed.`, createdAt: now, expiresAt: now + 15_000, missionIds: result.missionIds, reportIds: [...new Set(proposal.assignments.flatMap(a => a.reportIds))] }));
      for (const a of proposal.assignments) cooldowns.set(a.squadId, observedTime(context));
    }
    approved.set(commandId, { signature, result, announcements });
    if (approved.size > 100) approved.delete(approved.keys().next().value!);
    return { result, announcements };
  }
  type Job = { context: PlanningContext; token: number };
  const plans = latestQueue<Job, MissionProposal>(async ({ context, token }, signal) => {
    signal.throwIfAborted();
    const candidates = eligibleCandidates(context, false).filter(a => ['suppress', 'hold', 'recall'].includes(a.type) && observedTime(context) - (cooldowns.get(a.squadId) ?? -Infinity) >= 15);
    const choices = [{ id: 'keep_current', assignment: null }, ...candidates.map((assignment, i) => ({ id: `candidate:${i}`, assignment }))];
    let indices = rulesSelection(context, candidates), label = 'rules fallback';
    try {
      const selection = await providers.select({ runId: context.runId, decisionEpoch: context.decisionEpoch, weather: context.weather, incidents: context.incidents, observedFires: context.observedFires ?? [], reports: context.reports, squads: context.squads, drones: context.drones, missions: context.missions, humanConstraints: context.humanConstraints, knownRegions: context.definition.regions, choices }, signal);
      if (selection) {
        if (selection.control !== 'none') throw new Error('Invalid autonomous control');
        const ids = selection.candidateIds.filter(id => id !== 'keep_current');
        if (new Set(ids).size !== ids.length) throw new Error('Duplicate model choices');
        indices = ids.map(id => { const index = choices.findIndex(c => c.id === id); if (index <= 0) throw new Error('Unknown model candidate'); return index - 1; });
        if (new Set(indices.map(i => candidates[i].squadId)).size !== indices.length) throw new Error('Duplicate squad allocation');
        label = 'GPT';
      }
    } catch { signal.throwIfAborted(); providers.failed('gpt'); indices = rulesSelection(context, candidates); }
    const assignments = indices.map(i => candidates[i]);
    assertCurrent(context, assignments.map(a => a.squadId), token);
    return MissionProposalSchema.parse({ schemaVersion: 1, runId: context.runId, decisionEpoch: context.decisionEpoch, missionVersions: context.missionVersions, assignments, source: 'auto', summary: `${label}: ${assignments.length ? `${assignments.length} feasible assignment(s) proposed; awaiting scheduler` : 'keep_current; no mission change'}` });
  });
  function prepare(raw: PlanningContext) {
    const context = PlanningContextSchema.parse(raw);
    if (latest && latest.runId !== context.runId) { invalidate(); }
    latest = structuredClone(context);
    return context;
  }
  function invalidate() { generation++; assessments.cancel(); plans.cancel(); latest = undefined; approved.clear(); cooldowns.clear(); }
  const assessment: AssessmentModule = {
    assess(observations, signal) {
      signal.throwIfAborted();
      if (observations.length > 256) return Promise.reject(new Error('Observation batch exceeds demo budget'));
      const parsed = observations.map(o => ObservationSchema.parse(o));
      if (parsed.some(o => o.runId !== definition().runId)) return Promise.reject(new Error('Observation run mismatch'));
      return assessments.submit(parsed, signal);
    },
  };
  const orchestrator: OrchestratorModule = {
    propose(raw, signal) { return plans.submit({ context: prepare(raw), token: generation }, signal) as Promise<MissionProposal>; },
    async respond(raw, rawInput, signal) {
      const input = OperatorInputSchema.parse(rawInput), context = prepare(raw);
      if (input.runId !== context.runId) throw new Error('Operator input run mismatch');
      const token = generation;
      const response = await interpretOperator(context, input, signal, providers, () => assertCurrent(context, context.squads.map(s => s.id), token), options.applyOperatorBatch);
      if (token !== generation || definition().runId !== context.runId) throw new Error('Old-run operator response discarded');
      return response;
    },
  };
  return { assessment, orchestrator, approve, invalidate, dispose: invalidate, status: providers.status, metrics: providers.metrics, fuseIncidents };
}
export const assessmentUnavailable: AssessmentModule = { async assess(_observations, signal) { signal.throwIfAborted(); throw new ModuleUnavailableError('Assessment'); } };
export const orchestratorUnavailable: OrchestratorModule = {
  async propose(_context, signal) { signal.throwIfAborted(); throw new ModuleUnavailableError('Orchestrator'); },
  async respond(_context, _input, signal) { signal.throwIfAborted(); throw new ModuleUnavailableError('Orchestrator'); },
};
