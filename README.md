# 🦅 Project Simorgh — The Agentic OS Edge Gateway

> *"Thirty birds set out to find the Simorgh. After a long journey, the thirty survivors
> (si morgh) discover that they themselves — united — **are** the Simorgh."*
> — Attar of Nishapur, *The Conference of the Birds*

**Simorgh** is a free-to-run, no-KYC, self-evolving **agentic AI gateway** that stitches
the fragmented free tiers of the internet into one resilient, sovereign intelligence.
Its founding metaphor is literal architecture: **many small "birds" (free-tier providers)
fly together as one Simorgh, and when one bird tires, the flock reroutes.**

- **Live:** `https://simorgh-edge-gateway.shahino3ozone1353.workers.dev`
- **Dashboard:** `/dashboard` — the 30-Bird Mission Control
- **Stack:** Cloudflare Workers · Hono · **TypeScript 7 (tsgo — `@typescript/native-preview`)** · Durable Objects (SQLite) · KV
- **Cost to run:** $0 — every primitive used is on a genuinely free, no-credit-card tier.

---

## 1. The Vision (the "why")

Modern agent stacks are expensive, gated behind KYC/credit cards, and fragile (one
provider rate-limit kills the run). Simorgh's thesis: the free tiers already exist —
they just don't cooperate. Simorgh is the **connective tissue** that makes them adopt
each other and work together as one "supercomputer."

Positioning: *the world's first open-source, AI-native **API Federation & Data Trust**.*

### Signature concepts (from the founding brainstorm)
| Concept | Meaning |
|---|---|
| **The Flock** | 30 → 30k free/fragmented services, orchestrated as one intelligence. When a bird tires (rate-limit/error), the flock reroutes. |
| **Intent Shield** | Edge heuristic that vets every tool call against an allow-list/policy before execution. |
| **Data Trust / Tiers** | `Free-Volunteer`, `Pro-Paid`, `Pro-Data-Pact` — users may "pay with data" via opt-in, PII-scrubbed research sharing instead of cash. |
| **Swarm-State** | Hive memory (a Durable Object) so the flock remembers which birds are healthy/tired across requests and serverless hops. |
| **Auto-Wrapper** | (Roadmap) an LLM that auto-generates MCP wrappers for any REST/OpenAPI service. |

### Compliance line (safe-by-default, non-negotiable)
✅ Caching · users' own keys · opt-in data sharing · honest rate-limit backoff · local fallback.
❌ Throwaway-account rotation · scraped keys · ban-evasion proxies. **The framework enforces this by design.**

---

## 2. Architecture

```
                       ┌─────────────────────────────────────────────┐
   client / CLI / MCP  │            Cloudflare Worker (Hono)          │
   ───────────────────▶│  /api/v1/agent/execute                      │
                       │    │                                        │
                       │    ├─▶ Intent Shield (tool allow-list)      │
                       │    ├─▶ Context Offload ──▶ KV (CONTEXT_STORE)│
                       │    ├─▶ Data Trust log ──▶ DataTrustVault (DO)│
                       │    │                                        │
                       │    └─▶ runFlock() ──┐                        │
                       │                     │  asks "who's awake?"   │
                       │        FlockCoordinator (DO, SQLite)  ◀──────┤  Swarm-State
                       │                     │                        │
                       │     ┌───────────────┼───────────────┐        │
                       ▼     ▼               ▼               ▼        │
                    Shāhīn(Groq)     Bulbul(HF)      Homā(CF Workers AI)
                    priority 10      priority 20     priority 30 (always on, no key)
                       └─────────────── one answers ─────────────┘   │
                       │  /dashboard  ── 30-Bird Mission Control  ────┘
                       └─────────────────────────────────────────────┘
```

### The Flock (provider adapters) — [`src/flock.ts`](src/flock.ts)
Each "bird" normalizes a provider to one shape and is tried in priority order (lower first).
A bird stays **dormant** until its key is present, so the gateway runs with **zero secrets**.

| id | Bird (mythic) | Provider | Model | Key | Priority |
|----|---------------|----------|-------|-----|----------|
| `shahin` | 🦅 Shāhīn | Groq (OpenAI-compat) | `llama-3.3-70b-versatile` | `GROQ_API_KEY` | 10 (fastest, first) |
| `bulbul` | 🐦 Bulbul | HuggingFace Router | `meta-llama/Llama-3.3-70B-Instruct` | `HF_TOKEN` | 20 |
| `homa` | 🕊️ Homā | Cloudflare Workers AI | `@cf/meta/llama-3.2-3b-instruct` | *none* | 30 (**always present → zero-KYC guarantee**) |

### Swarm-State circuit breaker (`FlockCoordinator` DO)
SQLite table `bird_health` (`status`, `consecutive_failures`, `cooldown_until`, `last_ok`, `total_calls`, `total_failures`).
- **rate-limit** → 60s rest.  **transient error** → `15s × min(failures, 5)` backoff.
- `pickRoute()` returns healthy birds in priority order; a tired bird is skipped by concurrent/next requests.
- Chosen over KV because circuit-breaker state needs atomic read-modify-write — and a DO *is* the "hive memory."

---

## 3. API Reference

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/v1/agent/execute` | Run the agent (tool loop + flock failover). |
| `GET`  | `/api/v1/flock/status` | Live Swarm-State: which birds are awake/tired/dormant. |
| `GET`  | `/api/v1/context/:refId` | Retrieve an offloaded request payload from KV. |
| `GET`  | `/api/v1/user/:userId/logs` | Data-Trust transparency: a user's ledger entries. |
| `GET`  | `/dashboard` | Self-contained Mission Control UI. |
| `GET`  | `/` | Health text. |

### Execute — request
```jsonc
{
  "prompt": "What is the current server time?",
  "tools":  ["get_server_time", "search_web"],   // Intent Shield: must be in the allow-list
  "userId": "shahin_test_001",
  "tier":   "Pro-Data-Pact"                       // Free-Volunteer | Pro-Paid | Pro-Data-Pact
}
```
### Execute — response (abridged)
```jsonc
{
  "success": true,
  "meta": {
    "answered_by": "Homā (Cloudflare Workers AI)",
    "bird_id": "homa",
    "ai_model": "@cf/meta/llama-3.2-3b-instruct",
    "flock_attempts": [{ "birdId": "shahin", "ok": false }, { "birdId": "homa", "ok": true }],
    "contextRefId": "ctx_…",
    "loggedToLedger": true,
    "tool_iterations": 1
  },
  "agentResponse": "…natural-language answer…"
}
```

### Tools (Intent-Shielded)
- `search_web(query)` — real, no-KYC web search (DuckDuckGo Instant Answer).
- `get_server_time()` — ISO-8601 server time.
The Intent Shield rejects any tool not in the allow-list, both **before** the loop and again if the model tries to invoke an unlisted tool mid-flight.

---

## 4. Getting Started

```bash
# install
npm install

# typecheck — TypeScript 7 (tsgo, the native Go port)
npm run typecheck        # tsgo --noEmit

# local dev (miniflare) — Homā works with no secrets at all
npm run dev              # wrangler dev (--local --port 8787)
#   → http://127.0.0.1:8787/dashboard
#   → http://127.0.0.1:8787/api/v1/flock/status

# deploy (typecheck-gated; needs your Cloudflare auth)
npm run deploy           # tsgo --noEmit && wrangler deploy

# add extra birds (optional — absent = dormant, safe-by-default)
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put HF_TOKEN
```

Then open `…workers.dev/dashboard`, exhaust Groq's quota, and **watch the flock reroute to Homā** in real time.

---

## 5. Repository Map

```
simorgh-gateway/
├── src/
│   ├── index.ts       # Hono app: routes, Intent Shield, tool loop, Data Trust, Context Offload
│   ├── flock.ts       # The Flock: bird adapters + FlockCoordinator DO + runFlock()
│   ├── models.ts      # Model Registry (Auto-Wrapper): catalog + findModelBird + getModelCatalog
│   └── dashboard.ts   # Self-contained Mission Control HTML (inline CSS/JS, no build)
├── tsconfig.json      # TypeScript 7 (tsgo) config — bundler-correct, strict, noEmit
├── .vscode/           # tsgo language service on + extension recommendation
├── wrangler.toml      # bindings: AI, KV(CONTEXT_STORE), DOs(DataTrustVault, FlockCoordinator)
├── .bmad/             # BMAD Method state + phase artifacts (PRD, architecture, UX)
├── chat-export-*.json # founding brainstorm transcripts (source of the vision)
└── README.md
```

---

## 6. Development Method — BMAD × OKRs

Built with the **BMAD Method** (Orchestrator → Analyst → PM → Architect → UX → Dev → QA),
each milestone leaving an artifact under [`.bmad/phases/`](.bmad/phases). Planning uses
**Google-style OKRs** (Objective + measurable Key Results) so each milestone is verifiable, not vibes.

| Milestone | Objective | Status |
|-----------|-----------|--------|
| **MVP** | Edge agent: execute loop, Intent Shield, Context Offload (KV), Data Trust (DO) | ✅ shipped |
| **M1 — The Flock** | Make the metaphor real: multi-provider failover + Swarm-State | ✅ shipped |
| **M2 — Mission Control** | Make the flock *visible*: live dashboard + Flight Console | ✅ shipped |
| **M3 — The Real Agent** | Make the agent genuinely *useful*: real web search + clean answer synthesis | 🛠️ in progress |
| **M4 — Auto-Wrapper** | LLM auto-generates MCP wrappers for any REST/OpenAPI service | 🗓️ backlog |
| **BYOK / MCP core** | Per-user keys + native MCP so agents call each other efficiently | 🗓️ backlog |

---

## 7. Known Notes
- `package.json` declares `"type": "commonjs"` while the Worker is ESM — harmless (the bundler handles it), flagged for cleanup.
- Extra birds are strictly optional; the flock always has Homā, so **no configuration is ever required to run**.

---

## 8. License & Ethos
Open-source, built for *"the greater good"* — a free agentic OS anyone can run.
Data sharing is **always opt-in**, encrypted, and PII-scrubbed. Safe-by-default is a
framework guarantee, not a policy afterthought.

*Si morgh → Simorgh. Thirty birds → one.* 🔥
