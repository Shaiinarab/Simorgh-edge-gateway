// ==========================================
// Simorgh Model Registry — Auto-Wrapper, phase 1
// The flock is no longer hard-wired to one model per bird. This module is the
// single source of truth for "which models can fly the agent", grouped by
// provider, and maps any chosen model back to the bird that should serve it.
//
// Zero-KYC guarantee: Cloudflare Workers AI needs no key, so the Cloudflare
// group is ALWAYS available and the catalog is never empty.
// ==========================================

export interface ModelInfo {
  id: string;          // provider-native model id (what the bird's API expects)
  name: string;        // human label for the dashboard
  provider: 'cloudflare' | 'groq' | 'huggingface';
  birdId: string;      // which bird in the flock serves this model
  functionCalling: boolean; // true = supports tool/function calling
}

export interface ProviderCatalog {
  id: 'cloudflare' | 'groq' | 'huggingface';
  label: string;
  available: boolean;  // key present (Cloudflare is always true)
  models: ModelInfo[];
}

export interface ModelCatalog {
  default: string;
  providers: ProviderCatalog[];
}

// Env subset needed to decide provider availability.
export interface ModelEnv {
  GROQ_API_KEY?: string;
  HF_TOKEN?: string;
  // Reserved for a future live Workers AI catalog fetch (curated list is default).
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
}

// The bird that guarantees zero-KYC operation runs Cloudflare Workers AI.
export const DEFAULT_MODEL = '@cf/meta/llama-3.2-3b-instruct';

// --- Cloudflare Workers AI (no key required) ---
// Curated from the Workers AI catalog: small/fast defaults + function-calling
// capable models. `@cf/...` ids are served by Homā via the AI binding.
export const CLOUDFLARE_MODELS: ModelInfo[] = [
  { id: '@cf/meta/llama-3.2-3b-instruct',            name: 'Llama 3.2 3B Instruct (fast · default)', provider: 'cloudflare', birdId: 'homa', functionCalling: true },
  { id: '@cf/meta/llama-3.2-1b-instruct',            name: 'Llama 3.2 1B Instruct (fastest)',        provider: 'cloudflare', birdId: 'homa', functionCalling: true },
  { id: '@cf/meta/llama-3.1-8b-instruct-fast',       name: 'Llama 3.1 8B Instruct (fast)',           provider: 'cloudflare', birdId: 'homa', functionCalling: true },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',  name: 'Llama 3.3 70B Instruct (fp8, fast)',     provider: 'cloudflare', birdId: 'homa', functionCalling: true },
  { id: '@cf/meta/llama-4-scout-17b-16e-instruct',   name: 'Llama 4 Scout 17B',                      provider: 'cloudflare', birdId: 'homa', functionCalling: true },
  { id: '@cf/openai/gpt-oss-120b',                   name: 'GPT-OSS 120B (reasoning)',               provider: 'cloudflare', birdId: 'homa', functionCalling: true },
  { id: '@cf/openai/gpt-oss-20b',                    name: 'GPT-OSS 20B (low latency)',              provider: 'cloudflare', birdId: 'homa', functionCalling: true },
  { id: '@cf/mistralai/mistral-small-3.1-24b-instruct', name: 'Mistral Small 3.1 24B',              provider: 'cloudflare', birdId: 'homa', functionCalling: true },
  { id: '@cf/qwen/qwen3-30b-a3b-fp8',                name: 'Qwen3 30B A3B (fp8)',                    provider: 'cloudflare', birdId: 'homa', functionCalling: true },
];

// --- Groq (needs GROQ_API_KEY) — served by Shāhīn ---
export const GROQ_MODELS: ModelInfo[] = [
  { id: 'llama-3.3-70b-versatile',        name: 'Llama 3.3 70B Versatile (default)', provider: 'groq', birdId: 'shahin', functionCalling: true },
  { id: 'llama-3.1-8b-instant',           name: 'Llama 3.1 8B Instant (fast)',       provider: 'groq', birdId: 'shahin', functionCalling: true },
  { id: 'openai/gpt-oss-120b',            name: 'GPT-OSS 120B',                      provider: 'groq', birdId: 'shahin', functionCalling: true },
];

// --- HuggingFace (needs HF_TOKEN) — served by Bulbul ---
export const HF_MODELS: ModelInfo[] = [
  { id: 'meta-llama/Llama-3.3-70B-Instruct',   name: 'Llama 3.3 70B Instruct (default)', provider: 'huggingface', birdId: 'bulbul', functionCalling: true },
  { id: 'Qwen/Qwen2.5-72B-Instruct',           name: 'Qwen2.5 72B Instruct',             provider: 'huggingface', birdId: 'bulbul', functionCalling: true },
];

// Flat index of every known model id → info (for fast validation/lookups).
const ALL_MODELS: ModelInfo[] = [...CLOUDFLARE_MODELS, ...GROQ_MODELS, ...HF_MODELS];
const MODEL_INDEX = new Map<string, ModelInfo>(ALL_MODELS.map(m => [m.id, m]));

// Build the provider-grouped catalog, marking which providers are actually
// usable given the current keys. Cloudflare is always available (zero-KYC).
export function getModelCatalog(env: ModelEnv): ModelCatalog {
  return {
    default: DEFAULT_MODEL,
    providers: [
      { id: 'cloudflare',  label: 'Cloudflare Workers AI (no key)', available: true,             models: CLOUDFLARE_MODELS },
      { id: 'groq',        label: 'Groq',                           available: !!env.GROQ_API_KEY, models: GROQ_MODELS },
      { id: 'huggingface', label: 'HuggingFace',                    available: !!env.HF_TOKEN,     models: HF_MODELS },
    ],
  };
}

// Is this a model id we know about (allow-list)?
export function isKnownModel(modelId: string): boolean {
  return MODEL_INDEX.has(modelId);
}

// Which bird should serve this model? `@cf/...` always maps to Homā (zero-KYC).
// Returns undefined for unknown ids so callers can ignore bad input safely.
export function findModelBird(modelId: string): string | undefined {
  const known = MODEL_INDEX.get(modelId);
  if (known) return known.birdId;
  if (modelId.startsWith('@cf/')) return 'homa';
  return undefined;
}
