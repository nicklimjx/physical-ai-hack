import { ObservedFireSchema, type ObservedFire, type Observation, type RiskReport, type WorldDefinition } from '@ember/contracts';

export function createObservedFireTracker() {
  let runId = '', sequence = 0;
  const retained = new Map<string, { fire: ObservedFire; cells: Map<string, Observation> }>();
  const key = (point: { x: number; y: number }) => `${point.x}:${point.y}`;
  return {
    update(definition: WorldDefinition, observations: readonly Observation[], reports: readonly RiskReport[], now: number): ObservedFire[] {
      if (runId !== definition.runId) { runId = definition.runId; sequence = 0; retained.clear(); }
      const latest = new Map<string, Observation>();
      for (const observation of observations) {
        if (observation.runId !== runId || observation.sampledAtSimSeconds > now) continue;
        const previous = latest.get(key(observation.position));
        if (!previous || previous.sampledAtSimSeconds < observation.sampledAtSimSeconds) latest.set(key(observation.position), observation);
      }
      const evidence = new Map<string, RiskReport[]>();
      for (const report of reports) {
        if (report.runId !== runId || report.classification !== 'active_fire' || report.sampledAtSimSeconds > now) continue;
        for (const id of report.observationIds) { const items = evidence.get(id) ?? []; items.push(report); evidence.set(id, items); }
      }
      const pending = new Map<string, Observation>();
      for (const observation of observations) {
        if (observation.runId !== runId || !evidence.has(observation.id) || !observation.observed.burning || observation.sampledAtSimSeconds > now || now - observation.sampledAtSimSeconds > 15 || !latest.get(key(observation.position))?.observed.burning) continue;
        const previous = pending.get(key(observation.position));
        if (!previous || previous.sampledAtSimSeconds < observation.sampledAtSimSeconds) pending.set(key(observation.position), observation);
      }
      const size = definition.cellSizeM;
      while (pending.size) {
        const first = pending.values().next().value!;
        const cluster = [first]; pending.delete(key(first.position));
        for (let i = 0; i < cluster.length; i++) {
          const point = cluster[i]!.position;
          for (const [id, observation] of pending) {
            if (Math.abs(point.x - observation.position.x) <= size * 1.01 && Math.abs(point.y - observation.position.y) <= size * 1.01) {
              cluster.push(observation); pending.delete(id);
            }
          }
        }
        const centroid = { x: cluster.reduce((sum, o) => sum + o.position.x, 0) / cluster.length, y: cluster.reduce((sum, o) => sum + o.position.y, 0) / cluster.length };
        const matches = [...retained.values()].filter(item => cluster.some(o => item.cells.has(key(o.position))) || Math.hypot(item.fire.centroid.x - centroid.x, item.fire.centroid.y - centroid.y) <= size * 1.5);
        let item = matches[0];
        if (!item) {
          if (retained.size >= 32) retained.delete(retained.keys().next().value!);
          const number = ++sequence;
          item = { fire: { schemaVersion: 1, runId, id: `fire:${runId}:${number}`, name: `Fire ${number}`, aliases: [], regionIds: [], reportIds: [], observationIds: [], sourceDroneIds: [], centroid, boundary: [centroid, centroid, centroid, centroid], lastObservedSimSeconds: first.sampledAtSimSeconds, status: 'fresh', extent: 'observed footprint, not full fire front' }, cells: new Map() };
          retained.set(item.fire.id, item);
        }
        for (const duplicate of matches.slice(1)) {
          item.fire.aliases = [...new Set([...item.fire.aliases, duplicate.fire.name, ...duplicate.fire.aliases])].slice(-64);
          for (const [id, observation] of duplicate.cells) item.cells.set(id, observation);
          item.fire.reportIds = [...new Set([...item.fire.reportIds, ...duplicate.fire.reportIds])].slice(-64);
          item.fire.observationIds = [...new Set([...item.fire.observationIds, ...duplicate.fire.observationIds])].slice(-256);
          item.fire.sourceDroneIds = [...new Set([...item.fire.sourceDroneIds, ...duplicate.fire.sourceDroneIds])];
          retained.delete(duplicate.fire.id);
        }
        for (const observation of cluster) item.cells.set(key(observation.position), observation);
        item.cells = new Map([...item.cells].sort((a, b) => a[1].sampledAtSimSeconds - b[1].sampledAtSimSeconds).slice(-256));
        item.fire.reportIds = [...new Set([...item.fire.reportIds, ...cluster.flatMap(o => evidence.get(o.id)!.map(r => r.id))])].slice(-64);
      }
      for (const item of retained.values()) {
        const cells = [...item.cells.values()];
        const points = cells.map(o => o.position);
        const minX = Math.max(0, Math.min(...points.map(p => p.x)) - size / 2), maxX = Math.min(definition.width * size, Math.max(...points.map(p => p.x)) + size / 2);
        const minY = Math.max(0, Math.min(...points.map(p => p.y)) - size / 2), maxY = Math.min(definition.height * size, Math.max(...points.map(p => p.y)) + size / 2);
        item.fire.centroid = { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
        item.fire.boundary = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
        item.fire.lastObservedSimSeconds = Math.max(...cells.map(o => o.sampledAtSimSeconds));
        item.fire.observationIds = [...new Set([...item.fire.observationIds, ...cells.map(o => o.id)])].slice(-256);
        item.fire.sourceDroneIds = [...new Set([...item.fire.sourceDroneIds, ...cells.map(o => o.sourceDroneId)])];
        item.fire.regionIds = [...new Set(points.map(p => definition.staticCells[Math.floor(p.y / size) * definition.width + Math.floor(p.x / size)]?.regionId).filter((id): id is string => !!id))];
        const stillObserved = cells.some(o => { const recent = latest.get(key(o.position)); return recent?.observed.burning && now - recent.sampledAtSimSeconds <= 15; });
        const clearedLocally = cells.every(o => { const recent = latest.get(key(o.position)); return recent && !recent.observed.burning && recent.sampledAtSimSeconds > o.sampledAtSimSeconds && now - recent.sampledAtSimSeconds <= 15; });
        item.fire.status = clearedLocally ? 'unknown' : stillObserved && now - item.fire.lastObservedSimSeconds <= 15 ? 'fresh' : 'stale';
      }
      return [...retained.values()].map(item => ObservedFireSchema.parse(structuredClone(item.fire)));
    },
  };
}
