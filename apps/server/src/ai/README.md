# Intelligence lane

Server-only simulation adapters. No engine mutation, HTTP routes, audio, or credentials in client DTOs.

## Integration

```ts
const ai = createIntelligence({
  definition: () => runtimeDefinition,
  getCurrentContext: () => latestPlanningContext,
  approveProposal: async (proposal, commandId, signal) => schedulerApply(proposal, commandId, signal),
});
const reports = await ai.assessment.assess(localObservations, signal);
const incidents = ai.fuseIncidents(reports, runId, currentSimSeconds);
const proposal = await ai.orchestrator.propose(contextWithReportsAndIncidents, signal);
// Never narrate proposal success. Scheduler validates/applies the entire batch here.
const { result, announcements } = await ai.approve(proposal, commandId, signal);
// Typed text and committed speech both use this same planner and approval seam:
const response = await ai.orchestrator.respond(context, operatorInput, signal);
```

The snippet's runtime/scheduler names are composition placeholders, not provided APIs. Existing `AssessmentModule` and `OrchestratorModule` signatures and unavailable exports remain intact. Factory also exports `status()`, `metrics()`, `invalidate()`, and `dispose()`. `ProviderConfig` supports injected fetch/configuration for offline demos without environment access.

`approveProposal` is the authority boundary: atomically revalidate run, epoch, mission versions, candidates, resources, pins and command-ID deduplication against live execution state. Accepted means assigned, not completed. Without this callback, `respond` explicitly reports that no action was applied. `propose` never applies anything. Announcement candidates are created only from accepted results with applied revision and mission IDs, never from proposed assignments. Composition must publish only current-run/current-mission announcements, drop expired items, and apply its speech cooldown. Do not replay old response announcements.

Pass a live `getCurrentContext` getter. Without it, stale checks see only the most recently submitted context, not independent runtime changes. Call `invalidate()` immediately on reset/run change or human intervention, then submit the new context/epoch. Use a definition getter when runs can change. Physical snapshot revisions alone do not invalidate plans. Changed decision epochs and relevant squad mission versions do. Scheduler checks remain mandatory.

Reports carry source observation/drone IDs, simulation sample time and a 15-simulation-second validity window. Call `fuseIncidents` with the **current simulation clock**, even if no new observation arrived, to show stale incidents. PlanningContext has no clock field: eligibility uses its latest observation/report timestamp, so runtime must prune expired candidate/report references with its current clock before planning and again at scheduling. Unknown areas never produce reports. Region grouping uses known static cells at observation centers, not dynamic ground truth; it does not claim every cell in a region was sensed. Delayed reports may reference earlier revision-specific observation IDs; AI eligibility checks report identity/freshness, not whether those observations remain in the latest sensor batch. Runtime must retain the actual same-run local evidence through report validity and use it to generate feasible targets. Missing evidence must not be reconstructed from hidden dynamic cells or invented positions.

Each assessment/planning stage has one in-flight job and one latest pending slot. Replaced callers reject, so runtime should treat superseded/aborted work as cancellation, not an outage. Operator work preempts planning; autonomous requests cannot replace operator work. Assessments use at most 96 recent observations, 12 regional requests, 256 submitted observations; planner exposes at most 128 candidates. Requests have a default 10-second timeout (configurable 100ms-30s), 200k-character request bound and 100k-byte response bound, no automatic retries, GPT combined reasoning/output cap 512 tokens by default (configurable; example uses 2048). Calls never block stepping. The runtime owns sampling/replan cadence. Metrics report request count, last duration and returned usage, not cost claims.

`keep_current`, `hold`, and safety `recall` are the only non-fire automatic choices. Rules and GPT select suppression only from fresh same-run `active_fire` reports linked to retained local observations whose `burning` value is true; high-risk/watch alone never dispatches suppression. All eight named groups share the same firefighter capability. Monitor requests can patrol a known static community centroid without treating that location as fire evidence. Typed and committed speech share the operator path: fight/suppress pins a feasible group to observed burning; monitor pins a centroid patrol; recall/resume use validated human runtime commands. Exact group/community matching accepts `Community2`, `Community 2`, and `Community-2` without confusing group Alpha with a neighborhood. Ambiguous multi-group/region actions request clarification; no-command outcomes are explicit. Human pins persist through return/refill and release only on explicit resume or actual suppression completion.

## Server environment

- `JEV_API_KEY`: TypeSafe bearer credential. Missing key means explicitly labelled `rules fallback`.
- `JEV_MODEL`: optional exact TypeSafe model identifier; default `jev-latest` is the officially documented alias.
- `OPENAI_API_KEY`: OpenAI bearer credential.
- `OPENAI_MODEL`: **required**, exact account-accessible model ID supporting Chat Completions, strict JSON-schema outputs and `max_completion_tokens`. No GPT default and no inference from coding-agent model labels. `gpt6-astra` and `6.1-luna` are not configured or assumed valid.

Additional wired Chat settings:

- `OPENAI_REASONING_EFFORT`: optional `none`, `low`, `medium`, `high`, `xhigh`, `max`; sent as `reasoning_effort`. The Luna example uses `low`. Model-specific support still applies.
- `OPENAI_SERVICE_TIER`: optional `auto`, `default`, `flex`, `priority`, `fast`; sent as `service_tier`. Omitted/blank is not sent and does not opt into premium Fast. The example explicitly requests `fast`; availability, actual serving tier and latency are not guaranteed. Returned-tier validation is not implemented here.
- `OPENAI_MAX_COMPLETION_TOKENS`: optional finite integer 1-32768; sent as `max_completion_tokens`. Omitted/blank retains 512; the example uses 2048. Hidden reasoning and visible JSON share this budget.

The corresponding injected `ProviderConfig` fields are `gptReasoningEffort`, `gptServiceTier`, and `gptMaxCompletionTokens`; both environment and injected settings are validated. Explicit non-stop completion reasons, including truncation, reject before parsing selection JSON. Strict response JSON schema remains; no function tools or sampling parameters are added.

The server bootstrap loads optional repository-root `.env`; shell variables take precedence. Copy `.env.example` only when no real `.env` exists, edit locally, and restart the full npm process deliberately after changes. Never paste credentials into source/chat, expose them to the browser, or use frontend-prefixed variables. No secret file was read during implementation. A configured status means configured, not verified account/model access; successful HTTP response and output validation are needed. Missing configuration, HTTP failure, invalid JSON/schema, refusal or invalid candidate selection uses honestly labelled deterministic fallback. Explicit abort/reset rejects rather than generating fallback work. `status()` exposes sanitized provider/fallback state only.

## Official HTTP references

- https://docs.typesafe.ai/api: `POST https://api.typesafe.ai/v1/systemone`, bearer auth, `{model,state,questions}`; choice questions use `type`, `instructions`, `criteria`; read `answers.risk.choice` and `confidence`, plus `usage`. Confidence is model certainty, not physical hazard probability.
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create: `POST https://api.openai.com/v1/chat/completions`, bearer auth, `model`, `messages`, `max_completion_tokens`, and `response_format: {type:'json_schema',json_schema:{name,strict,schema}}`; parse `choices[0].message.content`, reject refusals. Only candidate IDs are model output; response prose is grounded locally in current state or scheduler results.

Official TypeSafe content was fetched directly. The OpenAI reference blocked direct retrieval (403/404); official-domain search supplied the documented endpoint and fields. Model names in search-generated examples were not trusted or adopted. Account access, model compatibility, live provider latency/cost and a live JEV -> GPT roundtrip remain unverified. Required setup is usable server credentials and a verified OpenAI model ID, not secrets supplied to this lane.

Setup friction: this worktree initially lacked local `tsx`/TypeScript binaries; `npm ci --ignore-scripts --no-audit --no-fund` installed the frozen dependencies without manifest or lockfile changes.
