// Parsers shared by the API: a case number ("10504" / "C-10504") and an older-style
// folder reference ("s:<id>"). Readable page addresses live in lib/urls.ts.

/** "10504", "C-10504" or "c10504" -> "10504"; null for anything else (e.g. a database id). */
export function parseCaseRef(value: string | null | undefined): string | null {
  const m = /^c?-?(\d{1,9})$/i.exec((value ?? '').trim());
  return m ? String(Number(m[1])) : null;
}

export type FolderKind = 'portal' | 'module' | 'suite';
const FOLDER_KIND: Record<string, FolderKind> = { p: 'portal', m: 'module', s: 'suite' };

export function parseFolderRef(
  value: string | null | undefined,
): { kind: FolderKind; id: string } | null {
  const m = /^([pms]):([A-Za-z0-9_-]{6,64})$/.exec((value ?? '').trim());
  return m ? { kind: FOLDER_KIND[m[1]], id: m[2] } : null;
}
