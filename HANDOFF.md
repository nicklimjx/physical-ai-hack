# Handoff: planning to parallel implementation

## Start here

Read `PLAN.md` in this repository for the product, researched references, visual brief, proposed interfaces, scope and minimal verification. This handoff focuses on the current decision state and how to execute the worktree split without integration drift. It is not a second product specification.

User's latest direction: include simulated **houses and trees** in the initial world. Work on additional map types **after the engine is running**. `PLAN.md` has been updated accordingly. Start with one coherent layout, not two independent map implementations.

The previous exchange was explicitly a review of the work split before implementation. The current request is a handoff, not authorization to silently start all workers. No application implementation has begun.

## Repository and actual state

- Workspace container: `/Users/nicholas/school-not/projects/physical-hack`
- Actual Git repository: `/Users/nicholas/school-not/projects/physical-hack/main`
- Branch: `main`.
- Only commit: `042a278`, `Add empty README to establish worktree baseline`.
- That commit contains an empty `README.md`, explicitly authorized by the user to enable worktrees.
- `PLAN.md` is untracked/uncommitted. This handoff is also being created uncommitted.
- No application code, installed project dependencies, worktrees, tests or runtime verification exist.
- Research workers `jev-research` and `sim-fit` were explicitly closed. No implementation workers were launched.
- The container-level `PAPERCUTS.md` records fetch/Git setup friction; it is outside the actual Git repository.
- Do not assume permission for further commits. The user's explicit permission was the initial empty README commit.
- No API credentials were read, requested in chat or committed. User reports access/credits for ElevenLabs, JEV and GPT APIs.

The user initially requested an OS-temp handoff through a skill, then explicitly requested saving it **in this repo**. This file follows that latest instruction.

## Product decisions to preserve

The relevant detailed architecture is in `PLAN.md`, especially sections 3, 6-10. Do not regress to the earlier design where JEV was an optional mission selector.

Current agreed direction:

1. Drones expose local structured simulated observations.
2. JEV assesses problem areas from those observations.
3. A GPT orchestrator combines reports and coordinates the fleet.
4. Deterministic squad controllers execute missions continuously.
5. Humans may intervene by voice, but routine decisions are autonomous.
6. Important autonomous actions receive brief proactive spoken updates.

Use ElevenLabs STT and TTS around the **same local GPT orchestration loop**, not a second independent conversational commander. Localhost makes outbound API calls; no public callback URL is needed for this design.

User refers to GPT models as `gpt6-astra` and `6.1-luna`. Those exact API identifiers/account availability have not been verified. Do not fabricate model support or confuse coding-harness model names with usable product API IDs.

No Gymnasium runtime or RL training. Build a small TypeScript simulation. The user wants the look of the JEV rescue simulator, not its button-heavy UI. The detailed visual brief in `PLAN.md` section 9 is the source of truth.

Important judgement: autonomous prevention must be real simulated behaviour, not a coloured overlay or scripted success. Protection only applies when drones arrive and spend payload. Houses/trees should have corresponding building/fuel semantics.

## Latest proposed split reviewed with the user

Five implementation worktrees plus integration in `main`:

| Worktree role | Responsibility | Exclusions |
|---|---|---|
| Simulation + runtime | Physical world, fire, local sensors, drone movement/resources, mission execution, command validation and server runtime | No model decisions, rendering or speech |
| Intelligence | JEV assessment, report aggregation, GPT planning, interpretation of operator text, grounded answer/announcement candidates | No engine mutation, physical control or audio playback |
| 3D scene | Reference-style terrain, vegetation/houses, base/lake, light/shadow, fire/smoke, drones/trails, camera | No second simulation or dashboard control ownership |
| Tactical dashboard + 2D | Shared-state tactical view, status, human pins, risk/decision feed, settings drawer, selection | No 3D, microphone/audio implementation or model clients |
| Voice | ElevenLabs STT/TTS adapters, press-to-talk, committed utterances, transcript strip, proactive playback/cooldowns | No mission planning or independent world state |
| Integration/main | Shared contracts/client, dependencies, composition, app shell, integration reviews | Avoid concurrent edits to feature-owned files |

The five-lane split was proposed and explained; the user did not request a different split, but had asked to review/steer before implementation. Their latest refinement was engine first, houses/trees included, map variants later.

### Proposed ownership paths

These do not exist yet. Create and freeze them during bootstrap:

- Simulation: `packages/sim/src/**` and `apps/server/src/runtime/**`.
- Intelligence: `apps/server/src/ai/**`.
- 3D: `apps/web/src/scene/**`.
- Tactical/UI: `apps/web/src/tactical/**` and `apps/web/src/dashboard/**`.
- Voice: `apps/web/src/voice/**` and `apps/server/src/voice/**`.
- Integrator: `packages/contracts/src/**`, `apps/web/src/client/**`, `apps/web/src/App.tsx`, shared styles/tokens, root package/workspace files and lockfile, server/app entry points.

Explicitly name the server composition/route-registration file and its owner at bootstrap. Recommended: integrator owns the entry point and route composition, feature workers export handlers/modules. Simulation owns the runtime implementation, not unrestricted access to all server files.

Shared visual tokens belong to the integrator; otherwise dashboard and voice workers will conflict over global CSS. Each visual lane owns local styles.

## Bootstrap before branching feature work

The empty README commit enables Git worktrees mechanically. It does **not** give workers a useful shared foundation. Do not launch five workers into empty trees and let each invent their own app/server setup.

Use a single writer for a short bootstrap:

1. Read current repository instructions and `PLAN.md`.
2. Establish package manager, app/server skeleton and agreed runtime dependencies.
3. Define actual TypeScript/runtime schemas for the contract concepts already described in the plan.
4. Define exported module functions and component props, including async cancellation/error behaviour.
5. Provide immutable preview fixtures and export stubs so every module can compile independently.
6. Define the shared API client and component slot wiring without feature logic.
7. Do one cheap relevant build/typecheck; no tests.
8. Distribute exactly that foundation to every worktree before feature writers start.

A committed scaffold is the simplest distribution method, but requires permission beyond the already-authorized README commit. If permission is not available, use a reviewed scaffold patch/archive including new untracked files and apply the same content to each worktree. Do not assume `git diff` captures untracked files.

Likewise, `PLAN.md` and this handoff are untracked: new worktrees will **not** inherit them from Git automatically. Copy/reference them explicitly in worker assignments unless they have since been committed with permission.

The orchestrator creates/manages worktrees. Workers do not create their own, edit siblings or delegate further. Each worktree has one writer. Keep workers in the background `subagents` tab using `delegate`, not Herdr pane CLI manipulation.

## Contracts that make the split genuinely independent

`PLAN.md` section 10 specifies the proposed DTOs and transport. Implement those once, then freeze a first contract version.

Critical boundaries:

- Simulation produces **Observation** and **WorldSnapshot**.
- Intelligence consumes observations and fleet summaries, produces **RiskReport**, **MissionProposal** and grounded response/announcement candidates.
- Runtime validates and applies proposals, produces **CommandResult** and execution events.
- Voice produces **OperatorInput**, consumes approved **Announcement**/response IDs.
- 3D/dashboard consume snapshots/reports and emit selections or command intent; neither imports engine internals.

Freeze before feature work:

- IDs, enums, units, axis conventions and world-to-render conversion.
- Run ID/revision semantics, simulation versus wall-clock times.
- Local sensing visibility and report freshness; no omniscient AI input by accident.
- Human pin authority, mission lifecycle and resource constraints.
- Command deduplication and multi-squad batch acceptance/rejection.
- Async decision epochs and stale-result rejection after human intervention/reset.
- Announcement priority/expiry and no replay of old speech on reconnect.
- Named component exports and props, not just HTTP payloads.

Use static fixtures for fire detected, threat increasing, travelling squad, treatment, human override and resource shortage. These are development assets, not tests. They remove the simulation worker from the frontend/voice critical path.

No worker modifies contracts, dependencies or root configuration independently. A requested boundary change goes to the integrator. Prefer additive changes; coordinate changes of meaning/units explicitly. Do not let provider-specific response shapes leak into simulation or views.

## Integration lifecycle

Parallel work should produce early thin slices, not five polished islands waiting to be merged at the end.

1. Bootstrap and freeze interfaces.
2. Launch bounded sole-writer assignments with exact cwd/paths, acceptance criteria and no further delegation.
3. All workers use shared fixtures/stubs until live modules arrive.
4. Integrate simulation/runtime and intelligence as the first causal loop.
5. Connect views and voice through the existing interfaces; avoid rewriting their state ownership.
6. Inspect actual diffs for ownership/scope and use worker check evidence without gratuitously rerunning it.
7. Keep workers open for focused repairs; close explicitly after acceptance/escalation.

Do not cherry-pick/merge unapproved feature commits. If commits remain unauthorized, integrate reviewed patches including new files. Keep shared files serialized under the integrator. A running writer in a given worktree means the orchestrator remains read-only in that worktree.

Initial full milestone:

> A drone observes a threat; JEV flags risk; GPT assigns a squad; drones travel and apply protection; the system briefly announces the accepted action; the human redirects priority by voice; other autonomous work continues.

Additional maps come after this works. A second map is not a prerequisite for this milestone.

### Voice/intelligence seam needing explicit ownership

Intelligence decides whether an incident/action merits an announcement and supplies grounded text/references. Runtime confirms execution status. Voice handles playback priority, cooldown/coalescing and cancellation. Do not let both workers independently invent a competing announcement policy or separate GPT conversation.

Start with press-to-talk. Stop current playback when the operator speaks; do not undo an already accepted action. Full-duplex barge-in is optional.

### UI/voice seam needing explicit ownership

Dashboard provides a shell slot for the voice strip. Voice owns its microphone/transcript/playback controls. The integrator composes them in App.tsx. Neither worker should take over the app entry point or shared event subscription.

## Verification and execution preferences

User explicitly invoked `delegate-start-quick`: shipping speed, minimal verification, no writing or modifying tests, no TDD or verification-only dependencies.

- One cheap relevant check per worker: build/typecheck or manual smoke check.
- Actual diff inspection.
- One short integrated manual rehearsal.
- Repair only blockers to the demo; rerun only the failed check.
- Stop/escalate after two failed repair cycles.
- No broad suites, coverage or production hardening.
- Never claim provider access, latency, cost, visual performance or runtime correctness without checking.

User challenged why remaining time was needed. Do not block architecture/bootstrap on a time-budget question; it only adjusts polish/lane count. There are no real project blockers requiring the same question again.

## Visual handoff details

Read the detailed scene acceptance brief in `PLAN.md`, not just "use Three.js". The reference is https://jev-rescue-swarm.pages.dev/.

Two user screenshots were inspected. They showed low-poly rolling hills, dense forests, scattered houses, lake, roads, command base/launch circles, warm haze, long shadows, large smoke columns, glowing fire and small drones with pale trails. User explicitly does not need the reference buttons.

Original screenshots were temporary files:

- `/var/folders/zh/n_nn_k_s2n957nxcvbk87b940000gn/T/pi-clipboard-33bd8474-53b5-4ccd-abf4-5507fdcafeb7.png`
- `/var/folders/zh/n_nn_k_s2n957nxcvbk87b940000gn/T/pi-clipboard-595c5fb2-a18d-4fda-b46a-40bdaebd8faf.png`

They may expire; the plan contains a written brief. Do not assume assets/source may be copied from the reference. Build original procedural geometry/effects. No screenshot assets have been copied into the repo.

## Reference projects: where to explore simulation implementation

These references serve different purposes. Explore targeted files when helpful; do not spend the hackathon reverse-engineering or adopting an entire application. None is a verified drop-in implementation of our product.

### 1. FireSight: complete wildfire command-centre reference

- Submission: https://devpost.com/software/firesight-y4vlrw
- Source: https://github.com/AlfredSjoqvist/agentic-mission-control
- Earlier fetch created a temporary clone at `/private/tmp/pi-github-repos/runtime-NknmGC/137421aabefaa7a5d478cf84849fbd77809e9b67468c40170b484c52a3a886f2`. Check whether it still exists; otherwise fetch the public repository again. No revision was pinned, so do not assume current upstream matches the inspected tree.

**Why it matters:** original functional inspiration for linked 2D/3D wildfire command, autonomous response, voice and preventative retardant effects. Its README describes wind/slope/fuel-dependent cellular spread, ember spotting and degrading retardant. Those are project claims, not independently validated fire physics.

**Useful paths found in the fetched tree:**

- `README.md`: architecture, features, dependencies and local run instructions.
- `firesight/src/fireSpreadEngine.js`: candidate starting point for the fire model.
- `firesight/src/icsEngine.js` and `firesight/src/strategyBehaviors.js`: incident-command and behaviour logic.
- `firesight/src/components/TerrainScene.jsx`: scene integration.
- `firesight/src/components/VoiceControl.jsx`: reference voice UI/integration.
- `firesight/src/components/CommandChain.jsx`, `AgentPanel.jsx` and `StrategyPanel.jsx`: command/status presentation.
- `drone-view/src/fireEngine.js`, `fireOverlay.js`, `drone.js` and `vehicles.js`: alternate drone-view simulation/rendering pieces.
- `3d-map/src/fireSpreadEngine.js` and `fireVisuals.js`: another fire-engine/rendering implementation.
- `IMPLEMENTATION_PLAN.md`, `DEMO_SCRIPT.md` and `context/FIRE_SPREAD_PREDICTION_TECH.md`: design/demo context, not proof that every described feature is implemented.

There are several sibling/duplicate applications, including `firesight-safe`, `3d-map-response` and `friend-fire-sim`. Trace imports from the relevant entry point before assuming a file powers the primary demo. The original source README describes multiple local processes, a postMessage bridge and SSE; we deliberately prefer one app/server and one authoritative world.

**Questions worth answering if needed:** How are spread and rendering separated? How does retardant decay affect ignition? How are drone targets assigned? Which engine actually feeds both views, and do duplicated engines risk inconsistent state?

**Verified versus unverified:** repository structure and README were inspected; the complete runtime was not installed, executed or audited. Direct Devpost fetching returned HTTP 403. No license file was found by a tracked-filename search; do not treat public source as permission to copy code/assets. Inspect licensing or obtain permission before reuse. The clone contained a `.env` path; do not open or reuse it. No credentials were inspected.

### 2. JEV Rescue Swarm: primary visual reference and triage example

- Live page: https://jev-rescue-swarm.pages.dev/
- Official JEV/TypeSafe API: https://docs.typesafe.ai/api
- Documentation index: https://docs.typesafe.ai/llms.txt

**Why it matters:** the user strongly prefers this simulation's appearance. The screenshots and visual brief above take precedence over a generic sparse grid scene. It also demonstrates an incident/decision stream and commander input.

A research worker inspected the public page and bundled JavaScript. It found simulated fleet-size controls and a JEV-backed triage path using transcript plus incident context, with fallback when unavailable. **No source repository or backend/proxy implementation for this particular demo was verified.** Do not invent a GitHub URL or assume its backend is available.

If further investigation is useful, inspect public page script references and the relevant bundle sections for terrain generation, tree instancing, drone trails, lighting, smoke and camera composition. Treat minified bundle exploration as bounded research, not an invitation to copy assets/code or recover secrets. Verify reuse rights independently.

The screenshots visibly include a recorded-session label. Do not interpret displayed decisions, timings or fleet behaviour as evidence of live API latency/performance. The demo does not prove JEV directly pilots individual drones.

Our design intentionally differs: JEV assesses local structured observations, GPT coordinates squads, and deterministic controllers execute. The official API exposes typed `choice`, `noul` (yes/no probability) and `score` questions through `POST https://api.typesafe.ai/v1/systemone`. It is not a flight-control simulator. Check current docs before implementation and measure our own calls rather than importing reference claims.

### 3. FirecastRL / wildfire-env: simulation mechanics reference

- Repository: https://github.com/aisystems-lab/wildfire-env
- Earlier fetch created a temporary clone at `/private/tmp/pi-github-repos/runtime-NknmGC/0e94e8cfd023d5e905ad0438254186ae335dc1996b14a43760f68f2c163373cc`. Check existence before using; no revision was pinned.

**Why it matters:** inspect mechanics of fuel, wind, cell state, suppressant/moisture and browser visualisation. The user agreed not to adopt the Gymnasium runtime; that does not prevent learning from the source.

**Browser-side files:**

- `web/src/models/engine/fire-engine.ts`: TypeScript grid-spread engine.
- `web/src/models/engine/get-fire-spread-rate.ts`: spread-rate calculations.
- `web/src/models/cell.ts`: cell state, moisture/drop and fire-line concepts.
- `web/src/models/simulation.ts`: central simulation state.
- `web/src/models/zone.ts`, `web/src/presets.ts`: terrain/zone and preset definitions.
- `web/src/components/view-3d/terrain.tsx` and `view-3d.tsx`: scene/terrain rendering.
- `web/src/components/view-3d/use-helitack-interaction.ts` and `use-place-spark-interaction.tsx`: suppression/ignition interaction candidates.
- `web/package.json`: actual frontend dependency stack before considering reuse.

**Python-side files:**

- `firecastrl_env/envs/wildfire_env.py`: Gymnasium environment, stepping and action interface.
- `firecastrl_env/envs/fire_engine/fire_engine.py`: NumPy-based fire engine.
- `firecastrl_env/envs/fire_engine/fire_spread_rate.py`: spread calculations.
- `firecastrl_env/envs/environment/array_state.py`, `cell.py`, `wind.py` and `zone.py`: state/weather/terrain representation.
- `firecastrl_env/viewer/server.py`: browser-viewer transport.
- `scripts/random_agent_3d.py`: example environment/viewer wiring.

**Known limits:** the documented action interface is one helicopter with four movement actions and one suppressant drop. It is not an autonomous multi-squad environment. The research worker inspected core engine/cell/environment code and found moisture/drop concepts, but did not establish persistent preventive treatment, voice, multi-squad control or synchronized 2D/3D as ready-made features. None of the code was run.

**Useful investigation questions:** Is suppression only reactive or does it alter future ignition? How does moisture decay? Does the browser run its own simulation or merely mirror Python in the selected mode? Which state is authoritative? Avoid accidentally importing two clocks/engines into our design.

The root license was inspected as MIT. Preserve applicable copyright/license notices for any covered code actually reused, and check assets/separate subtree licensing independently. Prefer a small understandable original model over importing Python, RL and viewer infrastructure just because they exist.

### Research stop rule

Use these references to answer a concrete implementation question, then return to the frozen contracts. The strongest starting approach remains the one in `PLAN.md`: small original TypeScript engine, original reference-inspired procedural scene, no Gymnasium dependency. If a reference suggests changing a shared interface, bring that change to the integration owner rather than altering one worktree's contract in isolation.

## Suggested skills

- `delegate-start-quick`: explicitly selected workflow for hackathon delivery.
- Read `~/.pi/agent/skills/delegate-start/SKILL.md` before any delegation lifecycle activity, as required by global instructions; apply the user's explicit quick-workflow deviations, especially no tests/minimal checks.
- `context7-mcp` or `context7-docs`: verify current ElevenLabs, OpenAI and rendering library API usage before implementation. The prior research validated architecture, not every eventual SDK method/version.
- `handoff`: used for this document; latest user instruction places it in the repository.

Do not activate manager mode, persistent goals/Sisyphus or test-driven workflows without explicit request.

## Next session

Present the current state briefly, preserve the agreed split, and proceed according to the user's next implementation instruction. The next technical action is **shared foundation/contracts**, not launching uncoordinated feature writers. If creating worktrees, first resolve scaffold distribution and ensure each worker gets the uncommitted plan/handoff. No further product redesign is needed to start the foundation.
