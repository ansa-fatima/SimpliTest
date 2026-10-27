// Decides whether a (generated) test case is "the same scenario" as one that
// already exists. Pure functions -- no database, no network -- so the rule can
// be tested on its own and reused by the AI generator and, later, import.
//
// A pair is a NEAR-DUPLICATE when any of these holds:
//   - the titles are almost the same            (titleSim  >= 0.85)
//   - the steps are almost the same             (stepsSim  >= 0.90)
//   - titles AND steps both overlap substantially (combined >= 0.65, where
//     combined = 0.6 * titleSim + 0.4 * stepsSim)

export interface SimilarityCase {
  id?: string;
  title: string;
  steps: string[];
}

export interface SimilarityMatch {
  id: string;
  title: string;
  /** 0..1 -- how alike the closest existing case is overall. */
  similarity: number;
  titleSim: number;
  stepsSim: number;
}

const TITLE_NEAR = 0.85;
const STEPS_NEAR = 0.9;
const COMBINED_NEAR = 0.65;

// Words that say nothing about WHICH scenario a title/step describes.
const STOP = new Set(
  (
    'a an the and or of to in on at for with without by from is are was were be been being it its ' +
    'this that these those as if then when user users should shall will can must able verify verifies ' +
    'verified check checks checked ensure ensures confirm confirms validate validates test tests ' +
    'case scenario correctly properly successfully'
  ).split(' '),
);

// Light stemming so "fails"/"failed"/"failing" and "passwords"/"password" meet.
function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || STOP.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach(t => {
    if (b.has(t)) inter++;
  });
  return inter / (a.size + b.size - inter);
}

/** How much of the case to compare: titles only, or titles and steps. */
export type SimilarityMode = 'titles' | 'titlesSteps';

export function compareCases(
  a: SimilarityCase,
  b: SimilarityCase,
  mode: SimilarityMode = 'titlesSteps',
) {
  const titleSim = jaccard(tokens(a.title), tokens(b.title));
  const stepsSim = jaccard(tokens(a.steps.join(' ')), tokens(b.steps.join(' ')));
  const similarity = Math.max(titleSim, stepsSim, 0.6 * titleSim + 0.4 * stepsSim);
  const isNearDuplicate =
    mode === 'titles'
      ? titleSim >= TITLE_NEAR
      : titleSim >= TITLE_NEAR ||
        stepsSim >= STEPS_NEAR ||
        0.6 * titleSim + 0.4 * stepsSim >= COMBINED_NEAR;
  return { titleSim, stepsSim, similarity, isNearDuplicate };
}

/**
 * For one generated case, the closest existing case -- or null when nothing
 * is a near-duplicate. `existing` entries need an id so the caller can offer
 * "update that one".
 */
export function findNearDuplicate(
  generated: SimilarityCase,
  existing: (SimilarityCase & { id: string })[],
  mode: SimilarityMode = 'titlesSteps',
): SimilarityMatch | null {
  let best: SimilarityMatch | null = null;
  for (const e of existing) {
    const c = compareCases(generated, e, mode);
    if (!c.isNearDuplicate) continue;
    if (!best || c.similarity > best.similarity) {
      best = {
        id: e.id,
        title: e.title,
        similarity: c.similarity,
        titleSim: c.titleSim,
        stepsSim: c.stepsSim,
      };
    }
  }
  return best;
}
