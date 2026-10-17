import { WorldResponseSchema, type WorldResponse } from './index.js';

const width = 64;
const height = 64;
const cellSizeM = 20;
const regions = [
  { id: 'forest', name: 'Pine Ridge', kind: 'forest' as const },
  { id: 'community-1', name: 'Community 1', kind: 'neighborhood' as const },
  { id: 'community-2', name: 'Community 2', kind: 'neighborhood' as const },
  { id: 'community-3', name: 'Community 3', kind: 'neighborhood' as const },
  { id: 'base', name: 'Command Base', kind: 'base' as const },
  { id: 'lake', name: 'Lake', kind: 'water' as const },
];
const regionAt = (x: number, y: number) => {
  if (x > 44 && y > 42) return 'community-1';
  if (x > 44 && y < 20) return 'community-2';
  if (x > 27 && x < 37 && y > 30 && y < 39) return 'lake';
  if (x < 16 && y < 15) return 'base';
  if (x > 41 && y > 19 && y < 30) return 'community-3';
  return 'forest';
};
const staticCells = Array.from({ length: width * height }, (_, index) => {
  const x = index % width;
  const y = Math.floor(index / width);
  const regionId = regionAt(x, y);
  const fuelClass = regionId === 'lake' ? 'water' : regionId === 'base' ? 'road'
    : ['community-1', 'community-2', 'community-3'].includes(regionId) ? (index % 3 === 0 ? 'wood_building' : 'grass')
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
const baseDrones = Array.from({ length: 32 }, (_, index) => ({
  id: `drone-${index + 1}`, squadId: `group-${Math.floor(index / 4) + 1}`,
  position: worldPoint(8 + (index % 4) * 2, 8 + Math.floor(index / 4) * 2),
  battery: 0.92, payload: 0.75, status: 'ready' as const,
}));

const scenarios = [
  ['fire-detected', 'Fire observed near Community 1', 0.8, 'active_fire'],
  ['threat-increasing', 'Threat increasing toward Community 2', 0.62, 'high_risk'],
  ['travelling', 'Bravo suppressing an observed fire near Community 1', 0.8, 'active_fire'],
  ['human-override', 'Human override: Alpha stays on Community 1', 0.8, 'active_fire'],
  ['resource-shortage', 'All firefighter groups committed; no group available', 0.62, 'high_risk'],
] as const;
const fireIndex = 45 * width + 48;
export const previewScenarios: ReadonlyArray<{ id: string; label: string; create: () => WorldResponse }> =
  Object.freeze(scenarios.map(([id, label, heat, risk]) => Object.freeze({ id, label, create: () => {
    const dynamicCells = staticCells.map((cell, index) => ({
      heat: index === fireIndex ? heat : 0,
      fuel: cell.initialFuel,
      burnState: (index === fireIndex && heat > 0 ? 'burning' : 'unburned') as 'burning' | 'unburned' | 'burned',
      protection: 0,
    }));
    const mission = (squadId: string, missionId: string, type: 'suppress' | 'monitor', target: { x: number; y: number }, source: 'auto' | 'human', pinned: boolean) => ({
      id: missionId, squadId, type, status: 'travelling' as const, target, source, pinned, progress: 0.36, version: 1,
    });
    let missions = id === 'travelling'
      ? [mission('group-2', 'mission-group-2-community-1', 'suppress', worldPoint(48, 45), 'auto', false)]
      : id === 'human-override'
        ? [mission('group-1', 'mission-group-1-community-1', 'suppress', worldPoint(48, 45), 'human', true)]
        : id === 'resource-shortage'
          ? [mission('group-1', 'mission-group-1-community-1', 'suppress', worldPoint(48, 45), 'auto', false), mission('group-2', 'mission-group-2-community-1-reinforce', 'suppress', worldPoint(48, 45), 'auto', false), mission('group-3', 'mission-group-3-community-3', 'monitor', worldPoint(50, 25), 'auto', false)]
          : [];
    const squads = Array.from({ length: 8 }, (_, index) => `group-${index + 1}`).map((squadId, index) => {
      const active = missions.find((item) => item.squadId === squadId);
      const squadDrones = baseDrones.filter((drone) => drone.squadId === squadId);
      const payload = id === 'resource-shortage' ? 0.1 : 0.75;
      return {
        id: squadId, name: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'][index]!, droneIds: squadDrones.map((drone) => drone.id),
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
        { type: 'observation' as const, id: 'event-observe', atSimSeconds: 22, summary: `Local sensor detected heat ${heat.toFixed(2)} near Community 1.` },
        { type: 'assessment' as const, id: 'event-risk', atSimSeconds: 24, summary: label },
        { type: 'mission' as const, id: 'event-mission', atSimSeconds: 27, summary: missions.length ? `${missions.length} group assignment(s) shown in fixture.` : 'Preview does not show an applied mission.' },
      ],
    };
    const risks = [{
      schemaVersion: 1 as const, runId: definition.runId, id: 'risk-community-1', observationIds: ['obs-community-1-01'],
      sourceDroneIds: ['drone-1', 'drone-2'], regionId: 'community-1', classification: risk,
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
