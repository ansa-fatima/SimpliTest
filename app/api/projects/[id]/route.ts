import { prisma } from '@/lib/db';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';
import { requireRole, requireWorkspacePermission } from '@/lib/auth';
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

// PATCH /api/projects/:id — Settings > General. Rename and/or set the
// default environment/platform pickers prefill for this workspace. Gated on
// the workspace's own "Settings" permission (SuperAdmin by default, see
// lib/permissions.ts) rather than the caller's global role, same reasoning
// as the workspace-scoped fixes made to /api/users/[id] this session.
export async function PATCH(req: Request, { params }: Ctx) {
  const guard = await requireWorkspacePermission(params.id, 'settings');
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await parseJson<{
      name?: string;
      defaultEnvironment?: string | null;
      defaultPlatform?: string | null;
      integrations?: { slack?: boolean; github?: boolean };
    }>(req);

    const data: {
      name?: string;
      defaultEnvironment?: string | null;
      defaultPlatform?: string | null;
      integrations?: object;
    } = {};

    if (body?.name !== undefined) {
      const name = body.name.trim();
      if (!name) return bad('name is required');
      data.name = name;
    }
    if (body?.defaultEnvironment !== undefined) {
      data.defaultEnvironment = body.defaultEnvironment?.trim() || null;
    }
    if (body?.defaultPlatform !== undefined) {
      data.defaultPlatform = body.defaultPlatform?.trim() || null;
    }
    if (body?.integrations !== undefined) {
      data.integrations = {
        slack: !!body.integrations?.slack,
        github: !!body.integrations?.github,
      };
    }
    if (Object.keys(data).length === 0) return bad('nothing to update');

    const project = await prisma.project.update({
      where: { id: params.id },
      data,
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
