import { WorldResponseSchema, type WorldResponse } from './index.js';

const width = 64;
const height = 64;
const cellSizeM = 20;
const regions = [
  { id: 'forest', name: 'Pine Ridge', kind: 'forest' as const },
  { id: 'alpha', name: 'Alpha', kind: 'neighborhood' as const },
  { id: 'bravo', name: 'Bravo', kind: 'neighborhood' as const },
  { id: 'charlie', name: 'Charlie', kind: 'neighborhood' as const },
  { id: 'base', name: 'Command Base', kind: 'base' as const },
  { id: 'lake', name: 'Lake', kind: 'water' as const },
];
const regionAt = (x: number, y: number) => {
  if (x > 44 && y > 42) return 'alpha';
  if (x > 44 && y < 20) return 'bravo';
  if (x > 27 && x < 37 && y > 30 && y < 39) return 'lake';
  if (x < 16 && y < 15) return 'base';
  if (x > 41 && y > 19 && y < 30) return 'charlie';
  return 'forest';
};
const staticCells = Array.from({ length: width * height }, (_, index) => {
  const x = index % width;
  const y = Math.floor(index / width);
  const regionId = regionAt(x, y);
  const fuelClass = regionId === 'lake' ? 'water' : regionId === 'base' ? 'road'
    : ['alpha', 'bravo', 'charlie'].includes(regionId) ? (index % 3 === 0 ? 'wood_building' : 'grass')
      : index % 7 === 0 ? 'grass' : 'forest';
  return {
    elevationM: Math.round((x + y) * 0.35), fuelClass,
    initialFuel: fuelClass === 'water' || fuelClass === 'road' ? 0 : fuelClass === 'wood_building' ? 0.9 : 0.75,
    regionId,
  };
});
const worldPoint = (x: number, y: number) => ({ x: x * cellSizeM, y: y * cellSizeM });
const base = worldPoint(10, 10);
const definition = {
  schemaVersion: 1 as const, runId: 'preview-run-001', mapId: 'woodland-edge', seed: 412,
  width, height, cellSizeM, staticCells, regions, base,
};
const baseDrones = Array.from({ length: 12 }, (_, index) => ({
  id: `drone-${index + 1}`, squadId: ['red', 'blue', 'gold'][Math.floor(index / 4)]!,
  position: worldPoint(8 + (index % 4) * 2, 8 + Math.floor(index / 4) * 2),
  battery: 0.92, payload: 0.75, status: 'ready' as const,
}));

const scenarios = [
  ['fire-detected', 'Alpha fire detected', 0.8, 'active_fire'],
  ['threat-increasing', 'Threat increasing toward Bravo', 0.62, 'high_risk'],
  ['travelling', 'Blue travelling to Bravo', 0.42, 'high_risk'],
  ['treatment', 'Treatment applied near Bravo', 0, 'watch'],
  ['human-override', 'Human override: Red stays on Alpha', 0.8, 'active_fire'],
  ['resource-shortage', 'All squads committed; reserve unavailable', 0.62, 'high_risk'],
] as const;
const fireIndex = 45 * width + 48;
const treatmentIndices = staticCells.flatMap((cell, index) => {
  const x = index % width;
  const y = Math.floor(index / width);
  const inPatch = x >= 43 && x <= 46 && y >= 17 && y <= 20;
  return inPatch && cell.fuelClass !== 'water' && cell.fuelClass !== 'road' && index !== fireIndex ? [index] : [];
});

export const previewScenarios: ReadonlyArray<{ id: string; label: string; create: () => WorldResponse }> =
  Object.freeze(scenarios.map(([id, label, heat, risk]) => Object.freeze({ id, label, create: () => {
    const dynamicCells = staticCells.map((cell, index) => ({
      heat: index === fireIndex ? heat : 0,
      fuel: cell.initialFuel,
      burnState: (index === fireIndex && heat > 0 ? 'burning' : 'unburned') as 'burning' | 'unburned' | 'burned',
      protection: id === 'treatment' && treatmentIndices.includes(index) ? 0.8 : 0,
    }));
    const mission = (squadId: string, missionId: string, type: 'protect_monitor' | 'suppress' | 'monitor', target: { x: number; y: number }, source: 'auto' | 'human', pinned: boolean) => ({
      id: missionId, squadId, type, status: 'travelling' as const, target, source, pinned, progress: 0.36, version: 1,
    });
    let missions = id === 'travelling'
      ? [mission('blue', 'mission-blue-bravo', 'protect_monitor', worldPoint(51, 17), 'auto', false)]
      : id === 'human-override'
        ? [mission('red', 'mission-red-alpha', 'suppress', worldPoint(49, 47), 'human', true)]
        : id === 'resource-shortage'
          ? [mission('red', 'mission-red-alpha', 'suppress', worldPoint(49, 47), 'auto', false), mission('blue', 'mission-blue-bravo', 'protect_monitor', worldPoint(51, 17), 'auto', false), mission('gold', 'mission-gold-charlie', 'monitor', worldPoint(50, 25), 'auto', false)]
          : [];
    const squads = ['red', 'blue', 'gold'].map((squadId, index) => {
      const active = missions.find((item) => item.squadId === squadId);
      const squadDrones = baseDrones.filter((drone) => drone.squadId === squadId);
      const payload = id === 'resource-shortage' ? 0.1 : 0.75;
      return {
        id: squadId, name: ['Red', 'Blue', 'Gold'][index]!, droneIds: squadDrones.map((drone) => drone.id),
        missionId: active?.id ?? null, version: active?.version ?? 0, payload,
      };
    });
    const drones = baseDrones.map((drone) => {
      const active = missions.find((item) => item.squadId === drone.squadId);
      const travelling = Boolean(active);
      const position = travelling ? worldPoint(25 + Number(drone.id.slice(-1)), 15 + Number(drone.id.slice(-1))) : drone.position;
      return { ...drone, position, payload: id === 'resource-shortage' ? 0.1 : drone.payload, status: travelling ? 'travelling' as const : drone.status };
    });
    const snapshot = {
      schemaVersion: 1 as const, runId: definition.runId, revision: 1, simSeconds: 28,
      weather: { windMps: { x: 2.4, y: -0.8 }, temperatureC: 29, humidity: 0.24 },
      settings: { paused: false, speed: 1, spreadMultiplier: 1 }, dynamicCells, drones, squads, missions,
      metrics: { burningCells: heat > 0 ? 1 : 0, protectedCells: dynamicCells.filter((cell) => cell.protection > 0).length, threatenedStructures: 3 },
      events: [
        { type: 'observation' as const, id: 'event-observe', atSimSeconds: 22, summary: `Scout detected heat ${heat.toFixed(2)} at Alpha forest edge.` },
        { type: 'assessment' as const, id: 'event-risk', atSimSeconds: 24, summary: label },
        { type: 'mission' as const, id: 'event-mission', atSimSeconds: 27, summary: missions.length ? `${missions.length} squad assignment(s) shown in fixture.` : 'Preview does not show an applied mission.' },
      ],
    };
    const risks = [{
      schemaVersion: 1 as const, runId: definition.runId, id: 'risk-alpha', observationIds: ['obs-alpha-01'],
      sourceDroneIds: ['drone-1', 'drone-2'], regionId: 'alpha', classification: risk,
      summary: label, provider: 'preview' as const, confidence: null, sampledAtSimSeconds: 22, validUntilSimSeconds: 40,
      evidence: [`Observed heat ${heat.toFixed(2)}`, 'Wind toward settlement', 'Wooden structures in local footprint'],
    }];
    return WorldResponseSchema.parse({
      definition, snapshot, risks, announcements: [],
      providers: [
        { provider: 'jev', status: 'preview', label: 'Preview fixture' },
        { provider: 'gpt', status: 'preview', label: 'Preview fixture' },
        { provider: 'voice', status: 'unavailable', label: 'Not connected' },
      ], preview: true,
    });
  } })));

export function createPreviewWorld(scenarioId = 'fire-detected'): WorldResponse {
  return (previewScenarios.find((scenario) => scenario.id === scenarioId) ?? previewScenarios[0]!).create();
}
