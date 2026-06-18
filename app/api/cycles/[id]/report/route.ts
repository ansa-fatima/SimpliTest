import { prisma } from '@/lib/db';
import { ok, notFound, serverError } from '@/lib/api';
import { Priority, Severity, RunResult } from '@prisma/client';

interface Ctx {
  params: { id: string };
}

const PRIORITIES: Priority[] = ['High', 'Medium', 'Low'];
const SEVERITIES: Severity[] = ['Critical', 'Major', 'Minor'];

// GET /api/cycles/:id/report
// Detailed test-run summary suitable for sharing in QA channels.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const cycle = await prisma.testCycle.findUnique({
      where: { id: params.id },
      include: {
        runs: {
          include: {
            testCase: {
              include: {
                portal: { select: { id: true, name: true } },
                module: { select: { id: true, name: true } },
                suite: { include: { module: { select: { id: true, name: true } } } },
              },
            },
          },
        },
      },
    });
    if (!cycle) return notFound('Cycle not found');

    // Resolve scope name
    let scopeName: string | null = null;
    if (cycle.scopeType === 'All') scopeName = 'All test cases';
    else if (cycle.scopeType === 'Custom') scopeName = 'Custom selection';
    else if (cycle.scopeType === 'Portal' && cycle.scopeId) {
      const p = await prisma.portal.findUnique({
        where: { id: cycle.scopeId },
        select: { name: true },
      });
      scopeName = p?.name ?? null;
    } else if (cycle.scopeType === 'Module' && cycle.scopeId) {
      const m = await prisma.module.findUnique({
        where: { id: cycle.scopeId },
        select: { name: true },
      });
      scopeName = m?.name ?? null;
    } else if (cycle.scopeType === 'Suite' && cycle.scopeId) {
      const s = await prisma.suite.findUnique({
        where: { id: cycle.scopeId },
        select: { name: true, module: { select: { name: true } } },
      });
      scopeName = s ? `${s.module.name} / ${s.name}` : null;
    }

    const counts: Record<RunResult, number> = {
      NotRun: 0,
      Passed: 0,
      Failed: 0,
      Blocked: 0,
      Skipped: 0,
    };
    for (const r of cycle.runs) counts[r.result]++;
    const total = cycle.runs.length;
    const done = total - counts.NotRun;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    const passPercent = total === 0 ? 0 : Math.round((counts.Passed / total) * 100);

    // Breakdown by priority/severity for Failed and Blocked
    const breakdown = (result: RunResult) => {
      const byPriority: Record<Priority, number> = { High: 0, Medium: 0, Low: 0 };
      const bySeverity: Record<Severity, number> = { Critical: 0, Major: 0, Minor: 0 };
      const cases: Array<{
        id: string;
        caseNum: number;
        title: string;
        priority: Priority;
        severity: Severity;
        type: string;
        module: string;
        suite: string;
        notes: string;
        executedAt: string | null;
      }> = [];
      for (const r of cycle.runs) {
        if (r.result !== result) continue;
        const tc = r.testCase;
        byPriority[tc.priority]++;
        bySeverity[tc.severity]++;
        cases.push({
          id: tc.id,
          caseNum: tc.caseNum,
          title: tc.title,
          priority: tc.priority,
          severity: tc.severity,
          type: tc.type,
          // A case attaches to a portal, module, OR suite — resolve whichever holds it.
          module: tc.suite?.module.name ?? tc.module?.name ?? tc.portal?.name ?? '',
          suite: tc.suite?.name ?? '',
          notes: r.notes,
          executedAt: r.executedAt ? r.executedAt.toISOString() : null,
        });
      }
      return { byPriority, bySeverity, cases };
    };

    return ok({
      cycle: {
        id: cycle.id,
        name: cycle.name,
        description: cycle.description,
        status: cycle.status,
        scopeType: cycle.scopeType,
        scopeName,
        createdAt: cycle.createdAt,
        targetDate: cycle.targetDate,
        // Run-context fields (set by both Detailed and Quick-log forms).
        environment: cycle.environment,
        platform: cycle.platform,
        version: cycle.version,
        cycleCategory: cycle.cycleCategory,
        ticketLink: cycle.ticketLink,
        moduleName: cycle.moduleName,
        featureName: cycle.featureName,
      },
      total,
      done,
      percent,
      passPercent,
      counts,
      failed: breakdown('Failed'),
      blocked: breakdown('Blocked'),
      skipped: breakdown('Skipped'),
    });
  } catch (e) {
    return serverError(e);
  }
}
