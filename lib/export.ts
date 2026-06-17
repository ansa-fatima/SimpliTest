import * as XLSX from 'xlsx';
import { TestCase, TestCycle, ApiTestRun, ApiTestCase } from '@/types';
import { formatCaseId } from './utils';

function stripHtml(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6])>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>\s*/gi, '• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stepsToText(steps: string[]): string {
  if (steps.length === 1 && /<\/?[a-z][\s\S]*>/i.test(steps[0])) {
    return stripHtml(steps[0]);
  }
  return steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

export function exportTestCases(cases: TestCase[], moduleName: string, featureName: string) {
  if (cases.length === 0) {
    alert('No test cases to export.');
    return;
  }

  const rows = cases.map(tc => ({
    'Case ID': tc.id,
    Title: tc.title,
    Description: tc.desc || '',
    Module: moduleName,
    Feature: tc.feature,
    Priority: tc.priority,
    Severity: tc.severity,
    Type: tc.type,
    Steps: stepsToText(tc.steps),
    'Expected Result': tc.expected || '',
    Author: tc.author,
    Created: tc.created,
    Updated: tc.updatedFull,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 10 },
    { wch: 40 },
    { wch: 40 },
    { wch: 18 },
    { wch: 18 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 60 },
    { wch: 40 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
  ];

  // Wrap text in Steps + Expected Result columns
  const range = XLSX.utils.decode_range(ws['!ref']!);
  for (let R = range.s.r + 1; R <= range.e.r; R++) {
    for (const C of [8, 9]) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (ws[addr]) ws[addr].s = { alignment: { wrapText: true, vertical: 'top' } };
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Test Cases');

  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `SimpliTest_${safe(moduleName)}_${safe(featureName)}_${stamp}.xlsx`;

  XLSX.writeFile(wb, filename);
}

// ────────────────────────────────────────────────────────────
// API test-case export
// ────────────────────────────────────────────────────────────

interface ApiExportContext {
  workspace?: string;
  portal?: string;
  module?: string;
  suite?: string;
}

/**
 * Export an array of API test cases to a styled .xlsx with:
 *   • Two sheets — "Test Cases" (full data) + "Summary" (counts).
 *   • Frozen header row + auto-filter on the data sheet.
 *   • Column widths tuned per field (titles wider than IDs etc).
 *   • Wrap text on long text columns (Description / Preconditions / Steps / Expected).
 *   • Header cell flagged as bold via the cell-style schema (honored by xlsx-js-style
 *     and most modern Excel viewers; gracefully ignored by readers that don't support it).
 */
export function exportApiTestCases(cases: ApiTestCase[], ctx: ApiExportContext = {}) {
  if (cases.length === 0) {
    alert('No test cases to export.');
    return;
  }

  // Column definitions — order, header label, width, wrap-text flag.
  const cols: {
    key: keyof RowShape;
    header: string;
    width: number;
    wrap?: boolean;
  }[] = [
    { key: 'id', header: 'Case ID', width: 12 },
    { key: 'title', header: 'Title', width: 44 },
    { key: 'priority', header: 'Priority', width: 11 },
    { key: 'severity', header: 'Severity', width: 11 },
    { key: 'type', header: 'Type', width: 12 },
    { key: 'status', header: 'Status', width: 11 },
    { key: 'module', header: 'Module', width: 20 },
    { key: 'suite', header: 'Suite', width: 22 },
    { key: 'description', header: 'Description', width: 50, wrap: true },
    { key: 'preconditions', header: 'Preconditions', width: 40, wrap: true },
    { key: 'stepCount', header: '#Steps', width: 8 },
    { key: 'steps', header: 'Steps', width: 55, wrap: true },
    { key: 'expected', header: 'Expected Result', width: 45, wrap: true },
    { key: 'owner', header: 'Owner', width: 20 },
    { key: 'author', header: 'Author', width: 18 },
    { key: 'created', header: 'Created', width: 14 },
    { key: 'updated', header: 'Last updated', width: 14 },
  ];

  interface RowShape {
    id: string;
    title: string;
    priority: string;
    severity: string;
    type: string;
    status: string;
    module: string;
    suite: string;
    description: string;
    preconditions: string;
    stepCount: number | string;
    steps: string;
    expected: string;
    owner: string;
    author: string;
    created: string;
    updated: string;
  }

  const rows: RowShape[] = cases.map(c => {
    const stepsArr = Array.isArray(c.steps)
      ? (c.steps as unknown[]).map(s => String(s))
      : c.steps
        ? [String(c.steps)]
        : [];
    const ownerName =
      c.owner?.name?.trim() || c.owner?.username || (c.ownerId ? '— assigned —' : '');
    return {
      id: formatCaseId(c.caseNum) || c.id.slice(0, 8),
      title: c.title,
      priority: c.priority,
      severity: c.severity,
      type: c.type,
      status: c.status,
      module: c.suite?.module?.name ?? c.feature?.module?.name ?? '',
      suite: c.suite?.name ?? c.feature?.name ?? '',
      description: c.desc || '',
      preconditions: c.preconditions || '',
      stepCount: stepsArr.length || '',
      steps: stepsToText(stepsArr),
      expected: c.expected || '',
      owner: ownerName,
      author: c.author || '',
      created: c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '',
      updated: c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : '',
    };
  });

  // Build sheet from a row-of-arrays (lets us style the header explicitly).
  const headerLabels = cols.map(c => c.header);
  const aoa: (string | number)[][] = [
    headerLabels,
    ...rows.map(r => cols.map(c => r[c.key] ?? '')),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths.
  ws['!cols'] = cols.map(c => ({ wch: c.width }));

  // Freeze the first row + add auto-filter across all columns.
  ws['!freeze'] = { xSplit: '0', ySplit: '1', topLeftCell: 'A2', activePane: 'bottomLeft' };
  // SheetJS uses '!freeze' but more reliably the standard is '!ref' + view options.
  // Set view to freeze pane and add filter.
  const lastCol = XLSX.utils.encode_col(cols.length - 1);
  ws['!autofilter'] = { ref: `A1:${lastCol}${rows.length + 1}` };

  // Bold + light fill on the header row.
  const headerStyle = {
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '4F46E5' } }, // brand indigo
    alignment: { horizontal: 'left', vertical: 'center' },
    border: {
      bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
    },
  };
  for (let c = 0; c < cols.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[addr]) ws[addr].s = headerStyle;
  }

  // Wrap text + top-align on long-text columns.
  const wrapStyle = { alignment: { wrapText: true, vertical: 'top' } };
  const wrapCols: number[] = [];
  cols.forEach((c, idx) => {
    if (c.wrap) wrapCols.push(idx);
  });
  for (let r = 1; r <= rows.length; r++) {
    for (const c of wrapCols) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws[addr]) ws[addr].s = wrapStyle;
    }
  }

  // Approximate row heights so long content has room. Excel auto-grows but a hint
  // helps readers like LibreOffice render the wrap correctly on open.
  ws['!rows'] = [{ hpt: 22 }, ...rows.map(() => ({ hpt: 60 }))];

  // ── Workbook + summary sheet ──────────────────────────────
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Test Cases');

  // Compact summary with metadata + counts.
  const byPriority = tallyBy(rows, r => r.priority);
  const bySeverity = tallyBy(rows, r => r.severity);
  const byType = tallyBy(rows, r => r.type);
  const byStatus = tallyBy(rows, r => r.status);
  const summary: (string | number)[][] = [
    ['Simplitest export — Test Cases', ''],
    ['Generated', new Date().toLocaleString()],
    ['Workspace', ctx.workspace ?? ''],
    ['Portal', ctx.portal ?? ''],
    ['Module', ctx.module ?? ''],
    ['Suite', ctx.suite ?? ''],
    ['Total cases', rows.length],
    [''],
    ['Priority', 'Count'],
    ...Object.entries(byPriority).map(([k, v]) => [k, v] as [string, number]),
    [''],
    ['Severity', 'Count'],
    ...Object.entries(bySeverity).map(([k, v]) => [k, v] as [string, number]),
    [''],
    ['Type', 'Count'],
    ...Object.entries(byType).map(([k, v]) => [k, v] as [string, number]),
    [''],
    ['Status', 'Count'],
    ...Object.entries(byStatus).map(([k, v]) => [k, v] as [string, number]),
  ];
  const sws = XLSX.utils.aoa_to_sheet(summary);
  sws['!cols'] = [{ wch: 22 }, { wch: 22 }];
  // Bold the metadata label column.
  for (let r = 0; r < summary.length; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 0 });
    if (sws[addr]) sws[addr].s = { font: { bold: true } };
  }
  XLSX.utils.book_append_sheet(wb, sws, 'Summary');

  // ── Filename ─────────────────────────────────────────────
  const safe = (s: string | undefined) =>
    (s ?? '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || '';
  const stamp = new Date().toISOString().slice(0, 10);
  const segments = [ctx.portal, ctx.module, ctx.suite].map(safe).filter(Boolean).join('_');
  const filename = `Simplitest_${segments || 'TestCases'}_${stamp}.xlsx`;

  XLSX.writeFile(wb, filename);
}

function tallyBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item) || '—';
    out[k] = (out[k] ?? 0) + 1;
  }
  // Sort entries by count desc for nicer reading.
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

// ────────────────────────────────────────────────────────────
// Cycle results export
// ────────────────────────────────────────────────────────────

export function exportCycleResults(cycle: TestCycle, runs: ApiTestRun[]) {
  if (runs.length === 0) {
    alert('No runs to export.');
    return;
  }

  const rows = runs.map(run => {
    const tc = run.testCase;
    const stepsArr = Array.isArray(tc.steps) ? (tc.steps as string[]) : [String(tc.steps ?? '')];
    return {
      'Case ID': `TC-${String(tc.caseNum).padStart(4, '0')}`,
      Title: tc.title,
      Description: tc.desc || '',
      Module: tc.feature?.module.name ?? '',
      Feature: tc.feature?.name ?? '',
      Priority: tc.priority,
      Severity: tc.severity,
      Type: tc.type,
      Steps: stepsToText(stepsArr),
      'Expected Result': tc.expected || '',
      Result: run.result === 'NotRun' ? 'Not run' : run.result,
      Notes: run.notes || '',
      'Executed At': run.executedAt ? new Date(run.executedAt).toLocaleString() : '',
      'Executed By': run.executedBy || '',
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 10 },
    { wch: 40 },
    { wch: 40 },
    { wch: 18 },
    { wch: 18 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 60 },
    { wch: 40 },
    { wch: 10 },
    { wch: 50 },
    { wch: 18 },
    { wch: 14 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cycle Results');

  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cycle';
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `SimpliTest_Cycle_${safe(cycle.name)}_${stamp}.xlsx`;

  XLSX.writeFile(wb, filename);
}
