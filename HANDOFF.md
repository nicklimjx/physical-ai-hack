# Ember Command - integrated handoff

## Latest checkpoint: firefighter-only autonomy update

This update supersedes the protection-first behavior and all process/verification notes below. Main remains uncommitted; no tests or commits were added. The development server remains stopped; older PID/startup notes below are historical and must not be used to restart it.

- Fleet: 32 equal-capability firefighters, eight groups Alpha through Hotel with four drones each; neighborhoods are Community 1, Community 2, and Community 3. Shared cruise is 60 m/s.
- Start Demo only schedules physical ignitions at relative simulation times 0/12/28; current groups patrol, receive local reports, and the rules/GPT planner dispatches suppression only to observed burning. Monitor is patrol behavior, not a dedicated scout/reserve hardware class. Fresh report IDs and retained burning observation IDs ground suppression candidates.
- Typed/speech operator input uses one orchestration path. Fight/suppress pins a feasible group to an observed fire; monitor can patrol a known community centroid; recall/resume are explicit group controls. Pins remain authoritative until explicit resume or actual suppression completion.
- UI has one group badge per group at the live four-drone centroid in both views; selecting any member selects/highlights its group. Natural/Thermal/JEV modes, the camera-relative 3D compass, north-up tactical compass, and reversible inset swap remain.
- Latest verification for this update is recorded below. Browser rendering and live providers are not verified.
- JEV view immediately colors known land classes and shares a heuristic rules-derived static-map/weather prior between both views. This is NOT hosted JEV static-map inference or optical detection, and the prior is never planner observation evidence. Actual local JEV/rules reports overlay separate provider/age/source/evidence/unknown/stale labels.
- Final `npm run typecheck` (`tsc -b`) and `git diff --check` passed. One bounded offline smoke passed the causal evidence/assignment and operator-control checks; it did not measure a before/after payload or heat change, so physical suppression progress remains unverified.
- All worker runtimes/timers were cleaned up; sole writer `autonomy-ui-writer` explicitly closed, no lease remains. Integration orchestrator stays available.
- Fresh retained `npm run dev`: supervisor PID **15032**, npm PID **15039**. Web http://127.0.0.1:5173/ ; API http://127.0.0.1:4317/api/world . Observed web/API listener PIDs 15130/15131. Previous owned group 13406 was identity-verified and stopped before edits; unrelated listeners were not killed.
- Bounded log `/tmp/ember-command-live-15032.log` (65,536 bytes), ownership `/tmp/ember-command-live-15032.json`, launch log `/tmp/ember-command-live-launch.0arnhf`. Fresh startup returned web/API 200 and the six five-drone squads. Providers are configured; fresh-process successful calls/Fast serving are not confirmed. User can press Start Demo; no automatic start command was sent during live startup confirmation. URL opened using `open -g`.


## Latest verification: firefighter-only update

One offline run used `createComposition(runtime, {})`, the actual Start Demo schedule, and no HTTP server or provider call. In run `run-90b31537-4d73-4278-be0c-db0967fc525b`, it observed fresh `active_fire` report `risk:d9335a58-9fac-4bfc-9314-920d345a1d6f` for Community 2, linked to retained same-run burning observations including `obs-drone-5-240-1008` at `{x:960,y:300}`. Group 2 received an auto-sourced `suppress` mission targeting `{x:960,y:300}` with an announcement tied to that report. Typed `Alpha fight Community2` and `Hotel fight Community 2` were accepted as pinned suppression; `Bravo monitor Community 1`, `Alpha recall`, and `Alpha resume` were accepted, with Alpha ending unpinned and auto-owned. This smoke did not record physical payload/heat delta or extinguishment; do not claim it proved treatment progress. The max-speed simulation reached 24 sim seconds.

The final root typecheck (`npm run typecheck`, `tsc -b`) passed after code edits; `git diff --check` passed. Browser appearance, compass orientation in a browser, and physical treatment effects remain unverified. The smoke harness first had a no-op setup failure because it subscribed through `composition.services` instead of `composition.runtime`; it failed before starting simulation and was corrected for the single run. Earlier pre-fix smoke failures included `tsx --eval` top-level-await transform failure, a rejected 30x speed value (schema maximum is 10), and unsuccessful Alpha protect requests. The final corrected smoke used speed 10 and Alpha fight, which passed; prior failures are historical, not current acceptance evidence.

## State and ownership

- Main worktree: `/Users/nicholas/school-not/projects/physical-hack/main`.
- Last commit: `b6109f4` (bootstrap). All integrated feature work remains uncommitted. No integration commits were made or authorized.
- All five lanes are integrated: simulation/runtime, intelligence, 3D scene, tactical/dashboard, and voice. Shared client/App/routes/composition connect them into one authoritative server and two synchronized views.
- Manager: pane `w2S:p4`. Integration orchestrator: this retained integration pane, assignments `integration-1` through `integration-finalize`, followed by `env-1`. Feature orchestrators correspond to sibling worktrees `simulation`, `intelligence`, `scene`, `tactical`, and `voice`.
- Workers are all closed; orchestrators remain retained for manager-directed repairs. No integration workers were spawned. Do not shut down orchestrators or commit without authorization.
- Main-only integration fixes mean sibling branches/worktrees are behind main's integrated behavior. Do not overwrite main with another wholesale lane copy.

## Retained development process

Ports were free before launch; unrelated listeners were not killed or reused.

- Web: http://127.0.0.1:5173/
- API: http://127.0.0.1:4317/api/world
- Owned supervisor PID: `10703`; npm PID: `10710` (`npm run dev`).
- Observed web listener PID: `10799`; API listener PID: `10803`. Watcher child PIDs may change.
- Cwd: main worktree above.
- Bounded combined log: `/tmp/ember-command-dev-10703.log` (latest 65,536 bytes).
- Ownership metadata: `/tmp/ember-command-dev-10703.json`.
- Supervisor launch log: `/tmp/ember-command-dev-launch.nWcCzS`.
- Process is intentionally retained. The supervisor owns the spawned npm process group and forwards termination signals to that group. Do not kill unrelated Node processes.
- `env-1` did not restart this pre-bootstrap session or load any real `.env`. Restart the full npm process to adopt the new startup scripts and after editing provider settings. Do not restart into configured providers without the manager/user's intended live access.
- Startup succeeded. Vite warns about a pre-existing duplicate `noEmit` key in `apps/web/tsconfig.json`; left unchanged under the finalization no-code-change boundary.

## Run and provider configuration

```sh
npm ci
npm run dev
# Or API only:
npm start
```

With Node 24.10+, both root npm commands now use `apps/server/src/bootstrap.ts`, which loads the optional repository-root `.env` through Node's native `process.loadEnvFile` before dynamically importing server/provider code. `apps/server/src/env.ts` resolves the path from its module URL, not workspace cwd. Existing shell variables override file values; a missing file preserves fallback. Other file errors surface rather than silently ignoring bad setup.

From the repository root, use `cp .env.example .env` only if `.env` does not already exist, edit locally, then restart the full npm process. The file is not automatically watched. Do not use browser-prefixed credentials, source, command history, or chat. The loader runs only in the server process, not Vite. `.env` variants are ignored by Git; the blank seven-field `.env.example` is explicitly allowed. No real secret file or credential value was inspected, and no populated `.env` was created.

The earlier boolean-only inspection (not repeated in `env-1`, and not a check of any `.env` file) found all of these missing:

- `JEV_API_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`

`JEV_MODEL` is optional; the adapter defaults to `jev-latest`. `OPENAI_MODEL` must be an exact account-accessible model supporting Chat Completions, strict JSON-schema output and `max_completion_tokens`. No GPT model is guessed; requested labels `gpt6-astra` / `6.1-luna` are not verified provider IDs. Voice uses `scribe_v2_realtime` and `eleven_flash_v2_5`. Model/account access remains unverified.

No-key AI behavior is honestly labelled rules fallback. Voice is unavailable without configuration; typed input remains available. This is not completion of the hosted JEV -> GPT demo.

## Composition and main-only fixes

- `apps/server/src/index.ts` now starts `createRuntime()` through `createComposition()` and `createRoutes()`; no preview-only default.
- Composition owns 2.5-second assessment / 4-second planning cadence, bounded latest pending work, current context, approval-ID deduplication, report/provider/evidence publication and approved voice resolution. Physical stepping never waits for providers.
- Runtime candidates use newest regional reports and bounded unique actual observation targets, with a fair per-squad candidate budget. No target evidence is reconstructed from hidden dynamic cells.
- Identical human assignments pin the current mission without restarting execution. Run, epoch, mission version, resource and pin validation remain scheduler responsibilities.
- Assessment batches take newest retained observations first. Runtime retains bounded original local evidence for delayed reports.
- SSE skips replaceable world updates above a 1 MB backlog and disconnects above a 4 MB hard bound. World payloads contain no historical speech.
- Approved announcement IDs resolve only current-run/current-mission unexpired speech. Reset and changed mission versions invalidate audio.
- App owns selected IDs and target position, expands squad selections for the scene, and routes typed/voice input to the same orchestration path. `VoicePanel.connectionEpoch` clears listening/playback queues and discards old-connection replies on reconnect.
- Server dependency `@ember/sim`, its TS project reference and the workspace lockfile were updated in main.

## Accepted verification and repair history

No tests, test files, test tooling, broad suites or commits were added. Lane checks were accepted without redundant reruns. Actual integrated diffs were reviewed.

1. Root `npm run typecheck` passed **before the final focused runtime/SSE repairs**. It was not rerun afterward.
2. Initial inline HTTP/SSE rehearsal failed waiting for autonomous protection. Repair cycle 1 deduplicated/prioritized candidate evidence; its rerun failed when SSE exceeded the old backlog limit.
3. Repair cycle 2 adjusted SSE backpressure; the final focused rehearsal passed. No further verification or feature work followed.

The final rehearsal used actual scout travel, ignition and fire spread. It paused a locally sensed warm structure edge, allowed rules assessment and autonomous scheduler approval, submitted a typed human pin, then resumed physical execution. It did not inject reports, alter hidden heat or directly assign a mission to manufacture autonomy.

Observed PASS evidence:

- Four local source drones and 84 evidence observations.
- Rules high-risk report -> autonomous protection proposal -> accepted real mission.
- Typed human pin accepted; pre-human stale proposal rejected.
- 487 metres of physical travel; six protected cells; squad payload reduced to 0.75.
- Pause froze simulation time.
- SSE world/risk/announcement events arrived; world snapshots carried no historical speech.
- No-key audio failed clearly with HTTP 503.
- Reset created a new run, cleared reports, rejected old proposals and invalidated speech; old audio returned HTTP 404.
- All rehearsal servers, SSE streams and timers were cleaned up. The subsequently launched dev session above is the only intentionally retained integration process.

## env-1 configuration slice

Changed only `.gitignore`, new blank `.env.example`, server startup scripts plus new `bootstrap.ts`/`env.ts`, and README/HANDOFF. No dependency or lockfile change was needed. The existing `@ember/sim` dependency predates this slice.

One temporary harmless-fixture smoke passed: repository-root resolution remained correct from server-workspace and arbitrary cwd; native loading populated the fixture variable; shell priority was preserved; a nonexistent fixture file was tolerated; `.env`, `.env.local` and nested `.env` were ignored, while `.env.example` was allowed. The fixture was removed afterward. Actual startup/loader diffs were inspected. No real `.env` was read, no server was launched/restarted, no provider call was made, and no tests or commits were added. Current official Node 24 API documentation was consulted. Provider/model access remains unverified; no full build/typecheck was rerun for this slice. No workers were spawned, and the orchestrator remains available.

## Working tree and remaining limitations

Uncommitted changes cover authorized lane source trees, server composition/services/entry/routes, shared App/client/styles, server manifest/TS reference, lockfile, README/INTERFACES/HANDOFF and new feature helper/CSS/docs files. PAPERCUTS also records finalization's lsof syntax friction and the startup config warning. Contracts were not rewritten and no sibling worktrees were modified.

Browser rendering, camera usability, microphone permissions, audio playback, reconnect behavior in a browser, live JEV/GPT/ElevenLabs access and provider latency remain unverified. The final rehearsal was a controlled offline rules path, not a hosted-provider or broad behavioral check. Finite observation retention can evict evidence before a delayed report returns. This is a stylized simulation, not validated wildfire prediction or operational firefighting software.

Next action belongs to the manager: configure provider access securely and authorize any browser/live-provider rehearsal or repairs. Keep the integration orchestrator available; no further checks or commits are authorized by this handoff.
