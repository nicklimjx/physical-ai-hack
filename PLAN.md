# Ember Command: autonomous wildfire response with voice intervention

## 1. Product and decisions

Build a localhost wildfire command centre with synchronized 2D/3D views. Simulated drones observe local conditions, JEV assesses problem areas, a GPT orchestrator combines their reports and coordinates squads, and deterministic controllers execute missions. The human can intervene by voice but is not required to keep the system operating.

The core promise:

> The fleet detects a developing threat, coordinates a preventive response, and tells the operator what it has done. The operator can add local knowledge or redirect priorities at any time.

Decisions confirmed from the planning discussion:

- No Gymnasium runtime or RL training. Build a small TypeScript simulation.
- JEV is the local observation-assessment layer, not the fleet commander and not merely an optional mission selector.
- One GPT orchestrator owns fleet-level planning and conversational intent.
- ElevenLabs handles speech input and output. Proactive spoken updates are part of the core demo.
- Autonomous execution by default; humans intervene selectively.
- Localhost only, with outbound calls to hosted APIs. No deployment required.
- ElevenLabs, GPT API and JEV credits/access are reported available by the user. Specific model access remains to be checked.
- User model labels are `gpt6-astra` and `6.1-luna`. Treat these as requested names, not verified API identifiers.
- No tests or test infrastructure. Minimal build/manual verification only.
- An empty README initial commit is authorized. Additional commits require authorization.

This is a stylised simulated physical system, not validated wildfire forecasting, autonomous operational firefighting or real hardware deployment.

## 2. Judging criteria translated into build priorities

| Criterion | Build choice | Evidence in the demo |
|---|---|---|
| Execution | One complete observation -> assessment -> planning -> action loop, two linked views, working voice | A threat changes actual missions and physical state without manual stage management |
| Problem Identification | Reduce operator overload when several areas need attention and resources are limited | Available groups suppress independently observed fires while maintaining existing responses |
| UX | Voice for intent, map for spatial understanding, short proactive reports, visible overrides | Operator understands what is happening without opening logs or approving routine actions |
| Creativity & Real-World Impact | Combine local risk assessment, autonomous resource coordination and human local knowledge | Firefighting groups travel, spend payload and measurably reduce observed fire heat |
| Demo clarity | Show one causal chain with visible evidence and honest labels | Observation, assessment, suppression decision, travelling groups and physical heat reduction are distinguishable |

Target user: an incident-command operator supervising multiple robotic teams. The meaningful problem is attention and resource allocation, not replacing professional fire command with a chatbot.

The credible near-term use is a simulation/training and workflow prototype. Do not claim real commanders could safely deploy this operationally tomorrow. Real deployment needs validated sensing, hardware capability, operational constraints and domain evaluation.

## 3. The autonomy architecture

```text
Simulation ground truth
        |
  local sensing footprints
        |
Drone observations, with source and timestamp
        |
JEV: classify threat / assess priority / report evidence
        |
Typed reports grouped by incident
        |
GPT orchestrator: combine reports + fleet state + human priorities
        |
Validated mission proposal
        |
Local mission scheduler and deterministic squad controllers
        |
Patrol / suppress / recall / return and refill
        |
New observations and mission events -> repeat

Human speech -> ElevenLabs STT -> same GPT orchestrator
Applied actions + important risk changes -> announcement policy
                                       -> ElevenLabs TTS -> human
```

This is hierarchical coordination. A swarm can be centrally coordinated, decentralised or hybrid; there is no requirement that every drone run a general-purpose language model or talk to every other drone.

Each simulated drone has local observations and execution state. JEV assesses those observations; it is not being credited with detecting fire from raw camera pixels. MVP inputs are structured simulated sensor readings, not image inference. If imagery is later added, that needs its own verified perception path.

### Responsibilities

- **Simulation:** owns physical truth, fuel/heat/protection, movement and resources.
- **Sensors:** expose only nearby observations, not the whole fire grid. Shared known maps/weather are allowed; unknown areas remain unknown.
- **JEV:** turns local observations into typed threat assessments, with evidence references and uncertainty.
- **GPT orchestrator:** fuses incident reports, resolves priorities and assigns/reassigns missions.
- **Scheduler:** validates resource availability, human pins, targets and stale decisions; applies accepted assignments.
- **Controllers:** allocate nearby target cells, move drones, spend suppressant, return/refill, complete tasks without waiting for LLM calls.
- **Human:** adds knowledge and priorities or overrides a squad assignment.

The dashboard may show full simulation truth for demo clarity, but the AI gets only observations and known metadata. Label a ground-truth map as such. Monitoring must matter: an unobserved area must not silently generate omniscient reports.

### Decision cadence

Physical stepping never waits for a provider. Sample local observations periodically in simulation time; request assessments on material changes and periodically for freshness. Coalesce near-duplicate drone observations into regional batches while preserving contributor IDs.

Initial tunable budgets: approximately one assessment batch every 2-3 wall-clock seconds when changes exist; one orchestrator replan every 3-5 seconds or on a significant event. These are starting limits, not benchmarks. Keep one in-flight assessment batch and one in-flight strategic plan, with a latest-state pending slot rather than an unbounded queue.

Use asynchronous hosted calls. The fast physical control loop continues between decisions. Accelerated simulation can outpace cloud reasoning, so make 1x the judged demo default and show report age.

### Authority

Priority: physical/resource feasibility > explicit human constraints > autonomous allocation.

Within that envelope, act without confirmation. Do not ask whether to dispatch an available reserve squad to a newly threatened area. Do announce an important accepted action briefly.

Human pins persist until completion/cancellation. Returning to refill does not drop a pin. A new explicit human order may replace an old one; if replacement intent is unclear, ask one clarification. The orchestrator cannot silently override a pin.

Avoid mission churn: keep an active mission unless it completes, becomes invalid or a materially higher priority appears. Apply a short reassignment cooldown, with exceptions for resource infeasibility and human intervention.

## 4. Scope

### Must ship

1. One shared world with 3D scene and 2D tactical view.
2. Eight groups of four drones. Use group names **Alpha** through **Hotel** and neighborhood names **Community 1** through **Community 3** to avoid voice ambiguity.
3. Local observations -> JEV reports -> GPT planning -> autonomous missions.
4. Suppress, patrol/monitor, recall and resume-auto actions.
5. Prevention changes the fire calculation and consumes finite resources.
6. Voice intervention, status questions and selective proactive spoken reports.
7. Persistent human overrides with visible ownership.
8. One initial world with houses and trees, wind/spread controls, pause/speed/reset and click-to-ignite. Additional map types come after the engine works.
9. Transcript, risk reports, mission status and concise decision/event feed.
10. Typed/button equivalents and honestly labelled rules fallback.

### Optional

Drone-follow camera, richer smoke, separate same-seed comparison run, advanced voice interruption and additional scenario presets.

### Non-goals

Gymnasium, RL training, real drones, satellite ingestion, VR, Google Tiles, photogrammetry, databases, multiplayer, full radio-network simulation, production authentication, elaborate agent frameworks, evacuation modelling and per-drone generalist LLMs.

No tests or verification-only dependencies. Use direct modules and existing runtime tooling.

## 5. Simulation

Start with a 64 x 64 grid, 10 fixed simulation steps/second and roughly 5 state snapshots/second. Browser rendering interpolates positions. Rates are proposals, not measured performance.

Static cell fields: elevation, land/fuel class, initial fuel load and region. Dynamic fields: heat, remaining fuel, burn state and protection strength. Land classes: water, road, grass, forest and wooden buildings.

Burning cells consume fuel and transfer heat to neighbours. Weight transfer by wind direction, fuel type, optional slope and protection. Non-burnable cells cannot ignite. Fuel exhaustion produces burned cells. Suppression reduces heat. Pre-treatment temporarily reduces ignition/transfer tendency and decays over simulation time.

Do not call this a validated Rothermel implementation unless one is actually implemented and verified. A transparent, stylised cellular model is enough for the demo.

Protection appears only when a drone reaches its target and spends payload. It is distinct from burned/extinguished state. Use fixed cruise-altitude movement and simple spacing, not claimed collision avoidance or flight dynamics. Return/refill when resources are low. Payload capacity and treatment effectiveness are demo parameters, not real drone capabilities.

### Missions

`idle -> travelling -> working -> monitoring / returning -> refilling -> travelling / idle`

All groups share the same firefighting capability. Patrol/monitor missions use known static community centroids; suppression missions target only fresh reports linked to retained local observations of burning. Returning groups refill and resume their pinned suppression target until the observed fire is actually extinguished.

### Scenarios

Latest user direction: include houses and trees in the initial world, but defer map-type design until the engine is running. Build one coherent layout first; the following are provisional ideas, not a requirement to deliver two maps before integration. Houses and trees should correspond to building/vegetation fuel semantics rather than being exclusively decorative.

- **Woodland Edge:** observed forest fire near Community 1; downwind wooden Community 2; road/water boundaries and nearby base.
- **River Crossing:** separate fuel corridors, different base/settlement layout; same mechanics and schema.

Pause freezes physical changes, including movement and resource use. Mission assignment can still occur. Speed changes simulated time per wall second; spread multiplier changes fire behaviour. Keep those controls distinct.

Reset/map change creates a new run ID and clears missions, observations, pending provider results and spoken announcements. Same seed on reset by default. Weather edits apply on the next step. No stale API reply may resurrect a mission from an old run.

Show burning cells, burned area, threatened observed structures and firefighter group resources. Risk categories are heuristic/AI assessments, not calibrated fire arrival forecasts. Do not report "homes saved" without an actual comparison.

## 6. JEV assessment layer

Official API: https://docs.typesafe.ai/api

JEV accepts a state and typed questions. Use choice questions for categories such as `no_issue`, `watch`, `high_risk`, `active_fire`; optionally score urgency against an explicit rubric. Its API confidence is model certainty, not physical hazard probability.

Input examples: local heat trend, observed burning neighbours, known wooden structures, wind, protection state and observation age. Include IDs so outputs can cite actual evidence. Do not give it future ignition values or hidden whole-map truth.

Output: local risk report with run ID, report ID, source drone IDs, region ID, observed/sampled times, classification, confidence when available, evidence observation IDs and validity window. Populate factual evidence from the input rather than inventing explanatory details.

Coalesce multiple reports of the same incident. GPT sees a compact incident summary with contributing sources, not twelve repetitive conversations. Reports can disagree; retain uncertainty and freshness rather than presenting unsupported certainty.

Use bounded timeouts. On provider failure, rule-based assessments preserve autonomy and display `rules fallback`. Do not pretend that fallback results came from JEV. Request count, duration and returned token usage are sufficient instrumentation. No unverified claims about latency or cost.

## 7. GPT orchestration

One server-side orchestrator handles autonomous replanning and human language. Its context contains current incidents, recent observations, squads/resources, active missions, human pins and known map/weather metadata.

Provide feasible mission candidates and allow structured selection/allocation rather than arbitrary code, coordinates or engine mutation. Include `keep_current` and `hold` so it need not continually invent actions. Fleet-wide assignments should be validated as a batch: no duplicate squad allocations, infeasible resource use or unauthorized override.

A response contains bounded assignments and a concise explanation referencing reports. The scheduler revalidates against live state before applying. Rejected proposals do not produce success announcements.

Use run ID plus decision epoch and relevant squad mission versions. Human intervention invalidates affected in-flight plans. A new snapshot revision alone does not invalidate all plans: the world changes constantly. Revalidate relevant facts, resource availability and assignment ownership.

Prioritize human requests over pending autonomous planning. If a provider request cannot be cancelled, discard its stale result. Explicit commands do not need to wait for a new JEV assessment.

When GPT is unavailable, deterministic policy continues safe demo missions within the same constraints. Label the planner fallback. Completion of the intended AI demo requires the real JEV -> GPT loop, not merely that fallback.

### Model access

Hosted APIs can all be called outbound from localhost. No callback server or tunnel is necessary with this architecture. Keep provider keys server-side.

The user requests models described as `gpt6-astra` or `6.1-luna`. Verify exact provider model identifiers, account availability and structured-output/tool support before configuration. Do not infer support from a coding-agent model label. This is a setup check, not a reason to change the architecture.

## 8. Voice: bidirectional and proactive

Use ElevenLabs speech-to-text plus text-to-speech around the same local orchestrator, rather than introducing a second conversational decision maker.

```text
Microphone -> ElevenLabs realtime transcription
           -> committed utterance -> local GPT orchestrator
           -> validated mission changes / grounded answer
           -> ElevenLabs TTS -> browser audio

Autonomous applied mission / critical new risk
           -> announcement policy -> ElevenLabs TTS
```

ElevenLabs documents browser realtime transcription using a server-issued single-use token and server-side streaming TTS. This allows local orchestration and proactive speech without a hosted webhook reaching localhost. It does mean we own turn-taking and audio playback; keep that implementation small.

Start with press-to-talk, partial transcript display and an explicit end-of-utterance submission. This prevents crowd noise from issuing commands and avoids fragmented transcripts becoming multiple actions. User activation also enables browser audio playback. Muting narration does not stop autonomy.

Press-to-talk stops current playback and suppresses listening to the system's own voice. A stopped spoken response does not undo an already accepted mission. Natural full-duplex barge-in is optional, not required for the demo.

### Speak selectively

- **Routine action:** act silently; update the dashboard.
- **Significant autonomous intervention:** act, then inform. "Community 2 has observed burning. Bravo group is moving to suppress it."
- **Important constraint:** explain, without blocking autonomous actions elsewhere. "All groups are committed. Community 2 remains exposed; Alpha is still pinned to Community 1."
- **Useful suggestion:** optional non-blocking suggestion when the system cannot act within its authority. "Releasing Alpha would let me reinforce Community 2."
- **Ambiguous human instruction:** ask one clarification before that instruction, not before unrelated autonomous work.

The system should not ask "shall I deploy?" when it already has permission and resources to do so. Suggestions should not become an approval queue.

Use a short speech queue, coalesce duplicate incidents, and apply a starting 15-second cooldown for noncritical unsolicited updates. Operator replies and critical changes take priority. Drop stale announcements after reset or changed missions. Narration is grounded in accepted actions/current reports, not unexecuted model proposals.

Typed input follows the same orchestration path. Buttons submit structured commands directly. If speech fails, label voice unavailable and preserve the rest of the demo.

## 9. UI and demo clarity

### Visual reference: JEV rescue swarm

The user explicitly selected https://jev-rescue-swarm.pages.dev/ and supplied two screenshots as the scene appearance target. Match the visual language, not its button bars, emergency-call panels or full interface. This supersedes a generic grid-like simulation aesthetic.

Reference screenshots were supplied from temporary clipboard paths ending in `pi-clipboard-33bd8474-53b5-4ccd-abf4-5507fdcafeb7.png` and `pi-clipboard-595c5fb2-a18d-4fda-b46a-40bdaebd8faf.png`. These are temporary references, not durable project assets; this written brief must stand on its own.

**Scene composition:** a wide elevated oblique view over a continuous rolling landscape. Foreground command base with circular launch pads; central lake/water source; dense forest belts and clearings; winding roads; small neighbourhood clusters farther into the valley. Keep the base, fleet, fire front and threatened settlement readable together. Orbit/pan/zoom, with a useful default camera, not a toolbar of camera modes.

**Geometry:** low-poly hills, clustered conifers with layered pointed silhouettes, occasional rounded deciduous trees, simple light-walled houses with pitched roofs, and a minimal command compound with a mast. Variation in tree size, density and orientation avoids a uniform grid. The simulation may be gridded internally, but terrain and vegetation should not look like exposed square tiles.

**Lighting/palette:** warm late-afternoon amber haze, olive/brown terrain, dark green forests, muted blue water, long directional shadows and atmospheric distance fading. Preserve readable detail in shadow rather than making the entire scene too dark. Fire is the brightest warm element; drones and labels are small crisp highlights.

**Fire/smoke:** irregular glowing fronts embedded in vegetation, warm flame particles and tall soft grey smoke columns drifting with wind. Visuals follow burning cells and weather rather than a decorative fixed fire. Start with pooled particles/billboards, restrained glow and distance fog, not expensive fluid or volumetric simulation. Smoke must not hide the entire tactical situation.

**Fleet:** small visible aircraft with navigation lights/bright markers, thin pale curved trails and restrained selected-drone labels. Launch visibly from base and travel over the terrain. Trails represent actual recent movement; any planned routes are visually distinct. Do not draw invented paths unrelated to mission execution.

**Our addition:** a subtle cyan treatment tint/edge and visible drops where drones actually apply protection. Keep it subordinate to the landscape and distinct from water/fire. Match the physical effect, not an instant neighbourhood-wide paint fill.

**Minimal interface:** let the scene dominate. A compact voice/status strip, small collapsible mission feed and unobtrusive 2D inset are enough. Put necessary map/weather/reset controls in one compact drawer rather than copying the reference's buttons. Both views use the same snapshot and selected IDs. No rescue-call/civilian/thermal interface is implied by the reference screenshots.

### 3D worktree acceptance

- A static preview fixture already resembles the reference in composition, vegetation density, lighting and scale before AI integration.
- The live snapshot drives drones, fire, wind and protection without introducing a second simulation.
- The default camera shows the base, lake, forest fire and threatened neighbourhood together.
- Camera movement stays usable with the full demo fleet and forest. Reduce particle/shadow cost before sacrificing scene composition.
- Build original procedural geometry/effects; visual inspiration is not permission to copy the reference's source/assets.

Ship visual quality in this order: terrain/camera composition, clustered vegetation and buildings, lighting/shadows, readable fleet motion, fire/smoke, subtle treatment effects. A small map with this coherent appearance is preferable to a large sparse map.

Show:

- Autonomous mode and provider/fallback state.
- Human-pinned versus auto-managed squads.
- Observed versus unknown areas, or explicitly labelled ground-truth view.
- Recent source observation -> JEV assessment -> GPT assignment -> execution events.
- Listening / processing / accepted / rejected status.
- Wind, simulation clock, payload and mission progress.

This trace is not hidden chain-of-thought. Show concise observable evidence and decision summaries, not private reasoning transcripts.

## 10. Frozen integration contracts

One frontend and one local Node server, with internal modules. Multiple worktrees do not imply microservices.

Proposed layout:

```text
packages/contracts/src/    schemas, units, DTOs, preview fixtures
packages/sim/src/          fire, sensors, drones, missions, fallback rules
apps/server/src/runtime/  authoritative loop, scheduler, route composition
apps/server/src/ai/       JEV assessor, GPT orchestrator, incident summaries
apps/server/src/voice/    transcription token and TTS proxy
apps/web/src/client/      shared HTTP/SSE client
apps/web/src/scene/       3D presentation
apps/web/src/tactical/    2D presentation
apps/web/src/dashboard/   controls, metrics, incident and mission panels
apps/web/src/voice/       microphone, transcripts, playback queue
apps/web/src/App.tsx      integration shell
```

Before parallel development, write actual shared schemas and exported props/functions. Prose is not the final contract. One owner controls contracts, App.tsx, root manifests and lockfile.

### Shared semantics

- World positions `{x, y}` in metres: east/north. Elevation in metres. Three.js `(x, elevation, -y)`; Canvas inverts y.
- Grid index `row * width + column`, row zero south.
- Simulation time seconds, wall-clock timestamps separately identified. Wind is a vector blowing toward x/y, not an ambiguous bearing.
- Resources/protection are 0..1.
- All run-scoped envelopes carry `schemaVersion: 1` and `runId`. Snapshots have increasing revision within a run.
- IDs are stable machine identifiers; spoken/display names are separate.

### DTOs to freeze

| Contract | Essential contents |
|---|---|
| WorldDefinition | map/seed, dimensions, cell size, static arrays, regions, base |
| WorldSnapshot | revision/time, weather/settings, dynamic cells, drones/squads, missions, metrics, bounded recent events |
| Observation | run/source IDs, location, sampled simulation time, observed fields, sensor footprint |
| RiskReport | report/observation/source IDs, region, classification, evidence, provider, freshness, optional confidence |
| IncidentSummary | deduplicated reports, contributing sources, current risk, freshness/uncertainty |
| MissionProposal | decision epoch, squad mission versions, assignments, report references, human/auto source |
| CommandEnvelope | command ID, run ID, source, validated discriminated payload |
| CommandResult | accepted/rejected, reason, applied revision, mission IDs and brief message |
| Mission | squad, target/type, source, pin, status/progress |
| Announcement | event/run ID, priority, text, creation/expiry, related mission/report IDs |

Engine snapshots must not share mutable arrays with consumers. Validate model and HTTP inputs at runtime. Unknown IDs and non-finite values reject cleanly.

Command IDs deduplicate retries within a bounded run-local cache; the same ID with different contents rejects. Accepted means assigned/applied, not physically completed. A multi-squad plan validates as one batch before assignment; no silent partial success.

### Proposed routes

- `GET /api/world`: current definition and snapshot.
- `GET /api/events`: SSE snapshots plus typed risk, mission and announcement events. Send current definition on connect/new run.
- `POST /api/commands`: structured operator commands.
- `POST /api/operator-input`: committed utterance/text, request ID and run ID.
- `GET /api/voice/token`: short-lived single-use transcription token, never provider key.
- `POST /api/voice/audio`: synthesize an approved current announcement/response by ID, not arbitrary model instructions.

Simple full JSON snapshots are sufficient. On reconnect fetch current state; do not promise full event replay. Do not re-speak historical announcements. Bound event queues and discard old-run audio/results.

Bind server to loopback, use Vite proxy and explicit local-origin checks. No public server or new auth subsystem.

### Module interfaces

- Sim: create/step/apply batch/get snapshot/get local observations.
- Assessment: observations -> risk reports, with abort signal.
- Orchestrator: incidents + fleet + operator input -> mission proposal/answer.
- Scheduler: validate/apply proposal -> authoritative results.
- Views: definition/snapshot/reports/selection in; selection/intent out.
- Voice: committed utterance out; accepted announcements in. No world mutation.

Adapters can change without changing consumers. Shared preview fixtures are development assets, not tests. Additive fields preferred; breaking meaning/unit changes require one coordinated update.

## 11. Worktrees and agents

The authorized empty README commit provides a Git base only. It does not replace the contract/scaffold bootstrap. No feature workers should independently invent interfaces from an empty tree.

### Bootstrap, one writer

Create exact contracts, fixtures, exported stubs, app/server skeleton and agreed dependencies. Verify model access and a minimal speech round trip early. Before parallel work, distribute the same scaffold to every worktree. Commit it only with authorization; otherwise apply the same reviewed scaffold patch to each worktree.

### Ownership

| Lane | Owned paths | Outcome |
|---|---|---|
| A: simulation/runtime | `packages/sim/`, `apps/server/src/runtime/` | physical world, sensing, missions, validation, fallback and routes |
| B: 3D | `apps/web/src/scene/` | readable 3D scene using frozen fixtures/snapshots |
| C: tactical/dashboard | `tactical/`, `dashboard/` | 2D view, controls, evidence trace, mission/status panels |
| D: intelligence | `apps/server/src/ai/` | JEV assessment -> incidents -> GPT proposals |
| E: voice | frontend/server `voice/` paths | STT input, TTS output, proactive audio queue |
| Integrator | contracts, shared client, App.tsx, manifests/lockfile | stable boundaries and composition |

All five lanes are independent after schema freeze, but combine B/C if coordination or machine capacity becomes costly. D is core, not optional. A owns route registration; D/E export handlers/adapters against predefined interfaces rather than editing shared registration files.

One writer per worktree. No nested delegation or sibling-worktree edits. Each assignment specifies owned paths, acceptance criteria, no tests, one cheap check, bounded output and stop condition. Keep workers available for repairs, inspect actual diffs, then close explicitly.

Integrate runtime and intelligence first, then views and voice against their already agreed boundaries. No unapproved commits/cherry-picks. Reviewed patches including new files are an alternative. Workers request shared contract/dependency changes from the integrator rather than landing divergent versions.

## 12. Shipping order and verification

Time budget is still unknown. If approximately six focused hours remain:

1. **First 30-45 minutes:** freeze contracts/scaffold, confirm model identifiers/access, one speech round trip.
2. **Next 90 minutes:** parallel world, AI, views and voice work using fixtures.
3. **Next hour:** integrated observation -> JEV -> GPT -> squad movement -> protection loop without human input.
4. **Next hour:** voice override and proactive acknowledgement; settings and visual clarity. Discuss additional map types only after the engine works.
5. **Remaining time:** one rehearsal, targeted repair and presentation polish.

First vertical slice is a locally observed active fire, autonomous shared-group suppression, and real heat/resource change. Then add multiple groups and human intervention. Do not spend most of the day polishing terrain before the autonomy loop works.

Cut richer smoke, follow camera, comparison replay and full-duplex barge-in first. Keep one proactive announcement, real JEV/GPT integration and meaningful human override. Provider outage fallback keeps the app alive but does not count as completion of the AI feature.

No new or modified tests. Each worker runs one cheap build/typecheck or focused manual check. Integrator inspects actual diff and performs one end-to-end rehearsal. Repair only demo blockers; stop after two failed repair cycles and report the blocker.

### Three-minute demo

1. Show woodland map and both synchronized views. Explain that the AI sees local observations, not hidden simulation truth.
2. Start the scheduled demonstration ignition. A nearby group observes it; show the local report and automatic suppression dispatch. No operator approval.
3. Show all groups use the same firefighter capability. Reinforce ongoing observed fires with available unpinned groups.
4. Say: "Alpha fight Community 2." Show the fresh report evidence, human pin, group travel, payload use and actual heat reduction.
5. Say: "Bravo monitor Community 1," then recall and resume a named group. Show known-centroid patrol and explicit pin release.
7. Reset/change map; old missions and delayed speech must not return. Show a typed fallback only if useful.

If no reserve is available, narrate the constraint and suggest a change without freezing the rest of the system. Do not fake successful deployment.

The originality claim is autonomous preventive coordination with selective human authority and an understandable evidence trail, not voice control alone. Do not claim quantified damage avoided from a single run.

## 13. Reference findings and limits

- **FireSight:** source README describes 2D/3D, voice, autonomy and degrading retardant zones. Voice is not a new feature relative to this reference. No license file was found in the earlier tracked-filename inspection; verify rights before copying code/assets. https://github.com/AlfredSjoqvist/agentic-mission-control
- **JEV rescue demo:** inspected page/bundle supports incident triage and commander input, but proxy source and live cost/latency were not verified. https://jev-rescue-swarm.pages.dev/
- **TypeSafe API:** typed choice, yes/no probability and score support the assessment role. https://docs.typesafe.ai/api
- **FirecastRL:** single-helicopter Gymnasium actions and a separate TS/browser implementation. Useful reference concepts, but no runtime dependency. Root MIT license requires applicable notices for copied code; separately check assets. https://github.com/aisystems-lab/wildfire-env
- **ElevenLabs realtime STT:** browser microphone and single-use server-issued token flow. https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming
- **ElevenLabs TTS:** server-side audio generation/streaming. https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/streaming

Judging criteria were supplied directly by the user and are incorporated above. The Notion brief itself remains unreadable through the available fetch path; simulation-only eligibility and any sponsor-specific obligations remain unverified.

No live model access, provider latency, build or runtime behaviour has been verified during planning. Keys must not be pasted into chat or committed. Remaining practical inputs are time left and exact usable model identifiers, not a need to redesign the architecture.
