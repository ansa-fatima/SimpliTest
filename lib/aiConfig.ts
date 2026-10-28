// Which AI provider, key and models a workspace uses for "Generate with AI".
//
// Order: the workspace's own connection (Settings > Integrations) first, then a
// server-wide environment variable (ANTHROPIC_API_KEY / GEMINI_API_KEY /
// OPENAI_API_KEY / OLLAMA_BASE_URL) as an optional fallback. If neither exists,
// generation is simply "not set up" and says how to fix it.

import { prisma } from '@/lib/db';
import { openSecret } from '@/lib/secretBox';

// Claude and Gemini have their own APIs; every other provider speaks the OpenAI
// chat-completions API (see lib/ai.ts), so adding one is just an entry below.
export type AiProvider =
  | 'anthropic'
  | 'gemini'
  | 'openai'
  | 'openrouter'
  | 'groq'
  | 'xai'
  | 'mistral'
  | 'deepseek'
  | 'ollama'
  | 'custom';

export interface AiModelOption {
  id: string;
  label: string;
  hint: string;
}

export interface ProviderInfo {
  id: AiProvider;
  label: string;
  /** One line shown under the provider picker. */
  note: string;
  /** Models offered in the settings dropdowns. */
  models: AiModelOption[];
  defaultModel: string;
  /** Cheap model for the duplicate double-check. */
  defaultTiebreakModel: string;
  /** False for providers that run without a key (a local Ollama). */
  needsKey: boolean;
  /** A key can be entered but is not required (a custom server that may or may not check one). */
  keyOptional?: boolean;
  keyPlaceholder: string;
  keyUrl: string;
  keyUrlLabel: string;
  /** Whether the admin can (or must) set the server address. */
  baseUrl: 'none' | 'optional' | 'required';
  defaultBaseUrl: string;
  /** Hint for the "Other model…" box, e.g. "gemini-…". */
  modelPlaceholder: string;
}

export const PROVIDERS: Record<AiProvider, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    note: 'Anthropic API key, billed per use.',
    models: [
      {
        id: 'claude-sonnet-5-5',
        label: 'Claude Sonnet 5.5',
        hint: 'Balanced quality and cost (recommended)',
      },
      {
        id: 'claude-opus-5-5',
        label: 'Claude Opus 5.5',
        hint: 'Most capable, slower and costs more',
      },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: 'Fastest and cheapest' },
    ],
    defaultModel: 'claude-sonnet-5-5',
    defaultTiebreakModel: 'claude-haiku-5-5',
    needsKey: true,
    keyPlaceholder: 'sk-ant-…',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyUrlLabel: 'console.anthropic.com/settings/keys',
    baseUrl: 'none',
    defaultBaseUrl: 'https://api.anthropic.com',
    modelPlaceholder: 'claude-…',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini (Google)',
    note: 'Google AI Studio key. The Gemini API has its own billing; a Google AI Pro subscription does not cover it.',
    // Google retires model versions regularly (a key may get a 404 for a name
    // that worked a few months ago), so the "-latest" aliases -- which always point
    // at the current model of that tier -- are the defaults. If a model is not
    // available, the error lists the models the key can actually use.
    models: [
      {
        id: 'gemini-flash-latest',
        label: 'Gemini Flash (latest)',
        hint: 'Fast and inexpensive, good quality (recommended)',
      },
      {
        id: 'gemini-pro-latest',
        label: 'Gemini Pro (latest)',
        hint: 'Most capable, slower and costs more',
      },
      {
        id: 'gemini-flash-lite-latest',
        label: 'Gemini Flash-Lite (latest)',
        hint: 'Fastest and cheapest',
      },
      {
        id: 'gemini-3-flash-preview',
        label: 'Gemini 3 Flash (preview)',
        hint: 'Newest Flash generation, may change',
      },
      {
        id: 'gemini-3.1-pro-preview',
        label: 'Gemini 3.1 Pro (preview)',
        hint: 'Newest Pro generation, may change',
      },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', hint: 'Older, may be retired' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'Older, may be retired' },
    ],
    defaultModel: 'gemini-flash-latest',
    defaultTiebreakModel: 'gemini-flash-lite-latest',
    needsKey: true,
    keyPlaceholder: 'AQ.… or AIza…',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyUrlLabel: 'aistudio.google.com/apikey',
    baseUrl: 'none',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    modelPlaceholder: 'gemini-…',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (GPT)',
    note: 'OpenAI API key, billed per use. A custom server address also works with OpenAI-compatible services such as OpenRouter, Groq, LM Studio or vLLM.',
    models: [
      {
        id: 'gpt-5-mini',
        label: 'GPT-5 mini',
        hint: 'Fast and inexpensive, good quality (recommended)',
      },
      { id: 'gpt-5', label: 'GPT-5', hint: 'Most capable, slower and costs more' },
      { id: 'gpt-5-nano', label: 'GPT-5 nano', hint: 'Fastest and cheapest' },
      { id: 'gpt-4.1', label: 'GPT-4.1', hint: 'Strong, no extended reasoning' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', hint: 'Fast and inexpensive' },
      { id: 'gpt-4o', label: 'GPT-4o', hint: 'Previous generation' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', hint: 'Previous generation, cheapest' },
    ],
    defaultModel: 'gpt-5-mini',
    defaultTiebreakModel: 'gpt-5-nano',
    needsKey: true,
    keyPlaceholder: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyUrlLabel: 'platform.openai.com/api-keys',
    baseUrl: 'optional',
    defaultBaseUrl: 'https://api.openai.com',
    modelPlaceholder: 'gpt-…',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    note: 'One OpenRouter key reaches hundreds of models from many companies; you pay OpenRouter per use.',
    models: [
      {
        id: 'openai/gpt-5-mini',
        label: 'GPT-5 mini',
        hint: 'Fast and inexpensive, good quality (recommended)',
      },
      {
        id: 'anthropic/claude-sonnet-4.5',
        label: 'Claude Sonnet 4.5',
        hint: 'Strong at structured writing',
      },
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'Fast and inexpensive' },
      {
        id: 'meta-llama/llama-3.3-70b-instruct',
        label: 'Llama 3.3 70B',
        hint: 'Open model, low cost',
      },
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat', hint: 'Open model, very low cost' },
    ],
    defaultModel: 'openai/gpt-5-mini',
    defaultTiebreakModel: 'openai/gpt-5-nano',
    needsKey: true,
    keyPlaceholder: 'sk-or-…',
    keyUrl: 'https://openrouter.ai/keys',
    keyUrlLabel: 'openrouter.ai/keys',
    baseUrl: 'none',
    defaultBaseUrl: 'https://openrouter.ai/api',
    modelPlaceholder: 'vendor/model, e.g. openai/gpt-5-mini',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    note: 'Very fast hosted open models (Llama, GPT-OSS) on Groq hardware. Has a free tier with rate limits.',
    models: [
      {
        id: 'llama-3.3-70b-versatile',
        label: 'Llama 3.3 70B',
        hint: 'Good quality and very fast (recommended)',
      },
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', hint: 'Most capable on Groq' },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', hint: 'Smaller and faster' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B', hint: 'Fastest and cheapest' },
    ],
    defaultModel: 'llama-3.3-70b-versatile',
    defaultTiebreakModel: 'llama-3.1-8b-instant',
    needsKey: true,
    keyPlaceholder: 'gsk_…',
    keyUrl: 'https://console.groq.com/keys',
    keyUrlLabel: 'console.groq.com/keys',
    baseUrl: 'none',
    defaultBaseUrl: 'https://api.groq.com/openai',
    modelPlaceholder: 'e.g. llama-3.3-70b-versatile',
  },
  xai: {
    id: 'xai',
    label: 'Grok (xAI)',
    note: 'xAI API key, billed per use.',
    models: [
      { id: 'grok-3', label: 'Grok 3', hint: 'Strong all-rounder (recommended)' },
      { id: 'grok-4', label: 'Grok 4', hint: 'Most capable, slower and costs more' },
      { id: 'grok-3-mini', label: 'Grok 3 mini', hint: 'Fast and inexpensive' },
    ],
    defaultModel: 'grok-3',
    defaultTiebreakModel: 'grok-3-mini',
    needsKey: true,
    keyPlaceholder: 'xai-…',
    keyUrl: 'https://console.x.ai',
    keyUrlLabel: 'console.x.ai',
    baseUrl: 'none',
    defaultBaseUrl: 'https://api.x.ai',
    modelPlaceholder: 'grok-…',
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    note: 'Mistral AI API key, billed per use (a free experimentation tier exists).',
    models: [
      {
        id: 'mistral-large-latest',
        label: 'Mistral Large',
        hint: 'Most capable (recommended)',
      },
      { id: 'mistral-small-latest', label: 'Mistral Small', hint: 'Fast and inexpensive' },
      { id: 'open-mistral-nemo', label: 'Mistral Nemo', hint: 'Open model, cheapest' },
    ],
    defaultModel: 'mistral-large-latest',
    defaultTiebreakModel: 'mistral-small-latest',
    needsKey: true,
    keyPlaceholder: '',
    keyUrl: 'https://console.mistral.ai/api-keys',
    keyUrlLabel: 'console.mistral.ai/api-keys',
    baseUrl: 'none',
    defaultBaseUrl: 'https://api.mistral.ai',
    modelPlaceholder: 'e.g. mistral-large-latest',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    note: 'DeepSeek API key, billed per use and very inexpensive.',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat', hint: 'Fast, good quality (recommended)' },
      {
        id: 'deepseek-reasoner',
        label: 'DeepSeek Reasoner',
        hint: 'Thinks longer, slower',
      },
    ],
    defaultModel: 'deepseek-chat',
    defaultTiebreakModel: 'deepseek-chat',
    needsKey: true,
    keyPlaceholder: 'sk-…',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyUrlLabel: 'platform.deepseek.com/api_keys',
    baseUrl: 'none',
    defaultBaseUrl: 'https://api.deepseek.com',
    modelPlaceholder: 'deepseek-…',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local models)',
    note: 'Runs open models on your own machine: free, and nothing leaves your network. The server running SimpliTest must be able to reach it.',
    models: [
      { id: 'llama3.1', label: 'Llama 3.1', hint: 'Good all-rounder (ollama pull llama3.1)' },
      {
        id: 'qwen2.5',
        label: 'Qwen 2.5',
        hint: 'Strong at structured output (ollama pull qwen2.5)',
      },
      { id: 'mistral', label: 'Mistral', hint: 'Small and fast (ollama pull mistral)' },
      { id: 'gemma3', label: 'Gemma 3', hint: 'Google open model (ollama pull gemma3)' },
      { id: 'llama3.2', label: 'Llama 3.2', hint: 'Smaller and quicker (ollama pull llama3.2)' },
    ],
    defaultModel: 'llama3.1',
    defaultTiebreakModel: 'llama3.1',
    needsKey: false,
    keyPlaceholder: '',
    keyUrl: 'https://ollama.com/download',
    keyUrlLabel: 'ollama.com/download',
    baseUrl: 'required',
    defaultBaseUrl: 'http://localhost:11434',
    modelPlaceholder: 'e.g. llama3.1:8b',
  },
  custom: {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    note: 'Any server that speaks the OpenAI API: LM Studio, vLLM, LiteLLM, llama.cpp, Together, Fireworks, Azure gateways and similar.',
    models: [],
    defaultModel: '',
    defaultTiebreakModel: '',
    needsKey: false,
    keyOptional: true,
    keyPlaceholder: 'Only if the server asks for one',
    keyUrl: 'https://platform.openai.com/docs/api-reference/chat',
    keyUrlLabel: 'the OpenAI API reference',
    baseUrl: 'required',
    defaultBaseUrl: '',
    modelPlaceholder: 'the model name your server uses',
  },
};

/** Whether this provider takes an API key at all (required or optional). */
export const usesKey = (p: ProviderInfo) => p.needsKey || !!p.keyOptional;

export const AI_PROVIDER_IDS = Object.keys(PROVIDERS) as AiProvider[];

export function isProvider(v: unknown): v is AiProvider {
  return typeof v === 'string' && (AI_PROVIDER_IDS as string[]).includes(v);
}

// Back-compat names for the original (Claude-only) setup.
export const DEFAULT_MODEL = PROVIDERS.anthropic.defaultModel;
export const DEFAULT_TIEBREAK_MODEL = PROVIDERS.anthropic.defaultTiebreakModel;

/** A model id we are willing to send to this provider. */
export function isValidModelId(provider: AiProvider, v: unknown): v is string {
  if (typeof v !== 'string') return false;
  switch (provider) {
    case 'gemini':
      return /^gemini-[a-z0-9][a-z0-9.-]{2,60}$/.test(v);
    case 'anthropic':
      return /^claude-[a-z0-9][a-z0-9.-]{2,60}$/.test(v);
    // OpenAI-compatible servers and Ollama name models freely ("llama3.1:8b",
    // "hf.co/org/model:tag", "openai/gpt-5-mini"), so only the shape is checked.
    default:
      return /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,100}$/.test(v);
  }
}

// Server-wide fallback: the first provider (in this order) whose variable is set
// answers for workspaces that have not connected their own. A provider with no
// key (Ollama, a custom server) counts as configured when its address is set.
const ENV_VARS: Record<AiProvider, { key?: string; baseUrl: string }> = {
  anthropic: { key: 'ANTHROPIC_API_KEY', baseUrl: 'ANTHROPIC_BASE_URL' },
  gemini: { key: 'GEMINI_API_KEY', baseUrl: 'GEMINI_BASE_URL' },
  openai: { key: 'OPENAI_API_KEY', baseUrl: 'OPENAI_BASE_URL' },
  openrouter: { key: 'OPENROUTER_API_KEY', baseUrl: 'OPENROUTER_BASE_URL' },
  groq: { key: 'GROQ_API_KEY', baseUrl: 'GROQ_BASE_URL' },
  xai: { key: 'XAI_API_KEY', baseUrl: 'XAI_BASE_URL' },
  mistral: { key: 'MISTRAL_API_KEY', baseUrl: 'MISTRAL_BASE_URL' },
  deepseek: { key: 'DEEPSEEK_API_KEY', baseUrl: 'DEEPSEEK_BASE_URL' },
  ollama: { baseUrl: 'OLLAMA_BASE_URL' },
  custom: { key: 'CUSTOM_AI_API_KEY', baseUrl: 'CUSTOM_AI_BASE_URL' },
};

/** Everything except Claude and Gemini is reached through the OpenAI chat-completions API. */
export const isOpenAiStyle = (p: AiProvider) => p !== 'anthropic' && p !== 'gemini';

/**
 * A server address an admin typed, cleaned up -- or the reason it can't be used.
 * The server will call this address, so the obviously dangerous ones (cloud
 * metadata endpoints) are refused; localhost is allowed on purpose, for Ollama.
 */
export function normalizeBaseUrl(raw: string): { url: string } | { error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { error: 'Enter the address as a full URL, e.g. http://localhost:11434' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return { error: 'The address must start with http:// or https://' };
  if (u.username || u.password)
    return { error: 'Do not put a user name or password in the address.' };
  const host = u.hostname.toLowerCase();
  if (
    /^169\.254\./.test(host) ||
    host === 'metadata.google.internal' ||
    host === '100.100.100.200' ||
    host === '[fd00:ec2::254]'
  )
    return { error: 'That address is not allowed.' };
  // "…/v1" is where OpenAI-style APIs live; the app adds it itself.
  const path = u.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
  return { url: `${u.origin}${path}` };
}

export interface AiConfig {
  provider: AiProvider;
  /** Empty for providers that need none (Ollama). */
  apiKey: string;
  baseUrl: string;
  /** Writes the test cases. */
  model: string;
  /** Cheap model for the duplicate double-check. */
  tiebreakModel: string;
  /** Where the key came from, for the settings screen. */
  source: 'workspace' | 'server';
}

// The base URLs can be overridden (per workspace, or by environment variable) so
// a proxy, a local mock or a self-hosted server can stand in.
function resolveBaseUrl(provider: AiProvider, override?: string | null): string {
  const raw =
    override || process.env[ENV_VARS[provider].baseUrl] || PROVIDERS[provider].defaultBaseUrl;
  const url = raw.replace(/\/+$/, '');
  // OpenAI-style callers add "/v1" themselves, so accept an address that already has it.
  return isOpenAiStyle(provider) ? url.replace(/\/v1$/, '') : url;
}

// AI_MODEL / AI_TIEBREAK_MODEL only apply to the provider whose naming they follow.
const envModel = (provider: AiProvider, name: 'AI_MODEL' | 'AI_TIEBREAK_MODEL') => {
  const v = process.env[name];
  if (!isValidModelId(provider, v)) return null;
  // The loose OpenAI/Ollama shape would accept "claude-…"; keep vendor names apart.
  if (provider !== 'anthropic' && /^claude-/.test(v)) return null;
  if (provider !== 'gemini' && /^gemini-/.test(v)) return null;
  return v;
};

/** The AI settings for one workspace, or null when nothing is configured anywhere. */
export async function resolveAiConfig(projectId: string): Promise<AiConfig | null> {
  const conn = await prisma.aiConnection.findUnique({ where: { projectId } });
  if (conn) {
    const provider: AiProvider = isProvider(conn.provider) ? conn.provider : 'anthropic';
    const info = PROVIDERS[provider];
    const model = conn.model || envModel(provider, 'AI_MODEL') || info.defaultModel;
    return {
      provider,
      apiKey: conn.apiKey ? openSecret(conn.apiKey) : '',
      baseUrl: resolveBaseUrl(provider, conn.baseUrl),
      model,
      // A custom server has no known "small" model, so it uses the same one.
      tiebreakModel:
        conn.tiebreakModel ||
        envModel(provider, 'AI_TIEBREAK_MODEL') ||
        info.defaultTiebreakModel ||
        model,
      source: 'workspace',
    };
  }
  const provider = AI_PROVIDER_IDS.find(p => {
    const v = ENV_VARS[p];
    return v.key ? !!process.env[v.key] : !!process.env[v.baseUrl];
  });
  if (provider && !(provider === 'custom' && !process.env[ENV_VARS.custom.baseUrl])) {
    const info = PROVIDERS[provider];
    const keyVar = ENV_VARS[provider].key;
    const model = envModel(provider, 'AI_MODEL') || info.defaultModel;
    return {
      provider,
      apiKey: (keyVar && process.env[keyVar]) || '',
      baseUrl: resolveBaseUrl(provider),
      model,
      tiebreakModel: envModel(provider, 'AI_TIEBREAK_MODEL') || info.defaultTiebreakModel || model,
      source: 'server',
    };
  }
  return null;
}

/** Same settings but built from a key being entered, before it is saved. */
export function configFromKey(
  provider: AiProvider,
  apiKey: string,
  model?: string | null,
  baseUrl?: string | null,
): AiConfig {
  const info = PROVIDERS[provider];
  return {
    provider,
    apiKey,
    baseUrl: resolveBaseUrl(provider, baseUrl),
    model: model || info.defaultModel,
    tiebreakModel: info.defaultTiebreakModel,
    source: 'workspace',
  };
}
