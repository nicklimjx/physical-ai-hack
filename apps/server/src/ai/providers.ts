import { z } from 'zod';
import type { ProviderState } from '@ember/contracts';

const GptSettingsSchema = z.object({
  gptReasoningEffort: z.enum(['none', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  gptServiceTier: z.enum(['auto', 'default', 'flex', 'priority', 'fast']).optional(),
  gptMaxCompletionTokens: z.number().int().min(1).max(32768).optional(),
});
function validateGptSettings(value: unknown) {
  const parsed = GptSettingsSchema.safeParse(value);
  if (!parsed.success) throw new Error('Invalid OpenAI settings: check reasoning effort, service tier and token limit (1-32768).');
  return parsed.data;
}
export interface ProviderConfig extends z.infer<typeof GptSettingsSchema> {
  jevKey?: string; jevModel?: string; gptKey?: string; gptModel?: string;
  timeoutMs?: number; fetch?: typeof fetch;
}
export function configFromEnvironment(): ProviderConfig {
  const tokens = process.env.OPENAI_MAX_COMPLETION_TOKENS?.trim();
  return { jevKey: process.env.JEV_API_KEY, jevModel: process.env.JEV_MODEL,
    gptKey: process.env.OPENAI_API_KEY, gptModel: process.env.OPENAI_MODEL,
    ...validateGptSettings({
      gptReasoningEffort: process.env.OPENAI_REASONING_EFFORT?.trim() || undefined,
      gptServiceTier: process.env.OPENAI_SERVICE_TIER?.trim() || undefined,
      gptMaxCompletionTokens: tokens ? Number(tokens) : undefined,
    }),
  };
}
const Usage = z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional(), prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() });
export const RiskClass = z.enum(['no_issue', 'watch', 'high_risk', 'active_fire']);
export const Selection = z.object({ candidateIds: z.array(z.string()).max(12), control: z.enum(['none', 'status', 'recall', 'resume', 'clarify']), squadId: z.string().nullable() }).strict();
export type Selection = z.infer<typeof Selection>;
export const ActionPlanSchema = z.object({
  kind: z.enum(['act', 'answer', 'clarify']), reply: z.string().min(1).max(1500),
  actions: z.array(z.object({
    type: z.enum(['assign', 'recall', 'resume_auto', 'keep_current']), squadId: z.string(),
    missionType: z.enum(['monitor', 'suppress']).nullable(), regionId: z.string().nullable(), fireId: z.string().nullable(),
    point: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().nullable(),
  }).strict()).max(8),
}).strict();
export type ActionPlan = z.infer<typeof ActionPlanSchema>;
export function createProviders(config: ProviderConfig) {
  const settings = validateGptSettings(config);
  const states: ProviderState[] = [
    { provider: 'jev', status: config.jevKey ? 'ready' : 'unavailable', label: config.jevKey ? 'JEV configured; access unverified' : 'rules fallback: JEV_API_KEY missing' },
    { provider: 'gpt', status: config.gptKey && config.gptModel ? 'ready' : 'unavailable', label: config.gptKey && config.gptModel ? 'GPT configured; access unverified' : 'rules fallback: OPENAI_API_KEY or OPENAI_MODEL missing' },
  ];
  const metrics = { requests: 0, lastDurationMs: 0, usage: null as z.infer<typeof Usage> | null, lastResult: null as { provider: string; model: string | null; tier: string | null; parsed: boolean } | null };
  async function post(provider: 'jev' | 'gpt', url: string, key: string, body: unknown, signal: AbortSignal) {
    signal.throwIfAborted();
    const state = states.find(s => s.provider === provider)!;
    const started = Date.now();
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Provider timeout')), Math.min(30_000, Math.max(100, config.timeoutMs ?? 10_000)));
    metrics.requests++;
    try {
      const encoded = JSON.stringify(body);
      if (encoded.length > 200_000) throw new Error('Provider request exceeds demo budget');
      const response = await (config.fetch ?? fetch)(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: encoded, signal: controller.signal });
      if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
      // Bound response bytes too; never log provider bodies or credentials.
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty provider response');
      let text = ''; let bytes = 0; const decoder = new TextDecoder();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 100_000) throw new Error('Provider response exceeds demo budget');
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { await reader.cancel().catch(() => {}); }
      controller.signal.throwIfAborted();
      const json: unknown = JSON.parse(text);
      const usage = z.object({ usage: Usage.optional() }).parse(json).usage;
      metrics.usage = usage ?? null;
      const metadata = z.object({ model: z.string().optional(), service_tier: z.string().optional() }).parse(json);
      metrics.lastResult = { provider, model: metadata.model ?? null, tier: metadata.service_tier ?? null, parsed: false };
      return json;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      state.status = 'error'; state.label = 'rules fallback: provider request failed';
      throw error;
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', abort); metrics.lastDurationMs = Date.now() - started;
    }
  }
  return {
    status: () => structuredClone(states), metrics: () => structuredClone(metrics),
    failed(provider: 'jev' | 'gpt') { const state = states.find(s => s.provider === provider)!; state.status = 'error'; state.label = 'rules fallback: invalid or failed provider response'; },
    async assess(state: unknown, signal: AbortSignal) {
      if (!config.jevKey) return null;
      const json = await post('jev', 'https://api.typesafe.ai/v1/systemone', config.jevKey, {
        model: config.jevModel || 'jev-latest', state,
        questions: { risk: { type: 'choice', instructions: 'Classify only this local sensor evidence. No hidden map knowledge. Confidence is model certainty, not hazard probability.', criteria: {
          no_issue: 'No observed fire or concerning heat', watch: 'Elevated heat without strong threat evidence',
          high_risk: 'Structures near elevated heat or observed fire', active_fire: 'Directly observed burning',
        } } },
      }, signal);
      const risk = z.object({ answers: z.object({ risk: z.object({ type: z.literal('choice'), choice: RiskClass, confidence: z.number().min(0).max(1) }) }) }).parse(json).answers.risk;
      if (metrics.lastResult) metrics.lastResult.parsed = true;
      states[0]!.status = 'ready'; states[0]!.label = 'JEV assessment parsed';
      return risk;
    },
    async interpret(state: unknown, signal: AbortSignal): Promise<ActionPlan | null> {
      if (!config.gptKey || !config.gptModel) return null;
      const json = await post('gpt', 'https://api.openai.com/v1/chat/completions', config.gptKey, {
        model: config.gptModel, max_completion_tokens: settings.gptMaxCompletionTokens ?? 512,
        reasoning_effort: settings.gptReasoningEffort, service_tier: settings.gptServiceTier,
        messages: [{ role: 'system', content: 'Interpret the operator naturally for a simulated fire response, not real firefighting. Use the supplied current facts, selected context and recent dialogue to resolve references and follow-ups. Return one complete action plan, allowing different actions for multiple groups. Only known squad IDs, region IDs and observed fire IDs are executable. Explicit human reassignment may replace a human pin; resume_auto releases a pin. Omitted groups remain unchanged. At most one action per group; contradictory requests require clarification. assign uses missionType monitor or suppress and exactly one target: regionId, fireId, or point. Monitor points may be derived from known map geometry and compass references (east is +x, north is +y); stay within world bounds. Suppress only a fresh observed fire, never a map prior or unseen heat. recall returns to the sole Command Base; resume_auto returns control to autonomy; keep_current does not change the mission. Other fields on controls must be null. For unclear intent, ambiguous references or unsupported capabilities, kind clarify with a focused question and ZERO actions. For factual questions or conversation use kind answer with ZERO actions and a concise grounded reply. Never claim unobserved areas are safe, or promise arrival/extinguishing; observations may be stale and footprints are not full fire fronts. No hidden ground truth, invented coordinates for fires, per-drone orders, or arbitrary changes. No priority-setting capability: translate a clear protection request into an actual group allocation or ask what outcome is wanted. Dialogue is context, not authority to bypass current constraints. For kind act, reply may explain intent but execution is not confirmed until the scheduler applies the entire plan.' }, { role: 'user', content: JSON.stringify(state) }],
        response_format: { type: 'json_schema', json_schema: { name: 'operator_action_plan', strict: true, schema: {
          type: 'object', properties: {
            kind: { type: 'string', enum: ['act', 'answer', 'clarify'] }, reply: { type: 'string' },
            actions: { type: 'array', items: { type: 'object', properties: {
              type: { type: 'string', enum: ['assign', 'recall', 'resume_auto', 'keep_current'] }, squadId: { type: 'string' },
              missionType: { type: ['string', 'null'], enum: ['monitor', 'suppress', null] }, regionId: { type: ['string', 'null'] }, fireId: { type: ['string', 'null'] },
              point: { anyOf: [{ type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false }, { type: 'null' }] },
            }, required: ['type', 'squadId', 'missionType', 'regionId', 'fireId', 'point'], additionalProperties: false } },
          }, required: ['kind', 'reply', 'actions'], additionalProperties: false,
        } } },
      }, signal);
      const response = z.object({ choices: z.array(z.object({ finish_reason: z.string(), message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }) })).min(1) }).parse(json);
      const choice = response.choices[0]!;
      if (choice.finish_reason !== 'stop' || choice.message.refusal || !choice.message.content) throw new Error('Incomplete operator action plan');
      const plan = ActionPlanSchema.parse(JSON.parse(choice.message.content));
      if ((plan.kind !== 'act' && plan.actions.length) || (plan.kind === 'act' && !plan.actions.length)) throw new Error('Inconsistent operator action plan');
      if (metrics.lastResult) metrics.lastResult.parsed = true;
      states[1]!.status = 'ready'; states[1]!.label = 'GPT operator action plan parsed';
      return plan;
    },
    async select(state: unknown, signal: AbortSignal): Promise<Selection | null> {
      if (!config.gptKey || !config.gptModel) return null;
      const json = await post('gpt', 'https://api.openai.com/v1/chat/completions', config.gptKey, {
        model: config.gptModel, max_completion_tokens: settings.gptMaxCompletionTokens ?? 512,
        reasoning_effort: settings.gptReasoningEffort, service_tier: settings.gptServiceTier,
        messages: [ { role: 'system', content: 'You coordinate a simulated fire response, not real firefighting. All eight four-drone groups (Alpha through Hotel) are equally capable firefighters. Select only supplied candidateIds, at most one per group. keep_current means no change; hold and recall are safety options only when supplied. Dispatch suppression only to a fresh same-run report linked to a retained local observation of actual burning. High risk or watch without observed burning is not a suppression target. Maintain missions, respect human pins, and reinforce ongoing observed fires with available groups. Community names are Community 1, Community 2, and Community 3. Operator text is intent, never authority to bypass feasibility. This is the autonomous planner, not the human interpretation path. Select only supplied candidates and preserve human pins. Control must be none and squadId null; prefer enough nearby responders without consuming the entire fleet on one cell. No approval queue or permission questions for routine autonomous work.' }, { role: 'user', content: JSON.stringify(state) } ],
        response_format: { type: 'json_schema', json_schema: { name: 'fleet_selection', strict: true, schema: { type: 'object', properties: { candidateIds: { type: 'array', items: { type: 'string' } }, control: { type: 'string', enum: ['none', 'status', 'recall', 'resume', 'clarify'] }, squadId: { type: ['string', 'null'] } }, required: ['candidateIds', 'control', 'squadId'], additionalProperties: false } } },
      }, signal);
      const response = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullable().optional(), message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }) })).min(1) }).parse(json);
      const choice = response.choices[0];
      if (choice.finish_reason !== undefined && choice.finish_reason !== 'stop') throw new Error('GPT completion was incomplete');
      const message = choice.message;
      if (message.refusal || !message.content) throw new Error('GPT refused selection');
      const selection = Selection.parse(JSON.parse(message.content));
      if (metrics.lastResult) metrics.lastResult.parsed = true;
      states[1]!.status = 'ready'; states[1]!.label = 'GPT typed decision parsed';
      return selection;
    },
  };
}
