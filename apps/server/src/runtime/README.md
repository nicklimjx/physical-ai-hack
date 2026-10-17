# Runtime integration API

The runtime owns the authoritative simulation snapshot and scheduler. It does not run JEV/GPT itself; callers supply validated reports/incidents when requesting planning context and submit proposals back for revalidation.

```ts
createPreviewRuntime(initial: WorldResponse): PreviewRuntime
createRuntime(initial?: WorldResponse): Runtime

interface Runtime {
  getWorld(): WorldResponse;
  subscribe(listener: (world: WorldResponse) => void): () => void;
  start(): void;
  stop(): void;
  sendCommand(command: CommandEnvelope): CommandResult;
  applyProposal(proposal: MissionProposal): CommandResult;
  getPlanningContext(input?: {
    reports?: RiskReport[];
    incidents?: IncidentSummary[];
  }): PlanningContext;
  getLocalObservations(droneId: string): readonly Observation[];
  reset(): void;
}
```

- `getWorld()` and each subscription callback receive detached snapshots. `subscribe` returns an unsubscribe function.
- `start()` runs fixed 10Hz physical stepping and independent 5Hz snapshot publication; repeated start calls do not create extra loops. `stop()` clears both timers. Assignment/command APIs remain usable while paused.
- `sendCommand()` strictly validates the command envelope and finite numeric values. Accepted commands are applied synchronously; a run-local 500-entry cache returns the original result for identical retries and rejects command-ID reuse with different content.
- `applyProposal()` validates the entire batch before mutation: run/epoch, squad versions, IDs, map bounds, report references, human pins, payload, and battery for travel plus return. Rejection never partially applies assignments. Automatic assignments cannot replace human pins. An assignment identical to the squad's current mission is treated as keep-current: mission version, pin, status, and treatment progress are preserved. Pinned squads receive no alternate automatic candidates; only a human `resume_auto` command can release a pin.
- `getPlanningContext()` takes reports/incidents from the caller. It returns shared static map/weather, current fleet state, reports/incidents, and only observations returned by local sensing footprints. The runtime samples local observations at the 10Hz simulation cadence and keeps a bounded 2,000-item run-local history with stable sample IDs, so asynchronous reports can cite observations captured before the latest context request. Reports from another run, expired/future reports, unknown regions, and reports without a retained observation reference do not become candidates. The context excludes dynamic fire cells and other hidden ground truth. `feasibleCandidates` includes suppression only at fresh, same-run active-fire reports linked to retained burning observations and passing resource checks, plus current-mission, hold, safety-recall, and known-centroid patrol choices. High-risk/watch-only reports never authorize suppression.
- `getLocalObservations(droneId)` returns only heat/protection samples inside that drone's 100m footprint. An unknown drone returns an empty list.
- `reset()` creates a fresh globally unique run ID, resets simulation state and clears report references, priority overrides, command deduplication, and old-run async decision epochs.
- Provider state is explicitly `unavailable` until adapters are connected; this runtime does not claim JEV/GPT execution.

## Shared firefighter-group missions

At run creation, every four-drone group receives a `monitor` patrol mission at a known static region target. Patrol is a temporary behavior available to every group, not a separate scout/reserve hardware class. Any unpinned patrol group can be allocated to a feasible suppression candidate grounded in actual local burning evidence. Human pins remain authoritative through return/refill and release only on explicit resume or actual suppression completion.

Observation retention is bounded by 12,000 entries, not a wall-clock duration. Dense or overlapping sensor activity can evict evidence sooner than expected; a suppression candidate is omitted if its report's actual burning observation is no longer retained.

All positions are metres east/north. Commands/proposals are checked against the live runtime state at application time; callers should use `runId`, `decisionEpoch`, and squad mission versions from the latest planning context.
