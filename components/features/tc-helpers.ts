// Display helpers for the Test Case module (mockup v3 look). Pure functions —
// no React — so the repository list, the case detail view and the edit form
// all render the same ID format, pill colours and avatar gradients.

import { isPaletteColor } from '@/lib/colors';

/** "C-0742" — the mockup's case ID format (the DB caseNum, zero-padded to 4). */
export function caseCode(caseNum: number | null | undefined): string {
  if (caseNum == null) return 'C-????';
  return `C-${String(caseNum).padStart(4, '0')}`;
}

/** The ID the next created case will receive, for the "Auto-ID" hint. */
export function nextCaseCode(maxCaseNum: number | null | undefined): string {
  return caseCode((maxCaseNum ?? 0) + 1);
}

export function statusPillClass(status: string): string {
  if (status === 'Active') return 'pill-ok';
  return 'pill-neutral'; // Draft + Archived
}

/** Mockup: Critical → blue, High → orange, everything else → grey. */
export function priorityPillClass(label: string): string {
  const l = label.toLowerCase();
  if (l === 'critical' || l === 'blocker') return 'pill-info';
  if (l === 'high') return 'pill-warn';
  return 'pill-neutral';
}

/** Mockup: Security → orange tint, UI/UX → maroon tint, the rest grey. */
export function typePillClass(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('security')) return 'pill-sec';
  if (l === 'ui' || l.startsWith('ui/') || l.includes('ux')) return 'pill-ux';
  return 'pill-neutral';
}

/**
 * Pill class for a Priority/Severity/Type value, coloured the way the workspace
 * set it in Settings > Test Configuration. Falls back to `fallback` (the old
 * mockup colours) until the workspace's options have loaded.
 */
export function optionPillClass(
  options: { name: string; color: string }[],
  label: string,
  fallback: string,
  ownColor?: string | null,
): string {
  const color = ownColor ?? options.find(o => o.name === label)?.color;
  return color ? `pill-c pill-c-${isPaletteColor(color) ? color : 'slate'}` : fallback;
}

export function resultPillClass(result: string): string {
  switch (result) {
    case 'Passed':
      return 'pill-ok';
    case 'Failed':
      return 'pill-err';
    case 'Blocked':
      return 'pill-warn';
    default:
      return 'pill-neutral';
  }
}

// The mockup gives each owner their own two-stop gradient.
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#FF9F45,#F26B2C)',
  'linear-gradient(135deg,#5C7FE5,#3457D5)',
  'linear-gradient(135deg,#1FA89A,#0E8A85)',
  'linear-gradient(135deg,#5544C5,#3F2DAA)',
  'linear-gradient(135deg,#7E3A4D,#5E2A39)',
  'linear-gradient(135deg,#FFD566,#D89A2C)',
];

export function avatarGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}
