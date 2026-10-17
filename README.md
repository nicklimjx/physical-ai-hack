# Ember Command

Local-first wildfire response simulation prototype, not operational fire guidance. The server runs one authoritative physical simulation connected to the 3D scene, tactical/dashboard, asynchronous AI adapters and approved-ID voice synthesis. `apps/server/src/composition.ts` connects local observations, assessment, planning and scheduler approval without implementing a second engine.

## Run

```sh
npm ci
npm run dev
```

Web: http://127.0.0.1:5173 · API: http://127.0.0.1:4317. Root scripts run server and Vite together. `npm run typecheck` checks TypeScript project references. `npm start` starts only the simulation API. Open the Vite web URL for the dashboard when using `npm run dev`.

## Demo workflow and views

The local demo has 30 drones in six squads of five. Its shared 60 m/s cruise speed is stylised and separate from simulation-clock speed and fire spread. **Start Demo** unpauses while preserving the selected clock speed and arms a one-time-per-run schedule: physical ignitions at simulation-time offsets 0, 12, and 28 seconds near (480, 460), (960, 300), and (960, 920). Reset creates a new run and clears the pending schedule. These ignitions do not invent observations or report success.

Natural shows the simulation ground truth. Thermal visualizes actual simulated cell heat; it is not real thermal imagery. JEV view shows known static land classes and a **rules-derived map-prior** based only on mapped terrain/fuel/buildings/water counts and weather. No hosted prior-model call is made. The prior is separate from actual same-run JEV or local-rules observation reports and is never sent to the planner as observed evidence. Unreported areas remain observationally unknown; mapped water is not optical detection.

Latest verification note: root typecheck passed before the final compactness/inert UI edits. The bounded offline causal smoke verified 30 drones, six squads of five, 60 m/s displacement, Start Demo latching/speed preservation, a rules report linked to actual local observations, an auto-sourced scheduler assignment, immediate/+12-second ignitions, and pause freeze. That run timed out at simulation time 28.0 before its final checkpoint. A separate bounded offline timeline guard then passed: the third scheduled fire was observed by simulation time 29, and reset created a new run with no stale scheduled fires through simulation time 31. No single full causal smoke pass or browser visual check is claimed.

## Server provider configuration

Use Node 24.10+ (the current development runtime supports native environment-file loading). From the repository root:

```sh
cp .env.example .env
# Edit .env locally, then start or restart the npm process:
npm run dev
# Or API only: npm start
```

Do not overwrite an existing `.env` when copying the example. Both commands load the optional repository-root `.env` in the server process before provider initialization, regardless of workspace cwd. Existing shell variables override file values. A missing file preserves the labelled no-key fallback. Restart the full npm process after edits; env-file changes are not automatically watched. The retained development session was restarted through this bootstrap after the autonomy/UI update.

Loading is server-only; the Vite process does not receive the file's variables. Never add `VITE_` credentials or import the server loader into browser code. `.env` variants are gitignored; only the credential-free `.env.example` is intended for version control. Never put credentials in source, terminal command history, or chat. Native API reference: https://nodejs.org/docs/latest-v24.x/api/process.html#processloadenvfilepath.

- `JEV_API_KEY`; optional `JEV_MODEL` (adapter default `jev-latest`).
- `OPENAI_API_KEY` and `OPENAI_MODEL`, an exact account-accessible model supporting Chat Completions, strict JSON-schema output and `max_completion_tokens`. No GPT default is guessed.
- `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`. Voice uses `scribe_v2_realtime` for transcription and `eleven_flash_v2_5` for TTS.

The example now includes this explicit Luna configuration (API keys stay blank):

```dotenv
OPENAI_MODEL=gpt-6-luna
OPENAI_REASONING_EFFORT=low
OPENAI_SERVICE_TIER=fast
OPENAI_MAX_COMPLETION_TOKENS=2048
```

These settings are wired into Chat Completions, not just example placeholders. Effort accepts `none`, `low`, `medium`, `high`, `xhigh`, `max`; tier accepts `auto`, `default`, `flex`, `priority`, `fast`; the combined reasoning/visible completion budget accepts integers 1-32768. Model-specific compatibility still applies. Blank/omitted effort and tier are not sent, so omitting the tier does not opt into premium Fast; the omitted token budget retains the existing 512 default. Invalid settings fail configuration without printing their values.

Fast is a premium processing request, not guaranteed access, latency or an observed serving tier. This adapter does not yet validate the returned tier. The sample's 2048-token budget is a starting point, not a measured requirement; hidden reasoning consumes it too. Strict JSON-schema selection stays enabled, and truncated completions are rejected. Restart the full npm process deliberately after edits; this change does not modify a real `.env` or authorize billed calls.

Missing AI configuration uses explicitly labelled rules fallback. Missing voice configuration leaves speech unavailable and typed input available. Configured does not mean verified account/model access. Every group is a four-drone firefighter unit: automatic suppression requires a fresh same-run report linked to a retained local burning observation; monitor is a patrol behavior, not a separate hardware class. Typed and spoken group commands share the operator path. The earlier offline rehearsal covered a superseded protection-first flow; this firefighter-only update requires its own final offline causal verification. Live provider access and browser rendering/microphone/audio remain unverified.

## Ownership and contract freeze

Read `INTERFACES.md` before implementing feature lanes. Integrator owns contracts, root manifests/lockfile, `apps/server/src/index.ts`, `apps/server/src/routes.ts`, shared client, `apps/web/src/App.tsx`, and shared styles. Simulation, runtime, AI, scene, tactical/dashboard, and voice lanes own their corresponding feature folders only. Propose boundary/dependency changes to the integrator first. `reloadPreview` only reloads fixture data; it does not reset a simulation run. No tests or real provider credentials are part of this bootstrap. Never present fixture data or UI as validated fire prediction or real autonomous response.
