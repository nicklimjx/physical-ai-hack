import { IncidentSummarySchema, RiskReportSchema, type IncidentSummary, type Observation, type PlanningContext, type RiskReport, type WorldDefinition } from '@ember/contracts';

export const riskRank = { no_issue: 0, watch: 1, high_risk: 2, active_fire: 3 };
export function observedTime(context: PlanningContext) {
  return Math.max(0, ...context.observations.map(o => o.sampledAtSimSeconds), ...context.reports.map(r => r.sampledAtSimSeconds));
}
export function fuseIncidents(reports: readonly RiskReport[], runId: string, nowSimSeconds: number): IncidentSummary[] {
  const groups = new Map<string, RiskReport[]>();
  for (const raw of reports.slice(-256)) {
    const report = RiskReportSchema.parse(raw);
    if (report.runId !== runId) continue;
    const group = groups.get(report.regionId) ?? []; group.push(report); groups.set(report.regionId, group);
  }
  return [...groups].map(([regionId, group]) => {
    const fresh = group.filter(r => r.sampledAtSimSeconds <= nowSimSeconds && r.validUntilSimSeconds >= nowSimSeconds);
    const pool = fresh.length ? fresh : group;
    const highest = [...pool].sort((a, b) => riskRank[b.classification] - riskRank[a.classification])[0];
    return IncidentSummarySchema.parse({ schemaVersion: 1, runId, id: `incident:${regionId}`, regionId,
      reportIds: pool.map(r => r.id), sourceDroneIds: [...new Set(pool.flatMap(r => r.sourceDroneIds))],
      classification: highest.classification, summary: `${regionId}: ${highest.classification}${fresh.length ? '' : ' (stale)'}`,
      stale: !fresh.length, uncertainty: new Set(pool.map(r => r.classification)).size > 1 ? 'Reports disagree; confidence is not a hazard probability.' : 'Local evidence only; unobserved areas remain unknown.',
    });
  });
}
export function groupObservations(observations: readonly Observation[], definition: WorldDefinition) {
  const groups = new Map<string, Observation[]>();
  const ids = new Set<string>();
  const byDrone = new Map<string, Observation[]>();
  for (const observation of [...observations].sort((a, b) => b.sampledAtSimSeconds - a.sampledAtSimSeconds)) {
    const items = byDrone.get(observation.sourceDroneId) ?? [];
    if (items.length < 8) items.push(observation);
    byDrone.set(observation.sourceDroneId, items);
  }
  const fair: Observation[] = [];
  for (let offset = 0; fair.length < 240; offset++) {
    let added = false;
    for (const items of byDrone.values()) if (items[offset]) { fair.push(items[offset]!); added = true; if (fair.length >= 240) break; }
    if (!added) break;
  }
  for (const o of fair) {
    if (o.runId !== definition.runId || ids.has(o.id)) continue;
    ids.add(o.id);
    const col = Math.floor(o.position.x / definition.cellSizeM), row = Math.floor(o.position.y / definition.cellSizeM);
    if (col < 0 || row < 0 || col >= definition.width || row >= definition.height) continue;
    const regionId = definition.staticCells[row * definition.width + col].regionId;
    if (!groups.has(regionId) && groups.size >= 12) continue;
    const group = groups.get(regionId) ?? [];
    // Keep only recent contributors to a regional batch.
    if (!group.length || group[0].sampledAtSimSeconds - o.sampledAtSimSeconds <= 10) group.push(o);
    groups.set(regionId, group);
  }
  return groups;
}
export function eligibleCandidates(context: PlanningContext, human: boolean) {
  const now = observedTime(context);
  const freshReports = new Set(context.reports.filter(r => r.sampledAtSimSeconds <= now && r.validUntilSimSeconds >= now).map(r => r.id));
  return context.feasibleCandidates.filter(a => {
    const squad = context.squads.find(s => s.id === a.squadId);
    if (!squad || context.missionVersions[a.squadId] === undefined) return false;
    if (context.humanConstraints.some(c => c.squadId === a.squadId && c.kind === 'pinned')) return false;
    const current = context.missions.find(m => m.squadId === a.squadId && m.id === squad.missionId);
    if (current?.pinned) return false;
    // Patrol yields to material observed fires, but active response and refill do not.
    if (!human && current && current.status !== 'idle') {
      const responseToFire = a.type === 'suppress'
        && a.reportIds.some(id => context.reports.some(r => r.id === id && freshReports.has(id) && r.classification === 'active_fire'));
      const preemptiblePatrol = current.source === 'auto' && current.type === 'monitor'
        && current.status !== 'returning' && current.status !== 'refilling';
      const safetyRecall = a.type === 'recall' && current.type !== 'recall' && current.status !== 'refilling';
      if (!safetyRecall && (!preemptiblePatrol || !responseToFire)) return false;
    }
    if (a.type === 'suppress') {
      if (squad.payload <= 0.1 || !context.drones.some(d => d.squadId === a.squadId && d.battery > 0.2 && d.payload > 0.1 && d.status !== 'returning')) return false;
      if (!a.reportIds.length || !a.reportIds.every(id => freshReports.has(id))) return false;
    }
    return a.reportIds.every(id => freshReports.has(id));
  }).slice(0, 128);
}
export function rulesSelection(context: PlanningContext, candidates: ReturnType<typeof eligibleCandidates>, text?: string) {
  const selected: number[] = [], squads = new Set<string>();
  const normalized = text?.toLowerCase().replace(/[\s_-]+/g, ' ').replace(/community\s*(\d+)/g, 'community $1').trim();
  if (normalized && /\b(status|why|what|how|report)\b/.test(normalized) && !/\b(fight|suppress|extinguish|monitor|recall|hold|send|assign)\b/.test(normalized)) return selected;
  const hasPhrase = (phrase: string) => !!normalized && (` ${normalized} `).includes(` ${phrase.toLowerCase().replace(/[\s_-]+/g, ' ').replace(/community\s*(\d+)/g, 'community $1').trim()} `);
  const namedSquads = context.squads.filter(s => hasPhrase(s.name) || hasPhrase(s.id)).map(s => s.id);
  const namedRegions = context.definition.regions.filter(r => hasPhrase(r.name) || hasPhrase(r.id)).map(r => r.id);
  const requestedType = normalized ? /\b(recall|return)\b/.test(normalized) ? 'recall' : /\bhold\b/.test(normalized) ? 'hold' : /\b(fight|suppress|extinguish)\b/.test(normalized) ? 'suppress' : /\bmonitor\b/.test(normalized) ? 'monitor' : null : null;
  // Unrecognized operator requests do not become autonomous orders.
  if (normalized && !requestedType) return selected;
  const ranked = candidates.map((a, i) => ({ a, i, reports: context.reports.filter(r => a.reportIds.includes(r.id)) })).sort((a, b) => {
    const score = (item: typeof a) => Math.max(0, ...item.reports.map(r => riskRank[r.classification])) * 10;
    return score(b) - score(a);
  });
  for (const { a, i, reports } of ranked) {
    if (squads.has(a.squadId) || (namedSquads.length && !namedSquads.includes(a.squadId))) continue;
    const reportedRegion = reports.some(r => namedRegions.includes(r.regionId));
    const staticPatrolRegion = a.type === 'monitor' && namedRegions.some(regionId => {
      const region = context.definition.regions.find(item => item.id === regionId && item.kind === 'neighborhood');
      if (!region) return false;
      const cells = context.definition.staticCells.flatMap((cell, index) => cell.regionId === regionId ? [index] : []);
      if (!cells.length) return false;
      const x = cells.reduce((sum, index) => sum + (index % context.definition.width + 0.5) * context.definition.cellSizeM, 0) / cells.length;
      const y = cells.reduce((sum, index) => sum + (Math.floor(index / context.definition.width) + 0.5) * context.definition.cellSizeM, 0) / cells.length;
      return a.target.x === x && a.target.y === y;
    });
    if (namedRegions.length && !reportedRegion && !staticPatrolRegion) continue;
    if (requestedType && a.type !== requestedType) continue;
    if (!normalized && (a.type !== 'suppress' || !reports.some(r => r.classification === 'active_fire'))) continue;
    selected.push(i); squads.add(a.squadId);
    if (normalized && !namedSquads.length) break;
  }
  return selected;
}
