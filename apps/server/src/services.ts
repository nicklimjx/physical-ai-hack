import { AnnouncementSchema, type Announcement, type CommandEnvelope, type CommandResult, type MissionProposal, type OperatorInput, type OperatorResponse, type PlanningContext, type ProviderState, type WorldResponse, type WorldStreamEvent } from '@ember/contracts';

// Feature adapters implement these hooks; composition does not own simulation or planning.
export interface RuntimeHooks {
  getWorld(): WorldResponse;
  subscribe?(listener: (event: WorldStreamEvent) => void): () => void;
  applyCommand?(command: CommandEnvelope): CommandResult;
  applyProposal?(proposal: MissionProposal): CommandResult;
  getPlanningContext?(): PlanningContext;
}

export interface IntelligenceLifecycle {
  start(): void;
  stop(): void;
  requestReplan(): void;
  getStatus(): readonly ProviderState[];
  submitOperatorInput(input: OperatorInput, signal: AbortSignal): Promise<OperatorResponse>;
}

export interface VoiceRouteAdapter {
  transcriptionToken(signal: AbortSignal): Promise<{ token: string; expiresAt?: number }>;
  audio(announcementId: string, signal: AbortSignal): Promise<{ audio: Uint8Array; contentType: string }>;
}

export interface RouteServices {
  submitOperatorInput?(input: OperatorInput, signal: AbortSignal): Promise<OperatorResponse>;
  voice?: VoiceRouteAdapter;
  announcements?: ReturnType<typeof createAnnouncementStore>;
}

export function createAnnouncementStore(getWorld: () => WorldResponse) {
  const approved = new Map<string, Announcement>();
  const missionVersions = new Map<string, number[]>();
  let runId = getWorld().snapshot.runId;
  const prune = () => {
    const world = getWorld();
    if (runId !== world.snapshot.runId) {
      approved.clear();
      missionVersions.clear();
      runId = world.snapshot.runId;
    }
    for (const [id, item] of approved) {
      if (item.expiresAt <= Date.now() || item.missionIds.some((missionId, index) => !world.snapshot.missions.some((mission) => mission.id === missionId && mission.version === missionVersions.get(id)?.[index])) || item.reportIds.some((reportId) => !world.risks.some((report) => report.id === reportId))) {
        approved.delete(id);
        missionVersions.delete(id);
      }
    }
    return world;
  };
  return {
    approve(value: Announcement): Announcement | null {
      const item = AnnouncementSchema.parse(value);
      const world = prune();
      if (item.runId !== world.snapshot.runId || item.expiresAt <= Date.now() || item.createdAt > Date.now()) return null;
      if (item.missionIds.some((id) => !world.snapshot.missions.some((mission) => mission.id === id)) || item.reportIds.some((id) => !world.risks.some((report) => report.id === id))) return null;
      if (approved.has(item.id)) return null;
      approved.set(item.id, structuredClone(item));
      missionVersions.set(item.id, item.missionIds.map((id) => world.snapshot.missions.find((mission) => mission.id === id)!.version));
      while (approved.size > 64) {
        const oldest = approved.keys().next().value!;
        approved.delete(oldest);
        missionVersions.delete(oldest);
      }
      return structuredClone(item);
    },
    getCurrent(): { runId: string; announcements: readonly Announcement[] } {
      prune();
      return { runId, announcements: structuredClone([...approved.values()]) };
    },
    resolve(id: string): Announcement | null {
      prune();
      const item = approved.get(id);
      return item ? structuredClone(item) : null;
    },
    clear() { approved.clear(); missionVersions.clear(); }
  };
}
