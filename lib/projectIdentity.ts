// Project identity (Settings > General): the colour palette and icon set a
// workspace can pick from. Shared by the settings form, the project cards, the
// switcher chip and the PATCH route's validation, so a stored key always
// resolves to something drawable.

export const PROJECT_COLORS = [
  { key: 'purple', gradient: 'linear-gradient(135deg,#5544C5,#3F2DAA)' },
  { key: 'lilac', gradient: 'linear-gradient(135deg,#A99CEA,#5544C5)' },
  { key: 'orange', gradient: 'linear-gradient(135deg,#FF9F45,#F26B2C)' },
  { key: 'blue', gradient: 'linear-gradient(135deg,#5C7FE5,#3457D5)' },
  { key: 'maroon', gradient: 'linear-gradient(135deg,#7E3A4D,#5E2A39)' },
  { key: 'teal', gradient: 'linear-gradient(135deg,#1FA89A,#0E8A85)' },
  { key: 'gold', gradient: 'linear-gradient(135deg,#FFD566,#D89A2C)' },
  { key: 'rose', gradient: 'linear-gradient(135deg,#DC4D6E,#A8324A)' },
] as const;

export const PROJECT_ICONS = [
  { key: 'letter', path: null },
  {
    key: 'doc',
    path: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z',
  },
  { key: 'route', path: 'M22 12h-4M14 12H2' },
  { key: 'play', path: 'M5 3l14 9-14 9V3z' },
  { key: 'chart', path: 'M3 3v18h18' },
  { key: 'globe', path: 'M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20' },
  { key: 'layers', path: 'M12 2L2 7l10 5 10-5-10-5z' },
  { key: 'filter', path: 'M3 6h18M6 12h12M10 18h4' },
] as const;

export const PROJECT_VISIBILITIES = [
  { key: 'Internal', label: 'Internal — workspace members only' },
  { key: 'Restricted', label: 'Restricted — invited only' },
] as const;

export const COLOR_KEYS: string[] = PROJECT_COLORS.map(c => c.key);
export const ICON_KEYS: string[] = PROJECT_ICONS.map(i => i.key);
export const VISIBILITY_KEYS: string[] = PROJECT_VISIBILITIES.map(v => v.key);

// A workspace that never picked a colour still gets a stable one.
const FALLBACK_ORDER = ['purple', 'orange', 'blue', 'maroon', 'teal', 'gold'];

export function projectGradient(p: { id: string; color?: string | null }): string {
  const picked = PROJECT_COLORS.find(c => c.key === p.color);
  if (picked) return picked.gradient;
  let h = 0;
  for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) | 0;
  const key = FALLBACK_ORDER[Math.abs(h) % FALLBACK_ORDER.length];
  return PROJECT_COLORS.find(c => c.key === key)!.gradient;
}

export function projectIconPath(icon?: string | null): string | null {
  return PROJECT_ICONS.find(i => i.key === icon)?.path ?? null;
}

/** "lms-platform"-style codes: letters/digits/dash, upper-cased, max 8. */
export function normaliseCaseKey(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 8);
}
