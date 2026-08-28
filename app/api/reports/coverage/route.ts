import { prisma } from '@/lib/db';
import { ok, serverError } from '@/lib/api';

// GET /api/reports/coverage
//   ?projectId=...
//
// Portal / module coverage = (# test cases with ≥1 executed run) / (# total test cases).
// A test case "has coverage" once any non-NotRun result has been recorded for it.
//
// A case attaches to exactly one of Portal, Module, or Suite — so a module's
// total must include its own direct cases PLUS every suite under it, and a
// portal's total must include its own direct cases PLUS every module under it.
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const projectId = sp.get('projectId') || undefined;

    const runsSelect = { id: true, runs: { select: { result: true } } } as const;

    const portals = await prisma.portal.findMany({
      where: projectId ? { projectId } : undefined,
      include: {
        testCases: { select: runsSelect },
        modules: {
          include: {
            testCases: { select: runsSelect },
            suites: {
              include: {
                testCases: { select: runsSelect },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const tally = (cases: { runs: { result: string }[] }[]) => {
      let total = 0;
      let covered = 0;
      for (const tc of cases) {
        total++;
        if (tc.runs.some(r => r.result !== 'NotRun')) covered++;
      }
      return { total, covered };
    };

    const portalRows = portals.map(p => {
      let pTotal = 0;
      let pCovered = 0;
      const modules = p.modules.map(m => {
        const direct = tally(m.testCases);
        const nested = m.suites.reduce(
          (sum, s) => {
            const t = tally(s.testCases);
            return { total: sum.total + t.total, covered: sum.covered + t.covered };
          },
          { total: 0, covered: 0 },
        );
        const mTotal = direct.total + nested.total;
        const mCovered = direct.covered + nested.covered;
        pTotal += mTotal;
        pCovered += mCovered;
        return {
          id: m.id,
          name: m.name,
          totalCases: mTotal,
          covered: mCovered,
          coverage: mTotal === 0 ? 0 : Math.round((mCovered / mTotal) * 100),
        };
      });

      // Cases attached directly to the portal (no module/suite) still count
      // toward the portal's own total, even though they have no module row.
      const portalDirect = tally(p.testCases);
      pTotal += portalDirect.total;
      pCovered += portalDirect.covered;

      return {
        id: p.id,
        name: p.name,
        icon: p.icon,
        totalCases: pTotal,
        covered: pCovered,
        coverage: pTotal === 0 ? 0 : Math.round((pCovered / pTotal) * 100),
        modules: modules.sort((a, b) => a.coverage - b.coverage),
      };
    });

    const grandTotal = portalRows.reduce((sum, p) => sum + p.totalCases, 0);
    const grandCovered = portalRows.reduce((sum, p) => sum + p.covered, 0);
    const overall = grandTotal === 0 ? 0 : Math.round((grandCovered / grandTotal) * 100);

    return ok({
      portals: portalRows,
      totals: {
        totalCases: grandTotal,
        covered: grandCovered,
        overall,
        portals: portalRows.length,
      },
    });
  } catch (e) {
    return serverError(e);
  }
}
