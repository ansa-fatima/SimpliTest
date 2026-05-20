import { prisma } from '@/lib/db';
import { ok, serverError } from '@/lib/api';

// GET /api/reports/coverage
//   ?projectId=...
//
// Portal / module coverage = (# test cases with ≥1 executed run) / (# total test cases).
// A test case "has coverage" once any non-NotRun result has been recorded for it.
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const projectId = sp.get('projectId') || undefined;

    const portals = await prisma.portal.findMany({
      where: projectId ? { projectId } : undefined,
      include: {
        modules: {
          include: {
            suites: {
              include: {
                testCases: {
                  select: {
                    id: true,
                    runs: { select: { result: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const portalRows = portals.map(p => {
      let pTotal = 0;
      let pCovered = 0;
      const modules = p.modules.map(m => {
        let mTotal = 0;
        let mCovered = 0;
        for (const s of m.suites) {
          for (const tc of s.testCases) {
            mTotal++;
            const covered = tc.runs.some(r => r.result !== 'NotRun');
            if (covered) mCovered++;
          }
        }
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
