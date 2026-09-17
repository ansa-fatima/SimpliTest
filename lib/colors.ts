// Shared named-color palette -- every colorable per-workspace list (roles,
// and now Priority/Severity/Test Type/Run Result/Platform/Environment/
// Version config options, see lib/options.ts) picks from this same small set
// instead of an arbitrary hex value, so every dot/pill in the app renders
// with a real, themed color. Matches lib/roles.ts's ROLE_COLORS.
export const PALETTE_COLORS = [
  'red',
  'indigo',
  'emerald',
  'amber',
  'slate',
  'blue',
  'pink',
  'teal',
] as const;
export type PaletteColor = (typeof PALETTE_COLORS)[number];

export const COLOR_CLASSES: Record<
  PaletteColor,
  { pill: string; dot: string; text: string; borderL: string }
> = {
  red: {
    pill: 'bg-red-50 text-red-700 ring-red-200',
    dot: 'bg-red-500',
    text: 'text-red-700',
    borderL: 'border-l-red-400',
  },
  indigo: {
    pill: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    dot: 'bg-indigo-500',
    text: 'text-indigo-700',
    borderL: 'border-l-indigo-400',
  },
  emerald: {
    pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    dot: 'bg-emerald-500',
    text: 'text-emerald-700',
    borderL: 'border-l-emerald-400',
  },
  amber: {
    pill: 'bg-amber-50 text-amber-700 ring-amber-200',
    dot: 'bg-amber-500',
    text: 'text-amber-700',
    borderL: 'border-l-amber-400',
  },
  slate: {
    pill: 'bg-slate-100 text-slate-600 ring-slate-200',
    dot: 'bg-slate-400',
    text: 'text-slate-600',
    borderL: 'border-l-slate-400',
  },
  blue: {
    pill: 'bg-blue-50 text-blue-700 ring-blue-200',
    dot: 'bg-blue-500',
    text: 'text-blue-700',
    borderL: 'border-l-blue-400',
  },
  pink: {
    pill: 'bg-pink-50 text-pink-700 ring-pink-200',
    dot: 'bg-pink-500',
    text: 'text-pink-700',
    borderL: 'border-l-pink-400',
  },
  teal: {
    pill: 'bg-teal-50 text-teal-700 ring-teal-200',
    dot: 'bg-teal-500',
    text: 'text-teal-700',
    borderL: 'border-l-teal-400',
  },
};

export function isPaletteColor(v: string): v is PaletteColor {
  return (PALETTE_COLORS as readonly string[]).includes(v);
}

export function colorClassesOf(color: string): {
  pill: string;
  dot: string;
  text: string;
  borderL: string;
} {
  return COLOR_CLASSES[isPaletteColor(color) ? color : 'slate'];
}
