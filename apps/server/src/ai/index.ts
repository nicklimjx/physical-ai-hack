import type { IncidentSummary, MissionProposal, Observation, OperatorInput, OperatorResponse, PlanningContext, RiskReport } from '@ember/contracts';

export class ModuleUnavailableError extends Error {
  constructor(module: string) {
    super(`${module} is unavailable in preview`);
    this.name = 'ModuleUnavailableError';
  }
}

export interface AssessmentModule {
  assess(observations: readonly Observation[], signal: AbortSignal): Promise<readonly RiskReport[]>;
}

export interface OrchestratorModule {
  propose(context: PlanningContext, signal: AbortSignal): Promise<MissionProposal>;
  respond(context: PlanningContext, input: OperatorInput, signal: AbortSignal): Promise<OperatorResponse>;
}

export const assessmentUnavailable: AssessmentModule = {
  async assess(_observations, signal) {
    if (signal.aborted) throw signal.reason;
    throw new ModuleUnavailableError('Assessment');
  },
};

export const orchestratorUnavailable: OrchestratorModule = {
  async propose(_context, signal) {
    if (signal.aborted) throw signal.reason;
    throw new ModuleUnavailableError('Orchestrator');
  },
  async respond(_context, _input, signal) {
    if (signal.aborted) throw signal.reason;
    throw new ModuleUnavailableError('Orchestrator');
  },
};

export type PlanningInputs = { context: PlanningContext; incidents: readonly IncidentSummary[] };
