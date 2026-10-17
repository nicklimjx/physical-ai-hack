import {
  WorldDefinitionSchema,
  WorldSnapshotSchema,
  type CommandResult,
  type MissionProposal,
  type Observation,
  type WorldDefinition,
  type WorldSnapshot,
} from '@ember/contracts';

export const CRUISE_SPEED_MPS = 60;

export interface SimulationModule {
  create(definition: WorldDefinition): WorldSnapshot;
  step(snapshot: WorldSnapshot, deltaSimSeconds: number): WorldSnapshot;
  setSnapshot(snapshot: WorldSnapshot): void;
  applyProposal(snapshot: WorldSnapshot, proposal: MissionProposal): CommandResult;
  getSnapshot(): WorldSnapshot;
  getLocalObservations(droneId: string): readonly Observation[];
}

const copy = <T>(value: T): T => structuredClone(value);
let runSequence = 0;
export function createDefinition(runId = `run-${++runSequence}`, seed = 412): WorldDefinition {
  const width = 96;
  const height = 80;
  const cellSizeM = 25;
  const base = { x: 400, y: 300 };
  const noise = (x: number, y: number) => Math.sin(x * 0.31 + y * 0.17 + seed) * Math.cos(y * 0.27 - x * 0.13);
  const communities = [{ x: 73, y: 58, rx: 12, ry: 9 }, { x: 74, y: 23, rx: 11, ry: 8 }, { x: 44, y: 48, rx: 10, ry: 8 }];
  const regions = [
    { id: 'forest', name: 'Pine Ridge', kind: 'forest' as const },
    { id: 'community-1', name: 'Community 1', kind: 'neighborhood' as const },
    { id: 'community-2', name: 'Community 2', kind: 'neighborhood' as const },
    { id: 'community-3', name: 'Community 3', kind: 'neighborhood' as const },
    { id: 'base', name: 'Command Base', kind: 'base' as const },
    { id: 'lake', name: 'Lake', kind: 'water' as const },
  ];
  const staticCells = Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const inBase = ((x + 0.5 - base.x / cellSizeM) / 5) ** 2 + ((y + 0.5 - base.y / cellSizeM) / 4) ** 2 < 1;
    const lake = ((x - 53 - Math.sin(y / 4) * 2) / 8) ** 2 + ((y - 31) / 6) ** 2 < 1;
    const stream = y > 30 && Math.abs(x - (53 + Math.sin(y / 7) * 4 + (y - 30) * 0.17)) < 0.8;
    const community = communities.findIndex(c => ((x - c.x + Math.sin(y / 3) * 1.5) / c.rx) ** 2 + ((y - c.y + Math.cos(x / 4) * 1.2) / c.ry) ** 2 < 0.85 + noise(x, y) * 0.18);
    const regionId = inBase ? 'base' : lake || stream ? 'lake' : community >= 0 ? `community-${community + 1}` : 'forest';
    const eastRoad = 12 + (x - 16) * 0.18 + Math.sin((x - 16) / 8) * 3;
    const northRoad = 16 + (y - 12) * 0.81 + Math.sin((y - 12) / 9) * 3;
    const road = x >= 15 && Math.abs(y - eastRoad) < 0.7 || y >= 11 && Math.abs(x - northRoad) < 0.7 || community >= 0 && Math.abs(y - communities[community]!.y - Math.sin(x / 4) * 2) < 0.65;
    const settlement = community >= 0 && Math.sin(x * 1.73 + y * 0.91) > 0.35 && noise(x, y) > -0.5;
    const clearing = Math.sin(x / 6 + Math.sin(y / 8)) + Math.cos(y / 7 - x / 14) > 0.75;
    const fuelClass = regionId === 'lake' ? 'water' : inBase || road ? 'road' : community >= 0 ? settlement ? 'wood_building' : 'grass' : clearing ? 'grass' : 'forest';
    const hill = 35 + 65 * Math.sin(x / 17) ** 2 + 45 * Math.cos(y / 15 + x / 26) ** 2 + noise(x, y) * 7;
    return {
      elevationM: regionId === 'base' ? 38 : regionId === 'lake' ? 30 : Math.round(hill), fuelClass,
      initialFuel: fuelClass === 'water' || fuelClass === 'road' ? 0 : fuelClass === 'wood_building' ? 0.9 : fuelClass === 'grass' ? 0.55 : 0.8,
      regionId,
    };
  });
  return WorldDefinitionSchema.parse({
    schemaVersion: 1, runId, mapId: 'woodland-edge', seed, width, height, cellSizeM,
    staticCells, regions, base,
  });
}

export class SimulationUnavailableError extends Error {
  constructor() { super('Simulation is unavailable in preview'); this.name = 'SimulationUnavailableError'; }
}
export const simulationUnavailable: SimulationModule = {
  create() { throw new SimulationUnavailableError(); }, step() { throw new SimulationUnavailableError(); },
  setSnapshot() { throw new SimulationUnavailableError(); }, applyProposal() { throw new SimulationUnavailableError(); },
  getSnapshot() { throw new SimulationUnavailableError(); }, getLocalObservations() { throw new SimulationUnavailableError(); },
};

export function launchPosition(definition: WorldDefinition, squadIndex: number, droneIndex: number) {
  return { x: definition.base.x + (squadIndex % 4 - 1.5) * 36 + (droneIndex % 2 ? 6 : -6), y: definition.base.y - 20 - Math.floor(squadIndex / 4) * 28 + (droneIndex < 2 ? -6 : 6) };
}

export function burnablePosition(definition: WorldDefinition, fraction: { x: number; y: number }) {
  const target = { x: definition.width * definition.cellSizeM * fraction.x, y: definition.height * definition.cellSizeM * fraction.y };
  let closest = target, distance = Infinity;
  definition.staticCells.forEach((cell, index) => {
    if (cell.initialFuel <= 0 || cell.fuelClass === 'water' || cell.fuelClass === 'road') return;
    const position = { x: (index % definition.width + 0.5) * definition.cellSizeM, y: (Math.floor(index / definition.width) + 0.5) * definition.cellSizeM };
    const next = Math.hypot(position.x - target.x, position.y - target.y);
    if (next < distance) { distance = next; closest = position; }
  });
  return closest;
}

export function createSimulation(definition: WorldDefinition): SimulationModule {
  WorldDefinitionSchema.parse(definition);
  const cellIndex = (x: number, y: number) => y * definition.width + x;
  const squadIds = ['group-1', 'group-2', 'group-3', 'group-4', 'group-5', 'group-6', 'group-7', 'group-8'];
  const squadNames = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];
  const regionTargets = [{ x: 0.76, y: 0.73 }, { x: 0.77, y: 0.29 }, { x: 0.46, y: 0.60 }, { x: 0.28, y: 0.24 }, { x: 0.25, y: 0.68 }, { x: 0.61, y: 0.86 }, { x: 0.53, y: 0.32 }, { x: 0.18, y: 0.45 }].map(target => burnablePosition(definition, target));
  const initial = WorldSnapshotSchema.parse({
    schemaVersion: 1, runId: definition.runId, revision: 0, simSeconds: 0,
    weather: { windMps: { x: 2.4, y: -0.8 }, temperatureC: 29, humidity: 0.24 },
    settings: { paused: false, speed: 1, spreadMultiplier: 1 },
    dynamicCells: definition.staticCells.map(cell => ({ heat: 0, fuel: cell.initialFuel, burnState: 'unburned', protection: 0 })),
    drones: Array.from({ length: 32 }, (_, index) => ({
      id: `drone-${index + 1}`, squadId: squadIds[Math.floor(index / 4)]!,
      position: launchPosition(definition, Math.floor(index / 4), index % 4),
      battery: 1, payload: 1, status: 'ready',
    })),
    squads: squadIds.map((id, index) => ({
      id, name: squadNames[index]!, droneIds: Array.from({ length: 4 }, (_, j) => `drone-${index * 4 + j + 1}`),
      missionId: `patrol-${definition.runId}-${id}`, version: 1, payload: 1,
    })),
    missions: squadIds.map((squadId, index) => ({
      id: `patrol-${definition.runId}-${squadId}`, squadId, type: 'monitor', status: 'travelling',
      target: regionTargets[index]!,  source: 'auto', pinned: false, progress: 0, version: 1,
    })),
    metrics: { burningCells: 0, protectedCells: 0, threatenedStructures: 0 }, events: [],
  });
  let world = initial;
  const setSnapshot = (snapshot: WorldSnapshot) => {
    if (snapshot.runId !== definition.runId) throw new Error('Snapshot run mismatch');
    world = WorldSnapshotSchema.parse(copy(snapshot));
  };

  const step = (snapshot: WorldSnapshot, deltaSeconds: number): WorldSnapshot => {
    setSnapshot(snapshot);
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error('Invalid step duration');
    const next = world;
    if (!next.settings.paused && deltaSeconds > 0) {
      const dt = deltaSeconds * next.settings.speed;
      const oldHeat = next.dynamicCells.map(cell => cell.heat);
      const oldProtection = next.dynamicCells.map(cell => cell.protection);
      next.simSeconds += dt;
      for (let y = 0; y < definition.height; y++) for (let x = 0; x < definition.width; x++) {
        const index = cellIndex(x, y);
        const cell = next.dynamicCells[index]!;
        const staticCell = definition.staticCells[index]!;
        cell.protection = Math.max(0, cell.protection - dt / 900);
        if (cell.burnState === 'burning') {
          cell.fuel = Math.max(0, cell.fuel - dt * 0.012);
          cell.heat = Math.min(1, Math.max(0, cell.heat - dt * 0.035) + dt * 0.045);
          if (cell.fuel === 0 || cell.heat === 0) cell.burnState = 'burned';
        }
        if (cell.burnState === 'unburned' && cell.fuel > 0 && staticCell.fuelClass !== 'water' && staticCell.fuelClass !== 'road') {
          const neighbors = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;
          let incoming = 0;
          for (const [dx, dy] of neighbors) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= definition.width || ny < 0 || ny >= definition.height) continue;
            const windMagnitude = Math.hypot(next.weather.windMps.x, next.weather.windMps.y);
            const downwind = windMagnitude === 0 ? 0 : Math.max(0,
              (-dx * next.weather.windMps.x - dy * next.weather.windMps.y) / windMagnitude);
            const weight = 0.75 + downwind * 0.25;
            const sourceIndex = cellIndex(nx, ny);
            const sourceClass = definition.staticCells[sourceIndex]!.fuelClass;
            const sourceFactor = sourceClass === 'wood_building' ? 1.25 : sourceClass === 'forest' ? 1.1 : 0.9;
            const targetFactor = staticCell.fuelClass === 'wood_building' ? 1.25 : staticCell.fuelClass === 'forest' ? 1.1 : 0.9;
            incoming = Math.max(incoming, oldHeat[sourceIndex]! * weight * (1 - oldProtection[sourceIndex]!) * sourceFactor * targetFactor);
          }
          const protectionFactor = 1 - cell.protection;
          cell.heat = Math.min(1, cell.heat + Math.max(0, incoming - 0.38) * dt * 0.18
            * next.settings.spreadMultiplier * protectionFactor);
          if (cell.heat >= 0.42) cell.burnState = 'burning';
        }
        if (staticCell.fuelClass === 'water' || staticCell.fuelClass === 'road') {
          cell.heat = 0;
          cell.burnState = 'unburned';
        }
      }
      for (const mission of next.missions) {
        const squad = next.squads.find(item => item.id === mission.squadId)!;
        const drones = next.drones.filter(drone => drone.squadId === squad.id);
        if (mission.status === 'idle' || mission.type === 'hold') continue;
        const pad = (index: number) => launchPosition(definition, squadIds.indexOf(squad.id), index);
        const atBase = () => drones.every((drone, index) => Math.hypot(drone.position.x - pad(index).x, drone.position.y - pad(index).y) <= 2);
        const needsResources = () => squad.payload <= 0.05 || drones.some((drone, index) => drone.battery <= Math.max(0.15, Math.hypot(drone.position.x - pad(index).x, drone.position.y - pad(index).y) / CRUISE_SPEED_MPS * 0.0006 + 0.03));
        if (mission.type === 'recall' && mission.status !== 'refilling') mission.status = 'returning';
        if (mission.status !== 'refilling' && needsResources()) mission.status = 'returning';
        if (mission.status === 'refilling') {
          if (!atBase()) { mission.status = 'returning'; delete mission.refillStartedAtSimSeconds; continue; }
          mission.refillStartedAtSimSeconds ??= next.simSeconds;
          const complete = next.simSeconds - mission.refillStartedAtSimSeconds + 1e-9 >= 3;
          for (const drone of drones) {
            drone.status = 'ready'; drone.battery = complete ? 1 : Math.min(1, drone.battery + dt / 3);
            drone.payload = complete ? 1 : Math.min(1, drone.payload + dt / 3);
          }
          squad.payload = Math.min(...drones.map(drone => drone.payload));
          if (complete) {
            delete mission.refillStartedAtSimSeconds;
            if (mission.type === 'recall') { mission.status = 'idle'; if (!mission.pinned) squad.missionId = null; }
            else mission.status = 'travelling';
          }
          continue;
        }
        if (mission.status === 'returning') {
          for (const [index, drone] of drones.entries()) {
            const target = pad(index), dx = target.x - drone.position.x, dy = target.y - drone.position.y;
            const distance = Math.hypot(dx, dy);
            if (distance > 2) {
              const move = Math.min(distance, CRUISE_SPEED_MPS * dt);
              drone.position.x += dx / distance * move; drone.position.y += dy / distance * move;
              drone.battery = Math.max(0, drone.battery - move / CRUISE_SPEED_MPS * 0.0006);
            }
            drone.status = 'returning';
          }
          if (atBase()) { mission.status = 'refilling'; mission.refillStartedAtSimSeconds = next.simSeconds; }
          continue;
        }
        let arrived = true;
        for (const drone of drones) {
          const local = drones.indexOf(drone);
          const offsets = [[-6, -6], [6, -6], [-6, 6], [6, 6]] as const;
          const [ox, oy] = offsets[local % offsets.length]!;
          const target = { x: mission.target.x + ox, y: mission.target.y + oy };
          const dx = target.x - drone.position.x, dy = target.y - drone.position.y;
          const distance = Math.hypot(dx, dy);
          if (distance > 2) {
            arrived = false;
            const move = Math.min(distance, CRUISE_SPEED_MPS * dt);
            drone.position.x += dx / distance * move; drone.position.y += dy / distance * move;
            drone.battery = Math.max(0, drone.battery - dt * 0.0006); drone.status = 'travelling';
          } else drone.status = 'working';
        }
        if (arrived && mission.type === 'monitor') {
          mission.status = 'monitoring';
          for (const drone of drones) { drone.status = 'working'; drone.battery = Math.max(0, drone.battery - dt * 0.0001); }
        }
        if (arrived && mission.type === 'protect_monitor' && mission.status === 'monitoring') {
          for (const drone of drones) { drone.status = 'working'; drone.battery = Math.max(0, drone.battery - dt * 0.0001); }
        }
        if (arrived && mission.type === 'protect_monitor' && mission.status !== 'monitoring' && squad.payload > 0) {
          const cx = Math.floor(mission.target.x / definition.cellSizeM), cy = Math.floor(mission.target.y / definition.cellSizeM);
          const dose = Math.min(0.25, squad.payload);
          const strength = 0.8 * dose / 0.25;
          for (let y = Math.max(0, cy - 1); y <= Math.min(definition.height - 1, cy + 1); y++) for (let x = Math.max(0, cx - 1); x <= Math.min(definition.width - 1, cx + 1); x++) {
            const cell = next.dynamicCells[cellIndex(x, y)]!;
            if (cell.fuel > 0) cell.protection = Math.max(strength, cell.protection);
            if (cell.burnState === 'burning') { cell.heat = Math.max(0, cell.heat - strength); if (cell.heat === 0) cell.burnState = 'burned'; }
          }
          squad.payload -= dose;
          for (const drone of drones) drone.payload = squad.payload;
          mission.status = 'monitoring';
        }
        if (arrived && mission.type === 'suppress') {
          mission.status = 'working';
          const cx = Math.floor(mission.target.x / definition.cellSizeM), cy = Math.floor(mission.target.y / definition.cellSizeM);
          let burning = false;
          for (let y = Math.max(0, cy - 1); y <= Math.min(definition.height - 1, cy + 1); y++) for (let x = Math.max(0, cx - 1); x <= Math.min(definition.width - 1, cx + 1); x++) {
            const cell = next.dynamicCells[cellIndex(x, y)]!;
            if (cell.burnState !== 'burning') continue;
            burning = true;
            const dose = Math.min(0.2, squad.payload);
            const effect = 0.8 * dose / 0.2;
            cell.heat = Math.max(0, cell.heat - effect);
            if (cell.heat === 0) cell.burnState = 'burned';
            squad.payload -= dose;
          }
          for (const drone of drones) { drone.payload = squad.payload; drone.battery = Math.max(0, drone.battery - dt * 0.0001); }
          burning = next.dynamicCells.some((cell, index) => {
            const x = index % definition.width, y = Math.floor(index / definition.width);
            return Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 1 && cell.burnState === 'burning';
          });
          if (!burning) { mission.status = 'idle'; mission.progress = 1; }
        }
        if (needsResources()) mission.status = 'returning';
        else if (mission.status === 'idle' && !mission.pinned) squad.missionId = null;
      }
      next.revision++;
      next.metrics.burningCells = next.dynamicCells.filter(cell => cell.burnState === 'burning').length;
      next.metrics.protectedCells = next.dynamicCells.filter(cell => cell.protection > 0.05).length;
      next.metrics.threatenedStructures = definition.staticCells.filter((cell, index) => cell.fuelClass === 'wood_building' && next.dynamicCells[index]!.heat > 0.2).length;
    }
    world = WorldSnapshotSchema.parse(next);
    return copy(world);
  };

  return {
    create: () => copy(world), step, setSnapshot,
    applyProposal(snapshot, proposal) {
      return { schemaVersion: 1, runId: snapshot.runId, commandId: 'proposal', status: 'unavailable', reason: 'Use runtime scheduler', appliedRevision: null, missionIds: [], message: proposal.summary };
    },
    getSnapshot: () => copy(world),
    getLocalObservations(droneId) {
      const drone = world.drones.find(item => item.id === droneId);
      if (!drone) return [];
      const radius = 100, size = definition.cellSizeM, reach = Math.ceil(radius / size), cx = Math.floor(drone.position.x / size), cy = Math.floor(drone.position.y / size);
      const observations: Observation[] = [];
      for (let y = Math.max(0, cy - reach); y <= Math.min(definition.height - 1, cy + reach); y++) for (let x = Math.max(0, cx - reach); x <= Math.min(definition.width - 1, cx + reach); x++) {
        if (Math.hypot((x + 0.5) * size - drone.position.x, (y + 0.5) * size - drone.position.y) > radius) continue;
        const index = cellIndex(x, y), cell = world.dynamicCells[index]!;
        if (cell.heat <= 0.01 && cell.protection <= 0.01) continue;
        const nearbyStructures = definition.staticCells.filter((item, i) => item.fuelClass === 'wood_building'
          && Math.abs(i % definition.width - x) <= 2 && Math.abs(Math.floor(i / definition.width) - y) <= 2).length;
        observations.push({ schemaVersion: 1, runId: world.runId, id: `obs-${droneId}-${Math.floor(world.simSeconds * 10 + 1e-6)}-${index}`, sourceDroneId: droneId,
          position: { x: (x + 0.5) * size, y: (y + 0.5) * size }, sampledAtSimSeconds: world.simSeconds,
          observed: { heat: cell.heat, burning: cell.burnState === 'burning', nearbyStructures, windMps: copy(world.weather.windMps) }, footprintRadiusM: radius });
      }
      return observations;
    },
  };
}
