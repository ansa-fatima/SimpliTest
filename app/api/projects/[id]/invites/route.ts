import { prisma } from '@/lib/db';
import { randomBytes } from 'crypto';
import { ok, bad, conflict, parseJson, prismaError, serverError } from '@/lib/api';
import { requireWorkspacePermission } from '@/lib/auth';
import { isBuiltinRole, roleKeyOf, getWorkspaceRoleKeys } from '@/lib/roles';
import { NextResponse } from 'next/server';

interface Ctx {
  params: { id: string };
}

// 7 days TTL by default.
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// GET /api/projects/:id/invites — list pending invites for the workspace.
// "Manage Team & Roles".
export async function GET(_req: Request, { params }: Ctx) {
  const guard = await requireWorkspacePermission(params.id, 'manageTeamRoles');
  if (guard instanceof NextResponse) return guard;

  try {
    const invites = await prisma.invite.findMany({
      where: { projectId: params.id, status: 'Pending' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        customRoleId: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        token: true,
        invitedBy: { select: { id: true, name: true, username: true, email: true } },
      },
    });
    return ok({
      items: invites.map(i => ({
        ...i,
        role: roleKeyOf(i),
        acceptUrl: acceptUrlFor(i.token),
      })),
    });
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/projects/:id/invites
// Body: { email, role?, name? } -- role is a built-in role name or a custom
// WorkspaceRole.id (see lib/roles.ts). Returns the created invite + shareable
// accept URL. "Manage Team & Roles" (assigning a role to a new teammate is
// itself a role assignment).
export async function POST(req: Request, { params }: Ctx) {
  const guard = await requireWorkspacePermission(params.id, 'manageTeamRoles');
  if (guard instanceof NextResponse) return guard;
  const userOrRes = guard;

  try {
    const body = await parseJson<{ email?: string; role?: string; name?: string }>(req);
    const email = body?.email?.trim().toLowerCase();
    if (!email) return bad('email is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('invalid email');

    const validRoleKeys = await getWorkspaceRoleKeys(params.id);
    const roleKey = body?.role && validRoleKeys.includes(body.role) ? body.role : 'Tester';
    const roleData = isBuiltinRole(roleKey)
      ? { role: roleKey, customRoleId: null }
      : { role: 'Viewer' as const, customRoleId: roleKey };

    // If this email already belongs to a workspace member, short-circuit.
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const alreadyMember = await prisma.membership.findUnique({
        where: { userId_projectId: { userId: existingUser.id, projectId: params.id } },
      });
      if (alreadyMember) {
        return conflict('This email is already a member of the workspace');
      }
    }

    // If there's already a pending invite, refresh it instead of creating a second one.
    const existing = await prisma.invite.findFirst({
      where: { projectId: params.id, email, status: 'Pending' },
    });
    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = existing
      ? await prisma.invite.update({
          where: { id: existing.id },
          data: { ...roleData, token, expiresAt, invitedById: userOrRes.id },
        })
      : await prisma.invite.create({
          data: {
            projectId: params.id,
            email,
            ...roleData,
            token,
            expiresAt,
            invitedById: userOrRes.id,
          },
        });

    return ok(
      {
        id: invite.id,
        email: invite.email,
        role: roleKeyOf(invite),
        token: invite.token,
        expiresAt: invite.expiresAt,
        acceptUrl: acceptUrlFor(invite.token),
      },
      201,
    );
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}

function acceptUrlFor(token: string): string {
  // Front-end will replace with full URL when it knows window.location; for API we return path.
  return `/invite/${token}`;
}
