import type { CommandResult, MissionProposal, Observation, WorldDefinition, WorldSnapshot } from '@ember/contracts';

export interface SimulationModule {
  create(definition: WorldDefinition): WorldSnapshot;
  step(snapshot: WorldSnapshot, deltaSimSeconds: number): WorldSnapshot;
  applyProposal(snapshot: WorldSnapshot, proposal: MissionProposal): CommandResult;
  getSnapshot(): WorldSnapshot;
  getLocalObservations(droneId: string): readonly Observation[];
}

export class SimulationUnavailableError extends Error {
  constructor() {
    super('Simulation is unavailable in preview');
    this.name = 'SimulationUnavailableError';
  }
}

export const simulationUnavailable: SimulationModule = {
  create() { throw new SimulationUnavailableError(); },
  step() { throw new SimulationUnavailableError(); },
  applyProposal() { throw new SimulationUnavailableError(); },
  getSnapshot() { throw new SimulationUnavailableError(); },
  getLocalObservations() { throw new SimulationUnavailableError(); },
};
