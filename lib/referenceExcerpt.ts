// A long reference document cannot be sent whole with every test case: it would be
// slow, costly and noisy. Instead each case gets the passages of the document that
// are most relevant to it (shared words with its title, steps and folder), in the
// order they appear, up to a size budget. Short documents are sent as they are.

const STOP = new Set(
  'a an and are as at be but by for from has have in into is it its of on or that the their then this to was were will with when which who not no can may must should shall user users test case cases verify check ensure'.split(
    ' ',
  ),
);

const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 2 && !STOP.has(t));

/** Splits at blank lines / headings, then packs small pieces into chunks of about `size` characters. */
function chunkText(text: string, size = 1200): string[] {
  const pieces = text
    .split(/\n\s*\n|\n(?=#{1,6} )/)
    .map(p => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let cur = '';
  for (const p of pieces) {
    if (cur && cur.length + p.length > size) {
      chunks.push(cur);
      cur = '';
    }
    // A single huge paragraph is cut into pieces of its own.
    if (p.length > size * 2) {
      for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size));
    } else cur = cur ? cur + '\n\n' + p : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export interface Excerpts {
  text: string;
  /** True when the document was longer than the budget and only parts are included. */
  trimmed: boolean;
}

export function pickExcerpts(reference: string, query: string, budget: number): Excerpts {
  if (reference.length <= budget) return { text: reference, trimmed: false };
  const chunks = chunkText(reference);
  const q = new Map<string, number>();
  for (const t of tokens(query)) q.set(t, (q.get(t) ?? 0) + 1);

  // Words that appear in few chunks matter more (a cheap inverse-document-frequency).
  const chunkTokens = chunks.map(c => new Set(tokens(c)));
  const df = new Map<string, number>();
  for (const set of chunkTokens) for (const t of Array.from(set)) df.set(t, (df.get(t) ?? 0) + 1);

  const scored = chunks.map((c, i) => {
    let score = 0;
    for (const [t, n] of Array.from(q)) {
      if (chunkTokens[i].has(t))
        score += (1 + Math.log(1 + n)) * Math.log(1 + chunks.length / (df.get(t) ?? 1));
    }
    return { i, score };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);

  const keep: number[] = [];
  let used = 0;
  for (const s of scored) {
    const len = chunks[s.i].length + 2;
    if (used + len > budget) continue;
    keep.push(s.i);
    used += len;
  }
  // Nothing matched at all: fall back to the start of the document (usually the overview).
  if (keep.length === 0) keep.push(0);
  keep.sort((a, b) => a - b);
  return { text: keep.map(i => chunks[i]).join('\n\n'), trimmed: true };
}
