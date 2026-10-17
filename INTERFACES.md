# Frozen integration interfaces (schema v1)

## Exports and ownership

- `packages/contracts/src/index.ts` owns shared Zod schemas and inferred DTOs: `WorldDefinition`, `WorldSnapshot`, `Observation`, `RiskReport`, `IncidentSummary`, `MissionProposal`, `PlanningContext`, `OperatorCommand`, `CommandEnvelope`, `CommandResult`, `OperatorInput`, `OperatorResponse`, `Announcement`, `WorldResponse`, and `WorldStreamEventSchema`.
- `packages/contracts/src/fixtures.ts` exports `previewScenarios` and `createPreviewWorld(scenarioId?)`; each fixture creation allocates independent arrays/objects.
- `packages/sim/src/index.ts` exports `SimulationModule` and `simulationUnavailable`, defining create/step/apply-proposal/get-snapshot/get-local-observations boundaries only; no fire physics.
- `apps/server/src/runtime/index.ts` exports `PreviewRuntime` and `createPreviewRuntime(initial)`. `getWorld()` returns a detached clone. No reset method until a runtime can create a new run correctly.
- `apps/server/src/ai/index.ts` exports `AssessmentModule.assess(observations, signal)` and `OrchestratorModule.propose(context, signal)` / `.respond(context, input, signal)`. Unavailable methods reject with `ModuleUnavailableError`.
- `apps/server/src/voice/index.ts` exports abortable `VoiceModule` stubs; voice is unavailable in preview.
- `apps/server/src/routes.ts` and `apps/server/src/index.ts` are integrator-owned composition and loopback registration. Feature lanes export adapters, not routes.
- `apps/web/src/client/index.ts` exports `EmberClient.getWorld(signal)`, `sendCommand(command, signal)`, `submitOperatorInput(input, signal)`, `subscribe(onWorld,onError): unsubscribe`, and `reloadPreview(signal)`. Reload only refetches fixture data, not reset.
- `apps/web/src/scene/index.tsx`: `SceneProps` / `ScenePreview`; scene owner.
- `apps/web/src/tactical/index.tsx`: `TacticalProps` / `TacticalMap`; tactical owner.
- `apps/web/src/dashboard/index.tsx`: `DashboardProps` / `Dashboard`; tactical/dashboard owner.
- `apps/web/src/voice/index.tsx`: `VoicePanelProps` / `VoicePanel`; voice owner. Props provide `runId`, current-only `announcements`, `onCommittedInput(input): Promise<OperatorResponse>`, and provider `status`.
- Integrator owns `apps/web/src/App.tsx`, shared style tokens, root manifests and lockfile.

## HTTP and stream paths

All endpoints are loopback-only under `/api` and same-origin through the Vite proxy.

| Path | Contract |
|---|---|
| `GET /api/world` | Current `WorldResponse`, including `definition`, `snapshot`, `risks`, current-only `announcements`, `providers`, and `preview`. |
| `GET /api/events` | SSE with `event: world` and a JSON `WorldResponse` data payload on connect. No replay. Future named events: `risk` carries `RiskReport`, `mission` carries `MissionSchema` data, and `announcement` carries `Announcement`; each is run-scoped and typed by `WorldStreamEventSchema`. This preview currently sends only world events. |
| `POST /api/commands` | JSON `CommandEnvelope` -> `CommandResult`; preview validates and reports unavailable. |
| `POST /api/operator-input` | JSON committed `OperatorInput` -> grounded `OperatorResponse`; preview reports unavailable. |
| `GET /api/voice/token` | Future STT token request takes no body/query. Success should return a short-lived single-use provider token plus expiry; never return a provider API key. Preview returns 503. |
| `POST /api/voice/audio` | Future JSON request `{ "announcementId": "<current run announcement id>" }`; server resolves only a current approved announcement and returns audio bytes/content type. Never accepts arbitrary speech text/model instructions. Preview returns 503. |

SSE's current wire format uses named events with their DTO as data; `WorldStreamEventSchema` is the shared discriminated event envelope for feature-lane dispatch. On reconnect, consumers use current state and never replay historical audio. A reset changes run ID; stale async results are discarded.

## Semantics and staleness

Positions are metres east/north `{x,y}`; elevation is metres. Convert world positions to grid cells by dividing by `cellSizeM`. Three.js uses `(x,elevation,-y)`; canvas inverts y. Grid index is `row * width + column`, row zero south. Wind `{x,y}` is a vector blowing toward those axes, in m/s. Simulation times are seconds; announcement `createdAt`/`expiresAt` are wall-clock epoch milliseconds. Resources, confidence and protection are normalized 0..1. IDs are stable machine identifiers; display/spoken names are separate.

Every world DTO has schema version 1 and run ID; revisions increase within a run. World validation checks static/dynamic cell counts and matching envelope run IDs. Unknown fields and non-finite numbers reject. `PlanningContext` includes run/decision epoch, static definition, known weather, local observations, incidents/reports, fleet/mission state, feasible assignment candidates, squad mission versions and human constraints. It deliberately excludes dynamic cells and hidden simulation ground truth.

Command envelopes use a strict discriminated union for assignment, priority, pause, speed, spread, weather, ignition, recall, resume-auto, and reset. Numeric controls have explicit bounds. Preview validates then returns unavailable; it never claims application. In a live runtime command IDs must deduplicate per run and differing reuse must reject. Accepted means assignment applied, not completed. Proposal batches validate atomically. Human pins persist and outrank autonomous allocation; physical/resource feasibility remains highest. Decision epoch and relevant squad mission versions are checked before application. `reloadPreview` is not reset.

## Failure semantics

Async module methods accept `AbortSignal`; abort rejects with its reason. Provider, simulation, or adapter failures reject and callers surface them rather than manufacture success. Preview stubs throw explicit unavailable errors. Route composition belongs to integrator; runtime/sim/AI/voice lanes own only their feature folders.
