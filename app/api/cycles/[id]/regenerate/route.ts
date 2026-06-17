import { prisma } from '@/lib/db';
import { ok, bad, notFound, serverError } from '@/lib/api';

interface Ctx {
  params: { id: string };
}

// POST /api/cycles/:id/regenerate
// Re-evaluates the cycle's scope and inserts a TestRun for every matching case that
// doesn't already have one. Idempotent — safe to call multiple times.
//
// Use when a cycle ended up with zero runs (e.g. wrong scopeId at creation time, or
// new test cases were added after the cycle was created and you want to include them).
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const cycle = await prisma.testCycle.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        projectId: true,
        scopeType: true,
        scopeId: true,
        runs: { select: { testCaseId: true } },
      },
    });
    if (!cycle) return notFound('Cycle not found');

    // Resolve matching case IDs based on the cycle's scope.
    let caseIds: string[] = [];
    if (cycle.scopeType === 'All') {
      const cases = await prisma.testCase.findMany({
        where: { suite: { module: { portal: { projectId: cycle.projectId } } } },
        select: { id: true },
      });
      caseIds = cases.map(c => c.id);
    } else if (cycle.scopeType === 'Module') {
      if (!cycle.scopeId) return bad('Module-scope cycle is missing scopeId');
      const cases = await prisma.testCase.findMany({
        where: { suite: { moduleId: cycle.scopeId } },
        select: { id: true },
      });
      caseIds = cases.map(c => c.id);
    } else if (cycle.scopeType === 'Suite') {
      if (!cycle.scopeId) return bad('Suite-scope cycle is missing scopeId');
      const cases = await prisma.testCase.findMany({
        where: { suiteId: cycle.scopeId },
        select: { id: true },
      });
      caseIds = cases.map(c => c.id);
    } else if (cycle.scopeType === 'Custom') {
      // Custom scope doesn't auto-expand — runs are whatever was hand-picked at creation.
      return bad(
        "Custom-scope cycles can't be auto-regenerated — pick cases explicitly when creating.",
      );
    }

    // Skip cases that already have a run in this cycle.
    const existing = new Set(cycle.runs.map(r => r.testCaseId));
    const newCaseIds = caseIds.filter(id => !existing.has(id));

    if (newCaseIds.length === 0) {
      return ok({
        added: 0,
        matched: caseIds.length,
        message:
          caseIds.length === 0
            ? 'No test cases match this scope. Add cases to the suite/module first.'
            : 'All matching cases already have runs.',
      });
    }

    await prisma.testRun.createMany({
      data: newCaseIds.map(testCaseId => ({ cycleId: cycle.id, testCaseId })),
      skipDuplicates: true,
    });

    return ok({
      added: newCaseIds.length,
      matched: caseIds.length,
      message: `Added ${newCaseIds.length} run(s).`,
    });
  } catch (e) {
    return serverError(e);
  }
}
