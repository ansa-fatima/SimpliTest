// A test case's shareable link: `/?case=10504` (the number in "C-10504"). Opening it
// signs the user in if needed and then shows that case.

/** Path + query for a case, e.g. "/?case=10504". */
export function caseHref(caseNum: number): string {
  return `/?case=${caseNum}`;
}

/** Full URL (with origin) -- what "Copy link" puts on the clipboard. */
export function caseUrl(caseNum: number): string {
  return `${window.location.origin}${caseHref(caseNum)}`;
}

/**
 * Reads a `case` query value: "10504", "C-10504" or "c10504" -> "10504". Returns null
 * for anything else (including an id-like string), so a bad link just opens normally.
 */
export function parseCaseRef(value: string | null | undefined): string | null {
  const m = /^c?-?(\d{1,9})$/i.exec((value ?? '').trim());
  return m ? String(Number(m[1])) : null;
}

// ─── Folder links ──────────────────────────────────────────────
// A repository folder (portal / module / suite) is shared as `/?folder=s:<id>`
// (`p:` portal, `m:` module, `s:` suite).

export type FolderKind = 'portal' | 'module' | 'suite';
const FOLDER_PREFIX: Record<FolderKind, string> = { portal: 'p', module: 'm', suite: 's' };

export function folderRef(kind: FolderKind, id: string): string {
  return `${FOLDER_PREFIX[kind]}:${id}`;
}

export function folderHref(kind: FolderKind, id: string): string {
  return `/?folder=${folderRef(kind, id)}`;
}

export function folderUrl(kind: FolderKind, id: string): string {
  return `${window.location.origin}${folderHref(kind, id)}`;
}

export function parseFolderRef(
  value: string | null | undefined,
): { kind: FolderKind; id: string } | null {
  const m = /^([pms]):([A-Za-z0-9_-]{6,64})$/.exec((value ?? '').trim());
  if (!m) return null;
  const kind = (Object.keys(FOLDER_PREFIX) as FolderKind[]).find(k => FOLDER_PREFIX[k] === m[1])!;
  return { kind, id: m[2] };
}

// The folder named by the address when the page first loaded. The repository reads it once,
// even though the address bar is rewritten as the user signs in and navigates.
let initialFolder: ReturnType<typeof parseFolderRef> =
  typeof window === 'undefined'
    ? null
    : parseFolderRef(new URLSearchParams(window.location.search).get('folder'));

export function peekInitialFolder(): ReturnType<typeof parseFolderRef> {
  return initialFolder;
}

export function clearInitialFolder(): void {
  initialFolder = null;
}
