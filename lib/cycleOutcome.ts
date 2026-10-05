// Shared Testing-Cycle logic used by both the Quick Logs table UI and the
// Excel import/export path, so the derived outcome and the import column
// mapping can never disagree between where a cycle is shown and how it's
// read back in. Pure functions only -- no React, no Prisma -- so this is the
// one place the "what does Open/Pass/Fail mean" and "what columns does the
// template have" questions are answered.

export type CycleOutcome = 'Open' | 'Pass' | 'Fail';

export const CYCLE_OUTCOMES: CycleOutcome[] = ['Open', 'Pass', 'Fail'];

function isOutcome(v: unknown): v is CycleOutcome {
  return v === 'Open' || v === 'Pass' || v === 'Fail';
}

// Counts a cycle's outcome from what's stored. An explicit, user-chosen
// `outcome` always wins; otherwise it's derived from the same done/remaining
// vs. issues-found rule the Stability report uses (see pointFromQuickLog in
// lib/stability.ts) so a historical quick log with no stored outcome reads
// the same way in both places. "Open" is only ever an explicit state --
// derivation only ever yields Pass or Fail.
export function deriveOutcome(c: {
  outcome?: string | null;
  issueCount?: number | null;
  doneCount?: number | null;
  remainingCount?: number | null;
  failedCount?: number | null;
  blockedCount?: number | null;
}): CycleOutcome {
  if (isOutcome(c.outcome)) return c.outcome;
  const done = c.doneCount ?? 0;
  const remaining = c.remainingCount ?? 0;
  const tracked = done > 0 || remaining > 0;
  const issuesOpen = tracked ? remaining > 0 : (c.issueCount ?? 0) > 0;
  const hasCaseFailure = (c.failedCount ?? 0) > 0 || (c.blockedCount ?? 0) > 0;
  return !issuesOpen && !hasCaseFailure ? 'Pass' : 'Fail';
}

// Normalizes free-typed outcome text from an imported sheet ("pass", "FAILED",
// "open", "in progress") to a canonical value, or null when it's blank/
// unrecognized (so the row falls back to count-derived display).
export function normalizeOutcome(raw: unknown): CycleOutcome | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('pass')) return 'Pass';
  if (s.startsWith('fail')) return 'Fail';
  if (s.startsWith('open') || s.includes('progress')) return 'Open';
  return null;
}

// ─── Import / export column schema ──────────────────────────────────────────
// One source of truth for the sheet shape: the export, the sample template,
// and the importer all read these so a file exported from the app re-imports
// cleanly. `key` is the internal field; `header` is the human column title.

export interface CycleColumn {
  key: keyof CycleImportRow;
  header: string;
  /** Column width hint for the exported .xlsx (characters). */
  width: number;
  /** One-line guidance shown in the sample template's instructions row. */
  note: string;
}

export interface CycleImportRow {
  date: string;
  name: string;
  portal: string;
  module: string;
  feature: string;
  environment: string;
  cycleType: string;
  platform: string;
  version: string;
  ticket: string;
  outcome: string;
  qaEngineer: string;
  critical: number;
  major: number;
  minor: number;
  openIssues: number;
  testRunLink: string;
  notes: string;
}

export const CYCLE_COLUMNS: CycleColumn[] = [
  { key: 'date', header: 'Date', width: 12, note: 'YYYY-MM-DD. Required.' },
  {
    key: 'name',
    header: 'Cycle Name',
    width: 50,
    note: 'Title shown on the log, e.g. School Admin - Setting - Activity Log - QA Fixes 2nd Cycle. Optional — blank = Module → Feature.',
  },
  { key: 'module', header: 'Module', width: 22, note: 'Module name. Required.' },
  { key: 'feature', header: 'Feature', width: 22, note: 'Feature / suite name. Optional.' },
  { key: 'portal', header: 'Portal', width: 18, note: 'Portal name. Optional — helps linking.' },
  {
    key: 'environment',
    header: 'Environment',
    width: 14,
    note: 'Production / QA / Staging / Dev.',
  },
  {
    key: 'cycleType',
    header: 'Cycle Type',
    width: 14,
    note: 'Functional / Regression / Stability / UI / Performance / Smoke.',
  },
  {
    key: 'platform',
    header: 'Platform',
    width: 12,
    note: 'Android / iPhone / Web / All / Desktop.',
  },
  { key: 'version', header: 'Version', width: 12, note: 'App version, e.g. v3.0.140.' },
  { key: 'ticket', header: 'Parent Ticket', width: 16, note: 'Jira key or URL, e.g. NPD-11800.' },
  { key: 'outcome', header: 'Outcome', width: 10, note: 'Open / Pass / Fail. Blank = auto.' },
  { key: 'qaEngineer', header: 'QA Engineer', width: 18, note: 'Who ran this cycle.' },
  { key: 'critical', header: 'Critical', width: 9, note: 'Count of critical issues.' },
  { key: 'major', header: 'Major', width: 9, note: 'Count of major issues.' },
  { key: 'minor', header: 'Minor', width: 9, note: 'Count of minor issues.' },
  { key: 'openIssues', header: 'Open Issues', width: 11, note: 'Still-unresolved count.' },
  {
    key: 'testRunLink',
    header: 'Test-Run Link',
    width: 30,
    note: 'External test-run URL. Optional.',
  },
  { key: 'notes', header: 'Notes', width: 40, note: 'Any notes / feedback. Optional.' },
];

// Matches a sheet's header cell to one of our columns, tolerant of case,
// surrounding spaces, and punctuation differences ("Test Run Link" vs
// "Test-Run Link", "Open" vs "Open Issues").
const HEADER_LOOKUP: Record<string, keyof CycleImportRow> = (() => {
  const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const map: Record<string, keyof CycleImportRow> = {};
  for (const col of CYCLE_COLUMNS) map[canon(col.header)] = col.key;
  // A few friendly aliases for hand-made sheets.
  map[canon('Type')] = 'cycleType';
  map[canon('Env')] = 'environment';
  map[canon('Ticket')] = 'ticket';
  map[canon('Open')] = 'openIssues';
  map[canon('Tester')] = 'qaEngineer';
  map[canon('Engineer')] = 'qaEngineer';
  map[canon('Test Run')] = 'testRunLink';
  map[canon('Suite')] = 'feature';
  map[canon('Title')] = 'name';
  map[canon('Name')] = 'name';
  return map;
})();

export function columnKeyForHeader(header: string): keyof CycleImportRow | null {
  const canon = header.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return HEADER_LOOKUP[canon] ?? null;
}

function toInt(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function toStr(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

// Turns a raw sheet row (object keyed by whatever headers the file had) into a
// canonical CycleImportRow. Unknown columns are ignored; missing ones default
// to '' / 0. Does NOT validate -- that's the caller's job (see validateRow).
export function mapSheetRow(raw: Record<string, unknown>): CycleImportRow {
  const row: Record<string, unknown> = {};
  for (const [header, value] of Object.entries(raw)) {
    const key = columnKeyForHeader(header);
    if (key) row[key] = value;
  }
  return {
    date: normalizeDate(toStr(row.date)),
    name: toStr(row.name),
    portal: toStr(row.portal),
    module: toStr(row.module),
    feature: toStr(row.feature),
    environment: toStr(row.environment),
    cycleType: toStr(row.cycleType),
    platform: toStr(row.platform),
    version: toStr(row.version),
    ticket: toStr(row.ticket),
    outcome: normalizeOutcome(row.outcome) ?? '',
    qaEngineer: toStr(row.qaEngineer),
    critical: toInt(row.critical),
    major: toInt(row.major),
    minor: toInt(row.minor),
    openIssues: toInt(row.openIssues),
    testRunLink: toStr(row.testRunLink),
    notes: toStr(row.notes),
  };
}

// Accepts the common date shapes a spreadsheet produces -- an ISO-ish string,
// a US M/D/YYYY, or an Excel serial-ish already-formatted cell -- and returns
// a YYYY-MM-DD string, or '' if it can't be parsed.
export function normalizeDate(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  // Already YYYY-MM-DD (optionally with a time) -- keep the date part.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // M/D/YYYY or MM/DD/YYYY.
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const mm = us[1].padStart(2, '0');
    const dd = us[2].padStart(2, '0');
    return `${us[3]}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  }
  return '';
}

export interface RowValidation {
  ok: boolean;
  errors: string[];
}

// A row is importable when it has a parseable date and a module. Everything
// else is optional. Returns the list of problems so the import preview can
// show exactly which rows will be skipped and why.
export function validateRow(row: CycleImportRow): RowValidation {
  const errors: string[] = [];
  if (!row.date) errors.push('Date is required (YYYY-MM-DD)');
  if (!row.module) errors.push('Module is required');
  return { ok: errors.length === 0, errors };
}
