# Ember Command

Local-first wildfire response **preview scaffold**. The current server serves immutable-style shared fixtures; there is no simulation engine, provider integration, voice implementation, or operational fire guidance. Commands and operator input validate but are explicitly unavailable in preview. The scene is a lightweight 2D fixture presentation; Three.js dependencies are ready for a later scene lane.

## Run

```sh
npm install
npm run dev
```

Web: http://127.0.0.1:5173 · API: http://127.0.0.1:4317. Root scripts run server and Vite together. `npm run typecheck` checks TypeScript project references. `npm start` starts only the fixture server.

## Ownership and contract freeze

Read `INTERFACES.md` before implementing feature lanes. Integrator owns contracts, root manifests/lockfile, `apps/server/src/index.ts`, `apps/server/src/routes.ts`, shared client, `apps/web/src/App.tsx`, and shared styles. Simulation, runtime, AI, scene, tactical/dashboard, and voice lanes own their corresponding feature folders only. Propose boundary/dependency changes to the integrator first. `reloadPreview` only reloads fixture data; it does not reset a simulation run. No tests or real provider credentials are part of this bootstrap. Never present fixture data or UI as validated fire prediction or real autonomous response.
