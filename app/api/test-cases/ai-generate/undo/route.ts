import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ok, bad, parseJson, serverError } from '@/lib/api';
import { caseWriteDenied } from '@/lib/caseAccess';
import { projectIdForCaseParent } from '@/lib/testCaseOptions';

export const dynamic = 'force-dynamic';

interface Body {
  created?: string[];
  updated?: { id: string; before: Record<string, unknown> }[];
}

// Only these columns can be restored -- the same ones the save route can touch.
const RESTORABLE = [
  'title',
  'desc',
  'preconditions',
  'steps',
  'expected',
  'labels',
  'priority',
  'severity',
  'type',
  'customPriorityId',
  'customSeverityId',
  'customTypeId',
] as const;

// POST /api/test-cases/ai-generate/undo
// Reverses one AI save: deletes the cases it created and puts the previous
// values back on the cases it updated. Every case must be in a workspace the
// caller may edit; the whole undo is one transaction.
export async function POST(req: Request) {
  try {
    const userOrRes = await requireUser();
    if (userOrRes instanceof NextResponse) return userOrRes;
    const user = userOrRes;

    const body = await parseJson<Body>(req);
    if (!body) return bad('Invalid request body');
    const created = Array.isArray(body.created)
      ? body.created.filter(x => typeof x === 'string')
      : [];
    const updated = Array.isArray(body.updated) ? body.updated : [];
    if (created.length === 0 && updated.length === 0) return bad('Nothing to undo.');
    if (created.length + updated.length > 100) return bad('Too many cases to undo at once.');

    // Every case involved must sit in a workspace this user can write to.
    const ids = [...created, ...updated.map(u => u.id)];
    const rows = await prisma.testCase.findMany({
      where: { id: { in: ids } },
      select: { id: true, portalId: true, moduleId: true, suiteId: true },
    });
    const projectIds = new Set<string>();
    for (const r of rows) {
      const p = await projectIdForCaseParent(r);
      if (p) projectIds.add(p);
    }
    for (const p of Array.from(projectIds)) {
      const denied = await caseWriteDenied(user, p);
      if (denied) return bad(denied.message, denied.status);
    }

    await prisma.$transaction(async tx => {
      if (created.length > 0) await tx.testCase.deleteMany({ where: { id: { in: created } } });
      for (const u of updated) {
        const data: Record<string, unknown> = {};
        for (const k of RESTORABLE) if (k in (u.before ?? {})) data[k] = u.before[k];
        if (Object.keys(data).length === 0) continue;
        await tx.testCase.updateMany({
          where: { id: u.id },
          data: data as Prisma.TestCaseUncheckedUpdateManyInput,
        });
      }
    });

    return ok({ undone: created.length + updated.length });
  } catch (e) {
    return serverError(e);
  }
}
