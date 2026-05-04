import * as XLSX from 'xlsx';
import { TestCase, TestCycle, ApiTestRun } from '@/types';

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
    'Title': tc.title,
    'Description': tc.desc || '',
    'Module': moduleName,
    'Feature': tc.feature,
    'Priority': tc.priority,
    'Severity': tc.severity,
    'Type': tc.type,
    'Steps': stepsToText(tc.steps),
    'Expected Result': tc.expected || '',
    'Author': tc.author,
    'Created': tc.created,
    'Updated': tc.updatedFull,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 10 }, { wch: 40 }, { wch: 40 }, { wch: 18 }, { wch: 18 },
    { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 60 }, { wch: 40 },
    { wch: 14 }, { wch: 14 }, { wch: 14 },
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
// Cycle results export
// ────────────────────────────────────────────────────────────

export function exportCycleResults(cycle: TestCycle, runs: ApiTestRun[]) {
  if (runs.length === 0) {
    alert('No runs to export.');
    return;
  }

  const rows = runs.map(run => {
    const tc = run.testCase;
    const stepsArr = Array.isArray(tc.steps) ? tc.steps as string[] : [String(tc.steps ?? '')];
    return {
      'Case ID': `TC-${String(tc.caseNum).padStart(4, '0')}`,
      'Title': tc.title,
      'Description': tc.desc || '',
      'Module': tc.feature?.module.name ?? '',
      'Feature': tc.feature?.name ?? '',
      'Priority': tc.priority,
      'Severity': tc.severity,
      'Type': tc.type,
      'Steps': stepsToText(stepsArr),
      'Expected Result': tc.expected || '',
      'Result': run.result === 'NotRun' ? 'Not run' : run.result,
      'Notes': run.notes || '',
      'Executed At': run.executedAt ? new Date(run.executedAt).toLocaleString() : '',
      'Executed By': run.executedBy || '',
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 10 }, { wch: 40 }, { wch: 40 }, { wch: 18 }, { wch: 18 },
    { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 60 }, { wch: 40 },
    { wch: 10 }, { wch: 50 }, { wch: 18 }, { wch: 14 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cycle Results');

  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cycle';
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `SimpliTest_Cycle_${safe(cycle.name)}_${stamp}.xlsx`;

  XLSX.writeFile(wb, filename);
}
