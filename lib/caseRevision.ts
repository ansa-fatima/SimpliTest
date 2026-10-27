// Turns what the AI returned for "Improve with AI" into something safe to show
// and apply: cleaned fields, options mapped to the workspace's real names, and a
// list of exactly which fields differ from the current case. Pure functions --
// no database, no network -- so the rules can be tested on their own.

export type RevisionField =
  | 'title'
  | 'desc'
  | 'preconditions'
  | 'steps'
  | 'expected'
  | 'priority'
  | 'severity'
  | 'type'
  | 'labels';

export const REVISION_FIELDS: RevisionField[] = [
  'title',
  'desc',
  'preconditions',
  'steps',
  'expected',
  'priority',
  'severity',
  'type',
  'labels',
];

/** A test case as the improve flow sees it (option values are display NAMES). */
export interface CaseSnapshot {
  title: string;
  desc: string;
  preconditions: string;
  steps: string[];
  expected: string;
  priority: string;
  severity: string;
  type: string;
  labels: string[];
}

export interface RevisionOptions {
  priority: string[];
  severity: string[];
  type: string[];
}

export interface NormalizedRevision {
  proposed: CaseSnapshot;
  /** Only the fields that really differ from the current case. */
  changedFields: RevisionField[];
  summary: string;
}

// Text that tries to talk to the system instead of describing a test.
const SUSPICIOUS = /ignore (all |any )?(previous|prior|above) instructions|system prompt/i;

const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

const same = (a: string, b: string) => a.trim() === b.trim();

function pick(v: unknown, allowed: string[], current: string): string {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return allowed.find(a => a.toLowerCase() === s) ?? current;
}

function slug(l: unknown): string {
  return str(l, 30).toLowerCase().replace(/\s+/g, '-');
}

export class RevisionError extends Error {}

/**
 * `raw` is the AI's full revised case. Fields it left empty or got wrong fall back
 * to the current value (the AI should never *delete* content by accident), so only
 * deliberate differences survive.
 */
export function normalizeRevision(
  raw: unknown,
  current: CaseSnapshot,
  options: RevisionOptions,
): NormalizedRevision {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const rawSteps = Array.isArray(r.steps)
    ? r.steps
        .map(s => str(s, 400))
        .filter(Boolean)
        .slice(0, 30)
    : [];
  const steps = rawSteps.length > 0 ? rawSteps : current.steps;

  const text = (key: 'desc' | 'preconditions' | 'expected', max: number) => {
    // The AI may legitimately return an empty string only if it was empty before.
    const v = str(r[key], max);
    return v === '' ? current[key] : v;
  };

  const title = str(r.title, 160) || current.title;
  const proposed: CaseSnapshot = {
    title,
    desc: text('desc', 2000),
    preconditions: text('preconditions', 2000),
    steps,
    expected: text('expected', 2000),
    priority: pick(r.priority, options.priority, current.priority),
    severity: pick(r.severity, options.severity, current.severity),
    type: pick(r.type, options.type, current.type),
    labels: Array.isArray(r.labels)
      ? Array.from(new Set(r.labels.map(slug).filter(Boolean))).slice(0, 10)
      : current.labels,
  };

  if (
    SUSPICIOUS.test(proposed.title) ||
    SUSPICIOUS.test(proposed.desc) ||
    SUSPICIOUS.test(proposed.expected) ||
    proposed.steps.some(s => SUSPICIOUS.test(s))
  )
    throw new RevisionError(
      'The AI returned an unusable revision. Try rewording your instruction.',
    );

  const changedFields: RevisionField[] = [];
  if (!same(proposed.title, current.title)) changedFields.push('title');
  if (!same(proposed.desc, current.desc)) changedFields.push('desc');
  if (!same(proposed.preconditions, current.preconditions)) changedFields.push('preconditions');
  if (
    proposed.steps.length !== current.steps.length ||
    proposed.steps.some((s, i) => !same(s, current.steps[i] ?? ''))
  )
    changedFields.push('steps');
  if (!same(proposed.expected, current.expected)) changedFields.push('expected');
  if (proposed.priority !== current.priority) changedFields.push('priority');
  if (proposed.severity !== current.severity) changedFields.push('severity');
  if (proposed.type !== current.type) changedFields.push('type');
  if (
    proposed.labels.length !== current.labels.length ||
    proposed.labels.some((l, i) => l !== current.labels[i])
  )
    changedFields.push('labels');

  return {
    proposed,
    changedFields,
    summary: str(r.summary, 400),
  };
}
