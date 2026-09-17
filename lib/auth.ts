import { prisma } from '@/lib/db';
import { UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { PermissionKey, PERMISSION_LABELS, hasWorkspacePermission } from '@/lib/permissions';
import { roleKeyOf } from '@/lib/roles';

const SESSION_COOKIE = 'simplitest_session';
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/** Create a session row + return the token (caller sets the cookie). */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await prisma.session.create({ data: { token, userId, expiresAt } });
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token } }).catch(() => {});
}

export interface SessionUser {
  id: string;
  username: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl: string | null;
}

// Permission hierarchy (higher index = more privileged)
const ROLE_RANK: Record<UserRole, number> = {
  Viewer: 0,
  Developer: 1,
  Tester: 2,
  QAManager: 3,
  SuperAdmin: 4,
};

/** True if `user.role` is at least `min` in the hierarchy. */
export function hasRole(user: SessionUser, min: UserRole): boolean {
  return ROLE_RANK[user.role] >= ROLE_RANK[min];
}

/** Read the current user from the request cookie. Returns null if not signed in. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session) return null;

  // Expired? clean up + bail.
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return {
    id: session.user.id,
    username: session.user.username,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    avatarUrl: session.user.avatarUrl ?? null,
  };
}

/** Helper to require auth in an API route. Returns user or a 401 response. */
export async function requireUser(): Promise<SessionUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  return user;
}

/**
 * Require both auth and a minimum role. Use at the top of API routes:
 *
 *   const userOrRes = await requireRole('QAManager');
 *   if (userOrRes instanceof NextResponse) return userOrRes;
 *   const user = userOrRes;
 *
 * Returns the user if authorized, or a 401/403 NextResponse if not.
 */
export async function requireRole(minRole: UserRole): Promise<SessionUser | NextResponse> {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;
  if (!hasRole(userOrRes, minRole)) {
    return NextResponse.json(
      { error: `Insufficient permissions (requires ${minRole} or higher)` },
      { status: 403 },
    );
  }
  return userOrRes;
}

/**
 * Require auth AND a minimum role WITHIN a specific workspace -- checked
 * against the caller's Membership.role for that project, OR their global
 * User.role, whichever is higher. Most people are only ever elevated the
 * first way (e.g. a project's creator is made SuperAdmin on that Membership,
 * never globally), so gating solely on the global role -- what requireRole()
 * alone does -- 403s every real admin action taken from a workspace whose
 * creator's global role was never separately promoted. Use this instead of
 * requireRole() for any route whose `minRole` is meant to be scoped to one
 * project (member management, project settings, etc).
 */
export async function requireWorkspaceRole(
  projectId: string,
  minRole: UserRole,
): Promise<SessionUser | NextResponse> {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;
  if (hasRole(userOrRes, minRole)) return userOrRes;

  const membership = await prisma.membership.findUnique({
    where: { userId_projectId: { userId: userOrRes.id, projectId } },
  });
  if (membership && hasRole({ ...userOrRes, role: membership.role }, minRole)) {
    return userOrRes;
  }
  return NextResponse.json(
    { error: `Requires ${minRole} or higher (globally, or in this workspace)` },
    { status: 403 },
  );
}

/**
 * Require auth AND a specific, SuperAdmin-editable workspace permission --
 * checked against Project.permissions (see lib/permissions.ts), not a fixed
 * role rank. Purely workspace-scoped (no global-role fallback): a
 * workspace's own Roles & Permissions matrix is the whole point, so a
 * global role can't bypass what a SuperAdmin configured for this specific
 * workspace. Use this instead of requireWorkspaceRole() for any action a
 * SuperAdmin can toggle on the Teams screen's Permission Matrix.
 */
export async function requireWorkspacePermission(
  projectId: string,
  key: PermissionKey,
): Promise<SessionUser | NextResponse> {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;

  const membership = await prisma.membership.findUnique({
    where: { userId_projectId: { userId: userOrRes.id, projectId } },
  });
  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 });
  }
  const allowed = await hasWorkspacePermission(projectId, key, roleKeyOf(membership));
  if (!allowed) {
    return NextResponse.json(
      { error: `Requires the "${PERMISSION_LABELS[key]}" permission in this workspace` },
      { status: 403 },
    );
  }
  return userOrRes;
}

/** Set the session cookie on a NextResponse. */
export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date): NextResponse {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
  return res;
}

/** Clear the session cookie on a NextResponse. */
export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(0),
  });
  return res;
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
