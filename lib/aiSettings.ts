// Per-workspace settings for "Generate with AI" (stored in Project.aiSettings).
// Everything is optional in storage; normalizeAiSettings() fills the defaults,
// so a workspace that never opened the settings behaves sensibly.

/** How hard to look for existing cases that a generated case duplicates. */
export type DuplicateCheck = 'off' | 'titles' | 'titlesSteps';

export interface AiSettings {
  duplicateCheck: DuplicateCheck;
  /** Ask the model to confirm (and to catch reworded) duplicates the wording check is unsure about. */
  aiTiebreak: boolean;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  duplicateCheck: 'titlesSteps',
  aiTiebreak: false,
};

export function normalizeAiSettings(raw: unknown): AiSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const dc = r.duplicateCheck;
  return {
    duplicateCheck:
      dc === 'off' || dc === 'titles' || dc === 'titlesSteps'
        ? dc
        : DEFAULT_AI_SETTINGS.duplicateCheck,
    aiTiebreak: typeof r.aiTiebreak === 'boolean' ? r.aiTiebreak : DEFAULT_AI_SETTINGS.aiTiebreak,
  };
}
