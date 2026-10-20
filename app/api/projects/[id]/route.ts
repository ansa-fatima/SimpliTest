import { prisma } from '@/lib/db';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';
import { requireWorkspaceRole, requireWorkspacePermission } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { COLOR_KEYS, ICON_KEYS, VISIBILITY_KEYS, normaliseCaseKey } from '@/lib/projectIdentity';

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
      description?: string;
      color?: string | null;
      icon?: string | null;
      caseKey?: string | null;
      visibility?: string;
    }>(req);

    const data: {
      name?: string;
      defaultEnvironment?: string | null;
      defaultPlatform?: string | null;
      integrations?: object;
      description?: string;
      color?: string | null;
      icon?: string | null;
      caseKey?: string | null;
      visibility?: string;
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
    if (body?.description !== undefined) data.description = body.description.trim().slice(0, 500);
    if (body?.color !== undefined) {
      if (body.color !== null && !COLOR_KEYS.includes(body.color)) return bad('invalid color');
      data.color = body.color;
    }
    if (body?.icon !== undefined) {
      if (body.icon !== null && !ICON_KEYS.includes(body.icon)) return bad('invalid icon');
      data.icon = body.icon;
    }
    if (body?.caseKey !== undefined) {
      data.caseKey = body.caseKey ? normaliseCaseKey(body.caseKey) || null : null;
    }
    if (body?.visibility !== undefined) {
      if (!VISIBILITY_KEYS.includes(body.visibility)) return bad('invalid visibility');
      data.visibility = body.visibility;
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

// DELETE /api/projects/:id — cascades to modules, suites, test cases, cycles.
// SuperAdmin only, but checked WITHIN this workspace (a workspace's creator is
// SuperAdmin on its Membership, rarely globally) -- see requireWorkspaceRole.
export async function DELETE(_req: Request, { params }: Ctx) {
  const guard = await requireWorkspaceRole(params.id, 'SuperAdmin');
  if (guard instanceof NextResponse) return guard;

  try {
    await prisma.project.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
