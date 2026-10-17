# Frozen integration interfaces (schema v1)

## Exports and ownership

- `packages/contracts/src/index.ts` owns shared Zod schemas and inferred DTOs: `WorldDefinition`, `WorldSnapshot`, `Observation`, `RiskReport`, `IncidentSummary`, `MissionProposal`, `PlanningContext`, `OperatorCommand`, `CommandEnvelope`, `CommandResult`, `OperatorInput`, `OperatorResponse`, `Announcement`, `WorldResponse`, and `WorldStreamEventSchema`.
- `packages/contracts/src/fixtures.ts` exports `previewScenarios` and `createPreviewWorld(scenarioId?)`; each fixture creation allocates independent arrays/objects.
- `packages/sim/src/index.ts` exports `SimulationModule` and `simulationUnavailable`, defining create/step/apply-proposal/get-snapshot/get-local-observations boundaries only; no fire physics.
- `apps/server/src/runtime/index.ts` exports `PreviewRuntime` and `createPreviewRuntime(initial)`. `getWorld()` returns a detached clone. No reset method until a runtime can create a new run correctly.
- `apps/server/src/ai/index.ts` exports `AssessmentModule.assess(observations, signal)` and `OrchestratorModule.propose(context, signal)` / `.respond(context, input, signal)`. Unavailable methods reject with `ModuleUnavailableError`.
- `apps/server/src/voice/index.ts` exports abortable `VoiceModule` stubs; voice is unavailable in preview.
- `apps/server/src/routes.ts` and `apps/server/src/index.ts` are integrator-owned composition and loopback registration. Feature lanes export adapters, not routes.
- `apps/web/src/client/index.ts` exports `EmberClient.getWorld(signal)`, `sendCommand(command, signal)`, `submitOperatorInput(input, signal)`, `subscribe(onWorld,onError,onEvent?,onConnection?): unsubscribe`, and `reloadPreview(signal)`. The optional third callback receives typed live `WorldStreamEvent` risk/mission/announcement envelopes. The fourth callback receives connection state after the first world event and on disconnect; App clears live speech and advances a connection epoch. Reload only refetches fixture data, not reset.
- `apps/web/src/scene/index.tsx`: `SceneProps` / `ScenePreview`; scene owner.
- `apps/web/src/tactical/index.tsx`: `TacticalProps` / `TacticalMap`; tactical owner.
- `apps/web/src/dashboard/index.tsx`: `DashboardProps` / `Dashboard`; tactical/dashboard owner.
- `apps/web/src/voice/index.tsx`: `VoicePanelProps` / `VoicePanel`; voice owner. Props provide `runId`, optional `connectionEpoch`, current-only `announcements`, `onCommittedInput(input): Promise<OperatorResponse>`, and provider `status`.
- Integrator owns `apps/web/src/App.tsx`, shared style tokens, root manifests and lockfile.

## HTTP and stream paths

All endpoints are loopback-only under `/api` and same-origin through the Vite proxy.

| Path | Contract |
|---|---|
| `GET /api/world` | Current `WorldResponse`, including `definition`, `snapshot`, `risks`, current-only `announcements`, `providers`, and `preview`. |
| `GET /api/events` | SSE with `event: world` and a JSON `WorldResponse` data payload on connect. No replay. Future named events: `risk` carries `RiskReport`, `mission` carries `MissionSchema` data, and `announcement` carries `Announcement`; each is run-scoped and typed by `WorldStreamEventSchema`. This preview currently sends only world events. Route composition forwards live runtime events when a subscription hook is supplied. World responses always omit speech announcements; only fresh announcement events feed playback. |
| `POST /api/commands` | JSON `CommandEnvelope` -> `CommandResult`; preview validates and reports unavailable. |
| `POST /api/operator-input` | JSON committed `OperatorInput` -> grounded `OperatorResponse`; preview reports unavailable. |
| `GET /api/voice/token` | Future STT token request takes no body/query. Success should return a short-lived single-use provider token plus expiry; never return a provider API key. Preview returns 503. |
| `POST /api/voice/audio` | Future JSON request `{ "announcementId": "<current run announcement id>" }`; server resolves only a current approved announcement and returns audio bytes/content type. Never accepts arbitrary speech text/model instructions. Preview returns 503. |

SSE's current wire format uses named events with their DTO as data; `WorldStreamEventSchema` is the shared discriminated event envelope for feature-lane dispatch. On reconnect, consumers use current state and never replay historical audio. `GET /api/world` and SSE world payloads carry `announcements: []`; approved announcements remain server-side for ID-based synthesis. A reset changes run ID; stale async results are discarded.

## Semantics and staleness

Positions are metres east/north `{x,y}`; elevation is metres. Convert world positions to grid cells by dividing by `cellSizeM`. Three.js uses `(x,elevation,-y)`; canvas inverts y. Grid index is `row * width + column`, row zero south. Wind `{x,y}` is a vector blowing toward those axes, in m/s. Simulation times are seconds; announcement `createdAt`/`expiresAt` are wall-clock epoch milliseconds. Resources, confidence and protection are normalized 0..1. IDs are stable machine identifiers; display/spoken names are separate.

Every world DTO has schema version 1 and run ID; revisions increase within a run. World validation checks static/dynamic cell counts and matching envelope run IDs. Unknown fields and non-finite numbers reject. `PlanningContext` includes run/decision epoch, static definition, known weather, local observations, incidents/reports, fleet/mission state, feasible assignment candidates, squad mission versions and human constraints. It deliberately excludes dynamic cells and hidden simulation ground truth.

Command envelopes use a strict discriminated union for assignment, priority, pause, speed, spread, weather, ignition, recall, resume-auto, and reset. Numeric controls have explicit bounds. Preview validates then returns unavailable; it never claims application. In a live runtime command IDs must deduplicate per run and differing reuse must reject. Accepted means assignment applied, not completed. Proposal batches validate atomically. Human pins persist and outrank autonomous allocation; physical/resource feasibility remains highest. Decision epoch and relevant squad mission versions are checked before application. `reloadPreview` is not reset.

## Integration adapter seams (integration-1)

`apps/server/src/services.ts` exports optional composition hooks, not an engine or AI implementation:

- `RuntimeHooks`: `getWorld()` required; optional `subscribe(listener): unsubscribe`, `applyCommand(envelope): CommandResult`, `applyProposal(proposal): CommandResult`, and `getPlanningContext(): PlanningContext`. The exact runtime export remains owned by the engine lane; adapt it here rather than replacing its interface.
- `IntelligenceLifecycle`: `start()`, `stop()`, `requestReplan()`, `getStatus(): readonly ProviderState[]`, and `submitOperatorInput(input, signal): Promise<OperatorResponse>`. Coalescing, latest-state pending slots and cancellation remain AI-lane responsibilities. This interface does not run a competing loop.
- `RouteServices`: optional `submitOperatorInput`, `voice`, and `announcements`. `createRoutes(runtime, services?)` returns the server, clients, `publish(event)`, and announcement store. Runtime subscription automatically forwards live events; callers must not also forward the same events manually.
- `VoiceRouteAdapter`: `transcriptionToken(signal)` returns `{token, expiresAt?}`; `audio(announcementId, signal)` returns `{audio: Uint8Array, contentType}`. Adapt lane exports at composition. The route accepts only an announcement ID, resolves approved current text server-side, and rechecks validity after synthesis.
- `createAnnouncementStore(getWorld)` has `approve`, `resolve`, `getCurrent`, `clear`; `getCurrent(): {runId, announcements}` matches the voice lane's resolver input; it holds at most 64 current approved entries. Old runs, expiry, missing reports/missions and changed mission versions invalidate audio. Only accepted-action/grounded-response publishers may call `publish` with announcements. The store cannot validate the truth of arbitrary prose.

App supplies callbacks matching the emerging tactical/dashboard lane: `onCommand(command: CommandEnvelope): Promise<CommandResult>`, `onOperatorInput(input: OperatorInput): Promise<OperatorResponse>`, `targetPosition`, and `onTargetSelect(position: {x:number,y:number})`. Selection remains `onSelect(id)` and `selectedIds`. Dashboard controls/settings use `onCommand`, not snapshot mutation. Voice retains `onCommittedInput` with the same operator-input transport. No feature files have been copied or changed for these preparation slices.

Read-only integration-2-prep inspection found runtime exports `createRuntime`, `subscribe(listener: (world: WorldResponse) => void)`, `sendCommand`, `applyProposal`, `getPlanningContext({reports?, incidents?})`, `getLocalObservations`, `start/stop/reset`. Entry composition can wrap world callbacks in typed stream envelopes and map `sendCommand` to the route adapter's `applyCommand`. AI now exports `createIntelligence({definition,getCurrentContext,approveProposal,providers?})`, returning `assessment`, `orchestrator`, `approve`, `fuseIncidents`, `status`, `metrics`, `invalidate`, `dispose`. The integrated runtime now supplies observed-evidence candidates and initial scouting missions. It retains bounded local observations for delayed report references. Composition does not reconstruct missing evidence from hidden cells.

Provider environment names found in feature source, without inspecting values: `JEV_API_KEY`, optional `JEV_MODEL` (current default `jev-latest`); `OPENAI_API_KEY`, `OPENAI_MODEL` (no guessed GPT model); `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`. Current voice code uses `eleven_flash_v2_5` for TTS. Exact account/model access is unverified. Provider owners remain responsible for official API documentation and error/fallback behavior.

## Prepared composition (integration-2b)

`apps/server/src/composition.ts` exports `createComposition(runtime, providers?)`. It returns `{runtime: RuntimeHooks, services: RouteServices, start, stop, metrics}` for `createRoutes(composition.runtime, composition.services)`. Server entry activates this composition with `createRuntime()` by default. `LiveRuntime` is a structural adapter for the engine lane exports, not an engine implementation.

Composition samples at 2.5 wall seconds and plans at 4 wall seconds; each has one active operation and one pending latest-state flag. Physical stepping is started independently and never awaits providers. Assessment completion requests planning. Human input invalidates pending AI work and blocks autonomous requests for that turn. Reset clears reports, announcements, applied-ID cache and evidence. Current simulation time prunes expired reports before context construction and approval. Approval rechecks current run/epoch/candidate membership, delegates atomic squad/resource/version validation to the scheduler, and maps its result to the caller's command ID. Only accepted actions or grounded operator answers produce voice candidates. Routes register approved candidates and expose ID-only synthesis; the voice factory receives the same store through `getCurrent()`.

The frontend passes only live SSE announcements to VoicePanel. Optional `connectionEpoch?: number` resets listening/playback queues on disconnect/reconnect and discards old-connection operator responses. App also expands squad selections to drone IDs for scene highlighting, preserving the shared selected IDs for tactical/dashboard.

Provider calls and model availability have not been checked in integration. Integration-3 copied the authorized engine/runtime paths and added `@ember/sim` plus the server TS reference. Main-only runtime repairs fairly bound candidates per squad, deduplicate targets from each region's newest report, and pin identical human assignments without restarting execution. Assessment batches take newest retained observations. SSE skips replaceable world updates above a 1 MB backlog and disconnects above a 4 MB hard bound. The final offline HTTP/SSE causal rehearsal passed after two focused repair cycles; browser and hosted-provider behavior remain unverified.

## Failure semantics

Async module methods accept `AbortSignal`; abort rejects with its reason. Provider, simulation, or adapter failures reject and callers surface them rather than manufacture success. Preview stubs throw explicit unavailable errors. Route composition belongs to integrator; runtime/sim/AI/voice lanes own only their feature folders.
