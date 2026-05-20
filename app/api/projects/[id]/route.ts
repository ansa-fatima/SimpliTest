import { prisma } from '@/lib/db';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { NextResponse } from 'next/server';

interface Ctx {
  params: { id: string };
}

// GET /api/projects/:id
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: { _count: { select: { portals: true, cycles: true } } },
    });
    if (!project) return notFound('Project not found');
    return ok(project);
  } catch (e) {
    return serverError(e);
  }
}

// PATCH /api/projects/:id — rename (QAManager+)
export async function PATCH(req: Request, { params }: Ctx) {
  const guard = await requireRole('QAManager');
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await parseJson<{ name?: string }>(req);
    const name = body?.name?.trim();
    if (!name) return bad('name is required');

    const project = await prisma.project.update({
      where: { id: params.id },
      data: { name },
    });
    return ok(project);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}

// DELETE /api/projects/:id — cascades to modules, suites, test cases, cycles (SuperAdmin only)
export async function DELETE(_req: Request, { params }: Ctx) {
  const guard = await requireRole('SuperAdmin');
  if (guard instanceof NextResponse) return guard;

  try {
    await prisma.project.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
