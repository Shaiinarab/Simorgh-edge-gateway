import { DurableObject } from 'cloudflare:workers';
import { findModelBird } from './models';

// ==========================================
// Simorgh Flock — Multi-Provider Failover Core
// "Thirty birds discover they are the Simorgh."
// When one bird tires (rate-limit/error), the flock reroutes.
// ==========================================

// --- Shared message/tool shapes (kept structurally compatible with index.ts) ---
export type FlockRole = "system" | "user" | "assistant" | "tool";

export interface FlockMessage {
  role: FlockRole;
  content: string;
  name?: string;
}

export interface FlockTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required?: string[];
    };
  };
}

// Normalized tool call (OpenAI-style nested; the execute loop also reads flat).
export interface FlockToolCall {
  name?: string;
  arguments?: string | Record<string, unknown>;
  function?: { name: string; arguments: string | Record<string, unknown> };
}

// --- Environment the flock needs (subset of the Worker Env) ---
export interface FlockEnv {
  AI: { run: (model: string, opts: { messages: FlockMessage[]; tools?: FlockTool[] }) => Promise<{ response?: string; tool_calls?: FlockToolCall[] }> };
  FLOCK_COORDINATOR: DurableObjectNamespace;
  GROQ_API_KEY?: string;
  HF_TOKEN?: string;
}

// A single provider result, normalized.
export interface BirdCallResult {
  response?: string;
  tool_calls?: FlockToolCall[];
}

// A "bird" = one free-tier provider adapter.
export interface BirdSpec {
  id: string;
  label: string;           // mythic name for the dashboard
  model: string;
  priority: number;        // lower = tried first
  supportsTools: boolean;
  isAvailable: (env: FlockEnv) => boolean;   // key present (or none needed)
  // modelOverride: run a specific model on this bird instead of its default
  // (only passed to the bird that owns the chosen model; see runFlock).
  call: (env: FlockEnv, messages: FlockMessage[], tools: FlockTool[], modelOverride?: string) => Promise<BirdCallResult>;
}

// A thrown error the flock understands (lets us distinguish rate-limit backoff).
export class BirdError extends Error {
  isRateLimit: boolean;
  constructor(message: string, isRateLimit = false) {
    super(message);
    this.name = 'BirdError';
    this.isRateLimit = isRateLimit;
  }
}

// ==========================================
// OpenAI-compatible caller (shared by Groq + HuggingFace)
// ==========================================
async function callOpenAICompatible(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: FlockMessage[],
  tools: FlockTool[]
): Promise<BirdCallResult> {
  const body: Record<string, unknown> = { model, messages };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const isRateLimit = res.status === 429 || res.status === 402 || res.status === 503;
    const detail = await res.text().catch(() => '');
    throw new BirdError(`HTTP ${res.status}: ${detail.slice(0, 200)}`, isRateLimit);
  }

  const data = await res.json() as {
    choices?: { message?: { content?: string; tool_calls?: FlockToolCall[] } }[];
  };
  const message = data.choices?.[0]?.message;
  return {
    response: message?.content ?? undefined,
    tool_calls: message?.tool_calls,
  };
}

// ==========================================
// The Flock roster
// ==========================================
export const BIRDS: BirdSpec[] = [
  {
    id: 'shahin',
    label: 'Shāhīn (Groq)',
    model: 'llama-3.3-70b-versatile',
    priority: 10,
    supportsTools: true,
    isAvailable: (env) => !!env.GROQ_API_KEY,
    call: (env, messages, tools, modelOverride) =>
      callOpenAICompatible(
        'https://api.groq.com/openai/v1/chat/completions',
        env.GROQ_API_KEY as string,
        modelOverride || 'llama-3.3-70b-versatile',
        messages,
        tools
      ),
  },
  {
    id: 'bulbul',
    label: 'Bulbul (HuggingFace)',
    model: 'meta-llama/Llama-3.3-70B-Instruct',
    priority: 20,
    supportsTools: true,
    isAvailable: (env) => !!env.HF_TOKEN,
    call: (env, messages, tools, modelOverride) =>
      callOpenAICompatible(
        'https://router.huggingface.co/v1/chat/completions',
        env.HF_TOKEN as string,
        modelOverride || 'meta-llama/Llama-3.3-70B-Instruct',
        messages,
        tools
      ),
  },
  {
    id: 'homa',
    label: 'Homā (Cloudflare Workers AI)',
    model: '@cf/meta/llama-3.2-3b-instruct',
    priority: 30, // last resort, but ALWAYS present → guarantees zero-KYC operation
    supportsTools: true,
    isAvailable: () => true,
    call: async (env, messages, tools, modelOverride) => {
      try {
        const r = await env.AI.run(modelOverride || '@cf/meta/llama-3.2-3b-instruct', {
          messages,
          tools: tools.length > 0 ? tools : undefined,
        });
        return { response: r.response, tool_calls: r.tool_calls };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new BirdError(msg, /rate|limit|429|capacity/i.test(msg));
      }
    },
  },
];

// ==========================================
// FlockCoordinator — the Swarm-State hive memory (Durable Object)
// ==========================================
interface BirdHealthRow {
  id: string;
  status: string;
  consecutive_failures: number;
  cooldown_until: number;
  last_ok: number;
  total_calls: number;
  total_failures: number;
  [key: string]: SqlStorageValue;
}

export class FlockCoordinator extends DurableObject<FlockEnv> {
  constructor(state: DurableObjectState, env: FlockEnv) {
    super(state, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS bird_health (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'healthy',
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        cooldown_until INTEGER NOT NULL DEFAULT 0,
        last_ok INTEGER NOT NULL DEFAULT 0,
        total_calls INTEGER NOT NULL DEFAULT 0,
        total_failures INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  private ensureRow(id: string): void {
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO bird_health (id) VALUES (?)`,
      id
    );
  }

  // Return candidateIds (already in priority order) minus any bird still in cooldown.
  async pickRoute(candidateIds: string[]): Promise<string[]> {
    const now = Date.now();
    const healthy: string[] = [];
    for (const id of candidateIds) {
      this.ensureRow(id);
      const rows = [...this.ctx.storage.sql.exec<BirdHealthRow>(
        `SELECT cooldown_until FROM bird_health WHERE id = ?`, id
      )];
      const cooldownUntil = rows[0]?.cooldown_until ?? 0;
      if (cooldownUntil <= now) healthy.push(id);
    }
    return healthy;
  }

  async reportSuccess(id: string): Promise<void> {
    this.ensureRow(id);
    this.ctx.storage.sql.exec(
      `UPDATE bird_health
         SET status = 'healthy', consecutive_failures = 0, cooldown_until = 0,
             last_ok = ?, total_calls = total_calls + 1
       WHERE id = ?`,
      Date.now(), id
    );
  }

  async reportFailure(id: string, isRateLimit: boolean): Promise<void> {
    this.ensureRow(id);
    const now = Date.now();
    const rows = [...this.ctx.storage.sql.exec<BirdHealthRow>(
      `SELECT consecutive_failures FROM bird_health WHERE id = ?`, id
    )];
    const failures = (rows[0]?.consecutive_failures ?? 0) + 1;
    // Backoff: rate-limit rests a full minute; transient errors scale up to ~75s.
    const backoffMs = isRateLimit ? 60_000 : 15_000 * Math.min(failures, 5);
    this.ctx.storage.sql.exec(
      `UPDATE bird_health
         SET status = 'tired', consecutive_failures = ?, cooldown_until = ?,
             total_calls = total_calls + 1, total_failures = total_failures + 1
       WHERE id = ?`,
      failures, now + backoffMs, id
    );
  }

  async getFlockStatus(): Promise<BirdHealthRow[]> {
    return [...this.ctx.storage.sql.exec<BirdHealthRow>(
      `SELECT * FROM bird_health ORDER BY id`
    )];
  }
}

// ==========================================
// runFlock — orchestrate failover across the flock
// ==========================================
export interface FlockAttempt {
  birdId: string;
  ok: boolean;
  error?: string;
}

export interface FlockRunResult {
  response?: string;
  tool_calls?: FlockToolCall[];
  birdId: string;
  birdLabel: string;
  model: string;
  attempts: FlockAttempt[];
}

function getCoordinator(env: FlockEnv) {
  const id = env.FLOCK_COORDINATOR.idFromName('global');
  return env.FLOCK_COORDINATOR.get(id) as unknown as {
    pickRoute: (candidateIds: string[]) => Promise<string[]>;
    reportSuccess: (id: string) => Promise<void>;
    reportFailure: (id: string, isRateLimit: boolean) => Promise<void>;
    getFlockStatus: () => Promise<BirdHealthRow[]>;
  };
}

export async function runFlock(
  env: FlockEnv,
  messages: FlockMessage[],
  tools: FlockTool[],
  preferredModel?: string
): Promise<FlockRunResult> {
  const needsTools = tools.length > 0;

  // If a specific model was chosen, resolve which bird owns it. The override is
  // applied ONLY to that bird — every other bird keeps its own default model.
  const ownerBirdId = preferredModel ? findModelBird(preferredModel) : undefined;

  // 1. Candidates: available birds, tool-capable if tools requested, priority order.
  const candidates = BIRDS
    .filter(b => b.isAvailable(env))
    .filter(b => (needsTools ? b.supportsTools : true))
    .sort((a, b) => a.priority - b.priority);

  const candidateIds = candidates.map(b => b.id);

  // 2. Ask the hive which birds are awake. Fall back to raw order if DO is unreachable.
  const coordinator = getCoordinator(env);
  let route: string[];
  try {
    route = await coordinator.pickRoute(candidateIds);
    // If every bird is tired, don't give up — try them anyway (best-effort), Homā last.
    if (route.length === 0) route = candidateIds;
  } catch {
    route = candidateIds;
  }

  // 3. Honor the chosen model: fly the owning bird first (if it's awake in the
  //    route). Failover order is otherwise preserved, so a tired owner still
  //    reroutes to the rest of the flock.
  if (ownerBirdId && route.includes(ownerBirdId)) {
    route = [ownerBirdId, ...route.filter(id => id !== ownerBirdId)];
  }

  const attempts: FlockAttempt[] = [];

  // 4. Fly through the flock until one bird answers.
  for (const birdId of route) {
    const bird = candidates.find(b => b.id === birdId);
    if (!bird) continue;
    // Only the owner bird gets the override; others use their default model.
    const modelOverride = birdId === ownerBirdId ? preferredModel : undefined;
    try {
      const result = await bird.call(env, messages, tools, modelOverride);
      coordinator.reportSuccess(birdId).catch(() => {});
      attempts.push({ birdId, ok: true });
      return {
        response: result.response,
        tool_calls: result.tool_calls,
        birdId: bird.id,
        birdLabel: bird.label,
        model: modelOverride || bird.model,
        attempts,
      };
    } catch (e) {
      const isRateLimit = e instanceof BirdError ? e.isRateLimit : false;
      const msg = e instanceof Error ? e.message : String(e);
      coordinator.reportFailure(birdId, isRateLimit).catch(() => {});
      attempts.push({ birdId, ok: false, error: msg });
    }
  }

  // 4. The whole flock is resting.
  throw new BirdError('The entire flock is resting — all providers are tired or unavailable.', true);
}

export async function getFlockStatus(env: FlockEnv) {
  const coordinator = getCoordinator(env);
  const health = await coordinator.getFlockStatus().catch(() => [] as BirdHealthRow[]);
  const healthById = new Map(health.map(h => [h.id, h]));
  const now = Date.now();
  return BIRDS
    .sort((a, b) => a.priority - b.priority)
    .map(b => {
      const h = healthById.get(b.id);
      const cooldownUntil = h?.cooldown_until ?? 0;
      return {
        id: b.id,
        label: b.label,
        model: b.model,
        priority: b.priority,
        available: b.isAvailable(env),
        supportsTools: b.supportsTools,
        status: !b.isAvailable(env) ? 'dormant' : (cooldownUntil > now ? 'tired' : 'healthy'),
        cooldownRemainingMs: cooldownUntil > now ? cooldownUntil - now : 0,
        consecutiveFailures: h?.consecutive_failures ?? 0,
        totalCalls: h?.total_calls ?? 0,
        totalFailures: h?.total_failures ?? 0,
        lastOk: h?.last_ok ?? 0,
      };
    });
}
