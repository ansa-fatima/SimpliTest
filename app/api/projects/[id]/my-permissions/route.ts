import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ok, serverError } from '@/lib/api';
import { PERMISSION_KEYS, getWorkspacePermissions } from '@/lib/permissions';
import { roleKeyOf } from '@/lib/roles';

export const dynamic = 'force-dynamic';

// GET /api/projects/:id/my-permissions
// What the signed-in user may do in this workspace, from the Roles & Permissions grid --
// the screens use it to disable actions the server would refuse anyway.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;
  try {
    if (userOrRes.role === 'SuperAdmin') return ok({ permissions: [...PERMISSION_KEYS] });
    const membership = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: userOrRes.id, projectId: params.id } },
    });
    if (!membership) return ok({ permissions: [] });
    const matrix = await getWorkspacePermissions(params.id);
    const role = roleKeyOf(membership);
    return ok({ permissions: PERMISSION_KEYS.filter(k => matrix[k].includes(role)) });
  } catch (e) {
    return serverError(e);
  }
}
