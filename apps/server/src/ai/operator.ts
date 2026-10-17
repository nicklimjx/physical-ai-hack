import { CommandResultSchema, OperatorResponseSchema, type OperatorAction, type OperatorBatch, type OperatorInput, type OperatorResponse, type PlanningContext } from '@ember/contracts';
import type { createProviders } from './providers.js';

export async function interpretOperator(context: PlanningContext, input: OperatorInput, signal: AbortSignal, providers: ReturnType<typeof createProviders>, assertCurrent: () => void, apply?: (batch: OperatorBatch, signal: AbortSignal) => Promise<ReturnType<typeof CommandResultSchema.parse>>): Promise<OperatorResponse> {
  const respond = (text: string, commandResult: OperatorResponse['commandResult'] = null, status: OperatorResponse['status'] = 'answered') => OperatorResponseSchema.parse({ schemaVersion: 1, runId: context.runId, requestId: input.requestId, status, text, commandResult, announcements: [] });
  const { definition } = context;
  const widthM = definition.width * definition.cellSizeM, heightM = definition.height * definition.cellSizeM;
  const inBounds = (point: { x: number; y: number }) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.y >= 0 && point.x < widthM && point.y < heightM;
  const knownIds = new Set([...context.squads.map(s => s.id), ...context.drones.map(d => d.id), ...definition.regions.map(r => r.id), ...(context.observedFires ?? []).map(f => f.id)]);
  if ((input.selectedIds ?? []).some(id => !knownIds.has(id)) || (input.targetPosition && !inBounds(input.targetPosition))) return respond('The selection or map target is no longer valid. Please select it again; no actions were applied.');
  const regions = definition.regions.map(region => {
    const cells = definition.staticCells.flatMap((cell, index) => cell.regionId === region.id ? [{ x: (index % definition.width + 0.5) * definition.cellSizeM, y: (Math.floor(index / definition.width) + 0.5) * definition.cellSizeM }] : []);
    if (!cells.length) return { ...region, centroid: null, bounds: null };
    return { ...region, centroid: { x: cells.reduce((sum, p) => sum + p.x, 0) / cells.length, y: cells.reduce((sum, p) => sum + p.y, 0) / cells.length }, bounds: { minX: Math.min(...cells.map(p => p.x)) - definition.cellSizeM / 2, maxX: Math.max(...cells.map(p => p.x)) + definition.cellSizeM / 2, minY: Math.min(...cells.map(p => p.y)) - definition.cellSizeM / 2, maxY: Math.max(...cells.map(p => p.y)) + definition.cellSizeM / 2 } };
  });
  let plan;
  try {
    plan = await providers.interpret({ runId: context.runId, decisionEpoch: context.decisionEpoch, map: { widthM, heightM, cellSizeM: definition.cellSizeM, base: definition.base, regions }, weather: context.weather, squads: context.squads, drones: context.drones, missions: context.missions, pins: context.humanConstraints, observedFires: context.observedFires ?? [], reports: context.reports.slice(-32).map(report => ({ ...report, evidence: report.evidence.slice(0, 8), observationIds: report.observationIds.slice(0, 24) })), conversation: context.conversation ?? [], selection: { ids: input.selectedIds ?? [], targetPosition: input.targetPosition ?? null }, utterance: input.text }, signal);
  } catch {
    signal.throwIfAborted(); providers.failed('gpt');
    return respond('Local rules fallback: the language interpreter is unavailable. No natural-language actions were applied; existing autonomous missions continue. Please retry or use the direct group controls.', null, 'unavailable');
  }
  signal.throwIfAborted();
  if (!plan) return respond('Local rules fallback: no language model is configured. No natural-language actions were applied; direct group controls remain available.', null, 'unavailable');
  assertCurrent();
  if (plan.kind !== 'act') return respond(plan.reply);
  const actions: OperatorAction[] = [], descriptions: string[] = [];
  const groups = new Set<string>();
  try {
    for (const action of plan.actions) {
      const squad = context.squads.find(s => s.id === action.squadId);
      if (!squad || groups.has(squad.id)) throw new Error('Unknown group or conflicting instructions for one group. Which group and outcome did you intend?');
      groups.add(squad.id);
      const targets = Number(action.regionId !== null) + Number(action.fireId !== null) + Number(action.point !== null);
      if (action.type !== 'assign') {
        if (targets || action.missionType !== null) throw new Error('A group control included a conflicting destination. Should that group return, resume autonomy, or receive a new mission?');
        actions.push({ type: action.type, squadId: squad.id });
        descriptions.push(`${squad.name}: ${action.type === 'recall' ? 'recall applied; returning to Command Base and holding after refill' : action.type === 'resume_auto' ? 'human pin released; autonomous control resumed' : 'current mission kept'}`);
        continue;
      }
      if (targets !== 1 || !action.missionType) throw new Error('The destination was unclear. Which observed fire, mapped area, or monitoring point did you mean?');
      const region = regions.find(r => r.id === action.regionId);
      let fire = context.observedFires?.find(f => f.id === action.fireId);
      if (action.regionId && !region) throw new Error('That mapped area is unknown. Which known area did you mean?');
      if (action.fireId && !fire) throw new Error('That fire reference is unknown. Which observed fire did you mean?');
      let target = action.point ?? (fire ? fire.centroid : region?.centroid);
      let reportIds: string[] = [];
      let place = fire?.name ?? region?.name ?? 'the requested map point';
      if (action.missionType === 'suppress') {
        if (action.point) throw new Error('Suppression needs fresh local fire evidence, not an arbitrary point. Which observed fire did you mean?');
        if (!fire && region) {
          const fires = (context.observedFires ?? []).filter(f => f.status === 'fresh' && f.regionIds.includes(region.id));
          if (fires.length !== 1) throw new Error('That area has no unique fresh observed fire. Which fire should receive suppression?');
          fire = fires[0]!; place = fire.name;
        }
        if (!fire || fire.status !== 'fresh') throw new Error('That fire has no fresh local evidence. Should a group monitor its last observed area instead?');
        const evidence = context.reports.filter(r => fire!.reportIds.includes(r.id) && r.classification === 'active_fire').flatMap(report => context.observations.filter(o => fire!.observationIds.includes(o.id) && report.observationIds.includes(o.id) && o.observed.burning && o.sampledAtSimSeconds <= report.validUntilSimSeconds && report.validUntilSimSeconds >= Math.max(...context.observations.map(item => item.sampledAtSimSeconds), 0)).map(observation => ({ report, observation }))).sort((a, b) => Math.hypot(a.observation.position.x - fire!.centroid.x, a.observation.position.y - fire!.centroid.y) - Math.hypot(b.observation.position.x - fire!.centroid.x, b.observation.position.y - fire!.centroid.y));
        if (!evidence.length) throw new Error('The retained report no longer supports suppression. Should the group revisit the observed area?');
        target = evidence[0]!.observation.position; reportIds = [evidence[0]!.report.id];
      }
      if (!target || !inBounds(target)) throw new Error('The requested destination is outside the known map. Where inside the mapped area should the group monitor?');
      actions.push({ type: 'assign', squadId: squad.id, missionType: action.missionType, target, reportIds });
      descriptions.push(`${squad.name}: ${action.missionType === 'suppress' ? 'suppression' : 'monitoring'} assigned at ${place}`);
    }
  } catch (error) { return respond(`No actions applied. ${error instanceof Error ? error.message : 'Please clarify the intended groups and destinations.'}`); }
  if (!apply) return respond('The operator scheduler is unavailable; no actions were applied.', null, 'unavailable');
  assertCurrent();
  const result = CommandResultSchema.parse(await apply({ schemaVersion: 1, runId: context.runId, requestId: input.requestId, decisionEpoch: context.decisionEpoch, missionVersions: context.missionVersions, actions }, signal));
  signal.throwIfAborted();
  if (result.runId !== context.runId || result.commandId !== input.requestId) throw new Error('Mismatched operator batch result');
  return result.status === 'accepted' ? respond(`${descriptions.join('; ')}. These are applied orders, not confirmed arrival or completion.`, result) : respond(`No actions applied: ${result.message}`, result);
}
