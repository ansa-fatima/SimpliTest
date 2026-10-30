// Shared by the Generate-with-AI form and its API route, and by Improve with AI.

/** Longest requirement text (characters) one generation accepts (~10k tokens). */
export const MAX_REQUIREMENT_CHARS = 40_000;

/**
 * Longest reference document Improve with AI accepts. It can be far bigger than the
 * model sees: each test case is given only the passages relevant to it (see
 * lib/referenceExcerpt.ts), at most MAX_REFERENCE_PROMPT_CHARS of them.
 */
export const MAX_REFERENCE_CHARS = 250_000;
export const MAX_REFERENCE_PROMPT_CHARS = 14_000;
