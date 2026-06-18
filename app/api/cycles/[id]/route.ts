import { prisma } from '@/lib/db';
import { CycleStatus } from '@prisma/client';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';

interface Ctx {
  params: { id: string };
}

const STATUSES: CycleStatus[] = ['Active', 'Completed', 'Archived'];

// GET /api/cycles/:id
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const cycle = await prisma.testCycle.findUnique({
      where: { id: params.id },
      include: { _count: { select: { runs: true } } },
    });
    if (!cycle) return notFound('Cycle not found');
    return ok(cycle);
  } catch (e) {
    return serverError(e);
  }
}

// PATCH /api/cycles/:id  — rename, change status, or update Manual-mode bookkeeping fields.
// Counts default to 0 if a negative or non-numeric value is sent.
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const body = await parseJson<Record<string, unknown>>(req);
    if (!body) return bad('invalid JSON body');

    const data: Record<string, unknown> = {};

    // Core fields
    if (typeof body.name === 'string') {
      const n = body.name.trim();
      if (!n) return bad('name cannot be empty');
      data.name = n;
    }
    if (typeof body.description === 'string') data.description = body.description;
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status as CycleStatus)) return bad('invalid status');
      data.status = body.status;
    }
    if (body.targetDate !== undefined) {
      data.targetDate = body.targetDate ? new Date(body.targetDate as string) : null;
    }

    // Manual-mode free-text fields (passing null clears; passing string sets).
    const stringFields = [
      'portalName',
      'moduleName',
      'featureName',
      'environment',
      'platform',
      'version',
      'cycleCategory',
      'ticketLink',
    ] as const;
    for (const k of stringFields) {
      const v = body[k];
      if (v === null) data[k] = null;
      else if (typeof v === 'string') data[k] = v.trim() || null;
    }

    // Numeric counts (clamped to non-negative integers).
    const countFields = [
      'issueCount',
      'criticalCount',
      'majorCount',
      'minorCount',
      'doneCount',
      'remainingCount',
      'passedCount',
      'failedCount',
      'blockedCount',
    ] as const;
    for (const k of countFields) {
      const v = body[k];
      if (v === undefined) continue;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        return bad(`${k} must be a non-negative number`);
      }
      data[k] = Math.floor(v);
    }

    if (Object.keys(data).length === 0) return bad('nothing to update');

    const cycle = await prisma.testCycle.update({ where: { id: params.id }, data });
    return ok(cycle);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}

// DELETE /api/cycles/:id  — permanently delete cycle and all its runs (cascade)
// Use PATCH status='Archived' for soft-delete instead.
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await prisma.testCycle.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
