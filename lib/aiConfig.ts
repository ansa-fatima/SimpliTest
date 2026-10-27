// Which AI provider, key and models a workspace uses for "Generate with AI".
//
// Order: the workspace's own connection (Settings > Integrations) first, then the
// server-wide ANTHROPIC_API_KEY / GEMINI_API_KEY environment variable as an
// optional fallback. If neither exists, generation is simply "not set up" and
// says how to fix it.

import { prisma } from '@/lib/db';
import { openSecret } from '@/lib/secretBox';

export type AiProvider = 'anthropic' | 'gemini';

export interface AiModelOption {
  id: string;
  label: string;
  hint: string;
}

export interface ProviderInfo {
  id: AiProvider;
  label: string;
  /** Models offered in the settings dropdowns. */
  models: AiModelOption[];
  defaultModel: string;
  /** Cheap model for the duplicate double-check. */
  defaultTiebreakModel: string;
  keyPlaceholder: string;
  keyUrl: string;
  keyUrlLabel: string;
}

export const PROVIDERS: Record<AiProvider, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
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
    keyPlaceholder: 'sk-ant-…',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyUrlLabel: 'console.anthropic.com/settings/keys',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini (Google)',
    // The "-latest" names always point at Google's current model of that tier, so
    // they keep working when a version is retired; pick a dated one to pin it.
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
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', hint: 'Previous generation' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'Previous generation' },
    ],
    defaultModel: 'gemini-flash-latest',
    defaultTiebreakModel: 'gemini-flash-lite-latest',
    keyPlaceholder: 'AIza…',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyUrlLabel: 'aistudio.google.com/apikey',
  },
};

export const AI_PROVIDER_IDS = Object.keys(PROVIDERS) as AiProvider[];

export function isProvider(v: unknown): v is AiProvider {
  return typeof v === 'string' && (AI_PROVIDER_IDS as string[]).includes(v);
}

// Back-compat names for the original (Claude-only) setup.
export const DEFAULT_MODEL = PROVIDERS.anthropic.defaultModel;
export const DEFAULT_TIEBREAK_MODEL = PROVIDERS.anthropic.defaultTiebreakModel;

/** A model id we are willing to send to this provider: any plain claude-* / gemini-* id. */
export function isValidModelId(provider: AiProvider, v: unknown): v is string {
  if (typeof v !== 'string') return false;
  return provider === 'gemini'
    ? /^gemini-[a-z0-9][a-z0-9.-]{2,60}$/.test(v)
    : /^claude-[a-z0-9][a-z0-9.-]{2,60}$/.test(v);
}

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  baseUrl: string;
  /** Writes the test cases. */
  model: string;
  /** Cheap model for the duplicate double-check. */
  tiebreakModel: string;
  /** Where the key came from, for the settings screen. */
  source: 'workspace' | 'server';
}

// The base URLs can be overridden so a proxy or a local mock can stand in.
const baseUrl = (provider: AiProvider) =>
  (provider === 'gemini'
    ? process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'
    : process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
  ).replace(/\/+$/, '');

// AI_MODEL / AI_TIEBREAK_MODEL only apply to the provider whose naming they follow.
const envModel = (provider: AiProvider, name: 'AI_MODEL' | 'AI_TIEBREAK_MODEL') => {
  const v = process.env[name];
  return isValidModelId(provider, v) ? v : null;
};

/** The AI settings for one workspace, or null when no key is configured anywhere. */
export async function resolveAiConfig(projectId: string): Promise<AiConfig | null> {
  const conn = await prisma.aiConnection.findUnique({ where: { projectId } });
  if (conn) {
    const provider: AiProvider = isProvider(conn.provider) ? conn.provider : 'anthropic';
    const info = PROVIDERS[provider];
    return {
      provider,
      apiKey: openSecret(conn.apiKey),
      baseUrl: baseUrl(provider),
      model: conn.model || envModel(provider, 'AI_MODEL') || info.defaultModel,
      tiebreakModel:
        conn.tiebreakModel || envModel(provider, 'AI_TIEBREAK_MODEL') || info.defaultTiebreakModel,
      source: 'workspace',
    };
  }
  const provider: AiProvider | null = process.env.ANTHROPIC_API_KEY
    ? 'anthropic'
    : process.env.GEMINI_API_KEY
      ? 'gemini'
      : null;
  if (provider) {
    const info = PROVIDERS[provider];
    return {
      provider,
      apiKey: (provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY)!,
      baseUrl: baseUrl(provider),
      model: envModel(provider, 'AI_MODEL') || info.defaultModel,
      tiebreakModel: envModel(provider, 'AI_TIEBREAK_MODEL') || info.defaultTiebreakModel,
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
): AiConfig {
  const info = PROVIDERS[provider];
  return {
    provider,
    apiKey,
    baseUrl: baseUrl(provider),
    model: model || info.defaultModel,
    tiebreakModel: info.defaultTiebreakModel,
    source: 'workspace',
  };
}
