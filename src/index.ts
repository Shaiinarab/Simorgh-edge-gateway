import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { DurableObject } from 'cloudflare:workers';
import { runFlock, getFlockStatus, FlockCoordinator } from './flock';
import { getModelCatalog, isKnownModel } from './models';
import { DASHBOARD_HTML } from './dashboard';

// Re-export the Swarm-State hive-memory Durable Object so wrangler can bind it.
export { FlockCoordinator };

// ==========================================
// 1. Strict Type Definitions (Robust for CF AI)
// ==========================================

interface ToolDefinition {
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

// Robust interface to handle both nested (OpenAI-style) and flat (CF-native) tool calls
interface ToolCall {
  name?: string;
  arguments?: string | Record<string, unknown>;
  function?: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
}

interface AiResponse {
  response?: string;
  tool_calls?: ToolCall[];
}

type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
};

interface CloudflareAI {
  run: (model: string, options: { messages: Message[]; tools?: ToolDefinition[] }) => Promise<AiResponse>;
}

export interface Env {
  DATA_TRUST_VAULT: DurableObjectNamespace;
  FLOCK_COORDINATOR: DurableObjectNamespace;
  AI: CloudflareAI;
  CONTEXT_STORE: KVNamespace;
  // Optional free-tier provider keys — birds stay dormant until a key is set.
  GROQ_API_KEY?: string;
  HF_TOKEN?: string;
  // Reserved for a future live Workers AI catalog fetch (curated list is default).
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
}

type UserTier = 'Free-Volunteer' | 'Pro-Paid' | 'Pro-Data-Pact';

interface AgentRequest {
  prompt: string;
  tools: string[];
  userId: string;
  tier: UserTier;
  // Optional: pick a specific model to fly the agent (validated against the
  // registry). Ignored if unknown; the flock falls back to its default routing.
  model?: string;
}

interface OffloadedContext {
  contextRefId: string;
  originalPayloadSizeBytes: number;
}

type Variables = {
  offloadedContext: OffloadedContext;
  originalPayload: Pick<AgentRequest, 'prompt' | 'tools'>;
  requiresDataLogging: boolean;
};

interface VaultRPC {
  logInteraction: (userId: string, payloadHash: string, tier: UserTier) => Promise<{ success: boolean; recordId: string }>;
  getUserLogs: (userId: string) => Promise<any[]>;
}

// ==========================================
// 2. Tool Definitions
// ==========================================

const AVAILABLE_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web for real-time information based on a query.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query string"
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_server_time",
      description: "Get the current server time in ISO 8601 format.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  }
];

const ALLOWED_TOOL_NAMES = AVAILABLE_TOOLS.map(t => t.function.name);

// ==========================================
// 3. Durable Object: Native SQLite Vault
// ==========================================

export class DataTrustVault extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS interaction_ledger (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        tier TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_id ON interaction_ledger(user_id)
    `);
  }

  async logInteraction(userId: string, payloadHash: string, tier: UserTier): Promise<{ success: boolean; recordId: string }> {
    const timestamp = Date.now();
    const recordId = crypto.randomUUID();
    
    this.ctx.storage.sql.exec(
      `INSERT INTO interaction_ledger (id, user_id, payload_hash, tier, created_at) VALUES (?, ?, ?, ?, ?)`,
      recordId, userId, payloadHash, tier, timestamp
    );

    return { success: true, recordId };
  }

  async getUserLogs(userId: string): Promise<any[]> {
    const cursor = this.ctx.storage.sql.exec(
      `SELECT id, payload_hash, tier, created_at FROM interaction_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      userId
    );
    return [...cursor];
  }
}

// ==========================================
// 4. Utility Functions
// ==========================================

async function generatePayloadHash(payload: string): Promise<string> {
  const data = new TextEncoder().encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Real, no-KYC web search via the DuckDuckGo Instant Answer API (no key, no card).
// Degrades gracefully: prefers a concise abstract, then answer/definition, then topics.
async function realWebSearch(query: string): Promise<string> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'SimorghGateway/1.0 (+https://github.com/simorgh)' } });
    if (!res.ok) return `Web search unavailable (HTTP ${res.status}) for "${query}".`;
    const data = await res.json() as {
      Heading?: string; AbstractText?: string; AbstractURL?: string;
      Answer?: string; Definition?: string; DefinitionURL?: string;
      RelatedTopics?: { Text?: string }[];
    };
    if (data.AbstractText) {
      const src = data.AbstractURL ? ` (source: ${data.AbstractURL})` : '';
      return `${data.Heading ? data.Heading + ': ' : ''}${data.AbstractText}${src}`;
    }
    if (data.Answer) return String(data.Answer);
    if (data.Definition) {
      const src = data.DefinitionURL ? ` (source: ${data.DefinitionURL})` : '';
      return `${data.Definition}${src}`;
    }
    const topics = (data.RelatedTopics || [])
      .map(t => t?.Text)
      .filter((t): t is string => !!t)
      .slice(0, 3);
    if (topics.length) return `Top results for "${query}":\n- ${topics.join('\n- ')}`;
    return `No concise answer found for "${query}".`;
  } catch (e) {
    return `Web search failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// Guard against the small-model failure mode where a tool-call-shaped JSON blob is
// emitted as the final text answer instead of natural language (the raw-JSON leak).
function looksLikeRawToolJson(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return false;
  return /"(output|name|arguments|tool_call|tool_calls|function)"\s*:/.test(t);
}

// ==========================================
// 5. Hono App & Middleware Chain
// ==========================================

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// CORS so Mission Control works whether served from this Worker (same origin)
// or hosted externally (e.g. GitHub Pages) pointing at the public Worker URL.
app.use('/api/v1/*', cors());

app.use('/api/v1/agent/execute', async (c, next) => {
  const body = await c.req.json<AgentRequest>();
  const originalPayloadObj = { prompt: body.prompt, tools: body.tools };
  const originalPayloadString = JSON.stringify(originalPayloadObj);
  const originalPayloadSizeBytes = new TextEncoder().encode(originalPayloadString).length;
  const contextRefId = `ctx_${crypto.randomUUID()}`;
  
  const kvData = {
    payload: originalPayloadObj,
    meta: { userId: body.userId, tier: body.tier, timestamp: Date.now() }
  };
  
  await c.env.CONTEXT_STORE.put(contextRefId, JSON.stringify(kvData));

  c.set('offloadedContext', { contextRefId, originalPayloadSizeBytes });
  c.set('originalPayload', originalPayloadObj);
  await next();
});

app.use('/api/v1/agent/execute', async (c, next) => {
  const body = await c.req.json<AgentRequest>();
  c.set('requiresDataLogging', body.tier === 'Pro-Data-Pact');
  await next();
});

// ==========================================
// 6. Main Routing Endpoint with Robust Tool Execution Loop
// ==========================================

app.post('/api/v1/agent/execute', async (c) => {
  try {
    const body = await c.req.json<AgentRequest>();
    const { contextRefId, originalPayloadSizeBytes } = c.get('offloadedContext');
    const originalPayload = c.get('originalPayload');
    const requiresDataLogging = c.get('requiresDataLogging');

    // 1. Pre-flight Intent Shield
    if (!body.tools.every(tool => ALLOWED_TOOL_NAMES.includes(tool))) {
      throw new HTTPException(403, { message: 'Intent Shield blocked: Unsafe or unsupported tool requested.' });
    }

    const payloadHash = await generatePayloadHash(JSON.stringify(originalPayload));

    if (requiresDataLogging) {
      const vaultId = c.env.DATA_TRUST_VAULT.idFromName(`vault_${body.userId}`);
      const vaultStub = c.env.DATA_TRUST_VAULT.get(vaultId) as unknown as VaultRPC;
      await vaultStub.logInteraction(body.userId, payloadHash, body.tier);
    }

    // 2. Prepare Messages and Tools
    let messages: Message[] = [
      { role: "system", content: "You are Simorgh, an edge-native AI agent. Use tools when necessary to answer accurately. Be concise." },
      { role: "user", content: body.prompt }
    ];

    const activeTools = AVAILABLE_TOOLS.filter(t => body.tools.includes(t.function.name));

    // Honor a chosen model only if it's in the registry (allow-list). Unknown or
    // absent → undefined, so the flock uses its normal default routing.
    const preferredModel = body.model && isKnownModel(body.model) ? body.model : undefined;

    let finalResponse = "";
    let iteration = 0;
    const MAX_ITERATIONS = 3;
    let answeringBird = { id: 'none', label: 'none', model: 'none' };
    const flockAttempts: unknown[] = [];

    // 3. The Execution Loop
    while (iteration < MAX_ITERATIONS) {
      // The Flock: try each free-tier bird in turn, rerouting past any that are tired.
      const flight = await runFlock(c.env, messages, activeTools, preferredModel);
      answeringBird = { id: flight.birdId, label: flight.birdLabel, model: flight.model };
      flockAttempts.push(...flight.attempts);
      const response = { response: flight.response, tool_calls: flight.tool_calls };

      // 4. Check for Tool Calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        for (const toolCall of response.tool_calls) {
          
          // ROBUST EXTRACTION: Handle both nested (OpenAI-style) and flat (CF-native) formats
          const toolName = toolCall.function?.name || toolCall.name;
          const rawArgs = toolCall.function?.arguments || toolCall.arguments;

          if (!toolName) continue; // Skip invalid tool calls safely
          
          // Safety: Double-check AI didn't hallucinate a tool
          if (!ALLOWED_TOOL_NAMES.includes(toolName)) {
            throw new HTTPException(400, { message: `Unauthorized Tool Invocation: ${toolName}` });
          }

          // Execute the tool
          let toolResult = "";
          try {
            // Safely parse arguments whether they are string or object
            const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs || {});
            
            if (toolName === "search_web") {
              toolResult = await realWebSearch(String(args.query ?? ''));
            } else if (toolName === "get_server_time") {
              toolResult = new Date().toISOString();
            } else {
              toolResult = "Tool execution failed: Unknown tool.";
            }
          } catch (parseError) {
            toolResult = `Tool execution failed: Invalid arguments. ${parseError}`;
          }

          // Append tool result to messages
          messages.push({
            role: "tool",
            content: toolResult,
            name: toolName
          });
        }
        iteration++;
      } else {
        // No more tool calls. Guard against the raw-tool-JSON leak: if the model emitted
        // tool-shaped JSON (or nothing) instead of prose, force a clean synthesis pass
        // with tools disabled so it answers in natural language using prior tool results.
        const text = (response.response || "").trim();
        if (text && !looksLikeRawToolJson(text)) {
          finalResponse = text;
        } else {
          const synth = await runFlock(
            c.env,
            [...messages, { role: "system", content: "Using the information and tool results above, answer the user's question in clear, natural language. Do not output JSON, code, or tool calls." }],
            [],
            preferredModel
          );
          answeringBird = { id: synth.birdId, label: synth.birdLabel, model: synth.model };
          flockAttempts.push(...synth.attempts);
          finalResponse = (synth.response || "").trim() || "The agent completed the task without a text response.";
        }
        break;
      }
    }

    if (iteration >= MAX_ITERATIONS && !finalResponse) {
      // Ran out of tool iterations without a clean answer — synthesize one, tools disabled.
      const synth = await runFlock(
        c.env,
        [...messages, { role: "system", content: "Using the information and tool results above, answer the user's question in clear, natural language. Do not output JSON, code, or tool calls." }],
        [],
        preferredModel
      );
      answeringBird = { id: synth.birdId, label: synth.birdLabel, model: synth.model };
      flockAttempts.push(...synth.attempts);
      finalResponse = (synth.response || "").trim() || "The agent reached the maximum number of tool execution iterations.";
    }

    return c.json({
      success: true,
      meta: { 
        contextRefId, 
        originalPayloadSizeBytes, 
        payloadHash, 
        loggedToLedger: requiresDataLogging,
        ai_model: answeringBird.model,
        answered_by: answeringBird.label,
        bird_id: answeringBird.id,
        provider: 'Simorgh Flock (multi-provider free-tier failover)',
        flock_attempts: flockAttempts,
        storage: 'Cloudflare KV (Context Offloaded)',
        tool_iterations: iteration
      },
      agentResponse: finalResponse
    });

  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status);
    }
    console.error('[Simorgh Gateway] Critical Error:', error);
    return c.json({ error: 'Internal Gateway Error' }, 500);
  }
});

// ==========================================
// 7. Context Retrieval Endpoint
// ==========================================
app.get('/api/v1/context/:refId', async (c) => {
  const refId = c.req.param('refId');
  const storedString = await c.env.CONTEXT_STORE.get(refId);
  
  if (!storedString) {
    return c.json({ error: 'Context not found in KV', searched_refId: refId }, 404);
  }

  const parsedData = JSON.parse(storedString);
  return c.json({ success: true, refId, metadata: parsedData.meta, retrievedPayload: parsedData.payload });
});

// Transparency Endpoint
app.get('/api/v1/user/:userId/logs', async (c) => {
  const userId = c.req.param('userId');
  const vaultId = c.env.DATA_TRUST_VAULT.idFromName(`vault_${userId}`);
  const vaultStub = c.env.DATA_TRUST_VAULT.get(vaultId) as unknown as VaultRPC;
  const logs = await vaultStub.getUserLogs(userId);
  return c.json({ userId, totalInteractions: logs.length, logs });
});

// ==========================================
// 8. Flock Status Endpoint (Swarm-State transparency)
// ==========================================
app.get('/api/v1/flock/status', async (c) => {
  const birds = await getFlockStatus(c.env);
  return c.json({
    flock: 'Simorgh',
    awake: birds.filter(b => b.status === 'healthy').length,
    total: birds.length,
    birds
  });
});

// ==========================================
// 8b. Model Registry (Auto-Wrapper) — the catalog the console picks from
// ==========================================
app.get('/api/v1/models', (c) => {
  return c.json(getModelCatalog(c.env));
});

// ==========================================
// 9. Mission Control dashboard (self-contained, served from the edge)
// ==========================================
app.get('/dashboard', (c) => c.html(DASHBOARD_HTML));

app.get('/', (c) => c.text('Simorgh Agentic OS Edge Gateway is soaring.'));

export default app;
