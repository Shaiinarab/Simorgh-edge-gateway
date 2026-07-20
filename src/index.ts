// src/index.ts
import { Hono } from 'hono';
import { DurableObject } from 'cloudflare:workers';

// ==========================================
// 1. Strict Type Definitions
// ==========================================

export interface Env {
  DATA_TRUST_VAULT: DurableObjectNamespace;
  AI: any; // Native Cloudflare Workers AI binding
}

type UserTier = 'Free-Volunteer' | 'Pro-Paid' | 'Pro-Data-Pact';

interface AgentRequest {
  prompt: string;
  tools: string[];
  userId: string;
  tier: UserTier;
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
// 2. Durable Object: Native SQLite Vault
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
// 3. Utility Functions (Pure Web Standards)
// ==========================================

async function generatePayloadHash(payload: string): Promise<string> {
  const data = new TextEncoder().encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function intentShield(tools: string[]): boolean {
  const blacklistedTools = ['delete_production_db', 'bypass_auth', 'execute_shell'];
  return !tools.some(tool => blacklistedTools.includes(tool));
}

// ==========================================
// 4. Hono App & Middleware Chain
// ==========================================

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('/api/v1/agent/execute', async (c, next) => {
  const body = await c.req.json<AgentRequest>();
  const originalPayload = JSON.stringify({ prompt: body.prompt, tools: body.tools });
  const originalPayloadSizeBytes = new TextEncoder().encode(originalPayload).length;
  const contextRefId = `ctx_${crypto.randomUUID()}`;
  
  c.set('offloadedContext', { contextRefId, originalPayloadSizeBytes });
  c.set('originalPayload', { prompt: body.prompt, tools: body.tools });
  await next();
});

app.use('/api/v1/agent/execute', async (c, next) => {
  const body = await c.req.json<AgentRequest>();
  c.set('requiresDataLogging', body.tier === 'Pro-Data-Pact');
  await next();
});

// ==========================================
// 5. Main Routing Endpoint (100% Native Edge)
// ==========================================

app.post('/api/v1/agent/execute', async (c) => {
  try {
    const body = await c.req.json<AgentRequest>();
    const { contextRefId, originalPayloadSizeBytes } = c.get('offloadedContext');
    const originalPayload = c.get('originalPayload');
    const requiresDataLogging = c.get('requiresDataLogging');

    if (!intentShield(body.tools)) {
      return c.json({ error: 'Intent Shield blocked: Unsafe tool invocation.' }, 403);
    }

    const payloadHash = await generatePayloadHash(JSON.stringify(originalPayload));

    if (requiresDataLogging) {
      const vaultId = c.env.DATA_TRUST_VAULT.idFromName(`vault_${body.userId}`);
      const vaultStub = c.env.DATA_TRUST_VAULT.get(vaultId) as unknown as VaultRPC;
      await vaultStub.logInteraction(body.userId, payloadHash, body.tier);
    }

    // FIX: Using the current, stable, default Cloudflare Workers AI model
    const response = await c.env.AI.run('@cf/meta/llama-3.2-3b-instruct' as any, {
      messages: [
        { role: 'system', content: 'You are Simorgh, an edge-native AI agent. Be concise and helpful.' },
        { role: 'user', content: body.prompt }
      ]
    }) as { response: string };

    return c.json({
      success: true,
      meta: { 
        contextRefId, 
        originalPayloadSizeBytes, 
        payloadHash, 
        loggedToLedger: requiresDataLogging,
        ai_model: 'llama-3.2-3b-instruct',
        provider: 'Cloudflare Workers AI (Native Free Tier)'
      },
      agentResponse: response.response
    });

  } catch (error) {
    console.error('[Simorgh Gateway] Critical Error:', error);
    return c.json({ error: 'Internal Gateway Error' }, 500);
  }
});

app.get('/api/v1/user/:userId/logs', async (c) => {
  const userId = c.req.param('userId');
  const vaultId = c.env.DATA_TRUST_VAULT.idFromName(`vault_${userId}`);
  const vaultStub = c.env.DATA_TRUST_VAULT.get(vaultId) as unknown as VaultRPC;
  const logs = await vaultStub.getUserLogs(userId);
  
  return c.json({ userId, totalInteractions: logs.length, logs });
});

app.get('/', (c) => c.text('Simorgh Agentic OS Edge Gateway is soaring.'));

export default app;
