// Shared helper: pick a unique name within a set of siblings by appending " (copy)",
// " (copy 2)", etc. Used by the module/suite copy endpoints.
export function uniqueName(base: string, taken: string[]): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  const firstCandidate = `${base} (copy)`;
  if (!set.has(firstCandidate)) return firstCandidate;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (copy ${i})`;
    if (!set.has(candidate)) return candidate;
  }
  return `${base} (copy ${Date.now()})`;
}
