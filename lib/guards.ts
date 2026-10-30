// Server-side checks that make the Roles & Permissions grid (Teams > Roles) real: a write
// route names the permission it needs and how to find the workspace the request touches;
// the caller's role in THAT workspace is then looked up in the grid.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { hasWorkspacePermission, PERMISSION_LABELS, type PermissionKey } from '@/lib/permissions';
import { roleKeyOf } from '@/lib/roles';
import { projectIdForCaseParent } from '@/lib/testCaseOptions';

type Id = string | null | undefined;

/** The JSON body of a request without consuming it (the route reads it again). */
export async function bodyOf(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.clone().json();
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
export const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

// ─── Which workspace does this record belong to? ─────────────────

export const projectOfPortal = async (id: Id) =>
  id
    ? ((await prisma.portal.findUnique({ where: { id }, select: { projectId: true } }))
        ?.projectId ?? null)
    : null;
export const projectOfModule = async (id: Id) =>
  id
    ? ((
        await prisma.module.findUnique({
          where: { id },
          select: { portal: { select: { projectId: true } } },
        })
      )?.portal.projectId ?? null)
    : null;
export const projectOfSuite = async (id: Id) =>
  id
    ? ((
        await prisma.suite.findUnique({
          where: { id },
          select: { module: { select: { portal: { select: { projectId: true } } } } },
        })
      )?.module.portal.projectId ?? null)
    : null;
export const projectOfCase = async (id: Id) => {
  if (!id) return null;
  const row = await prisma.testCase.findUnique({
    where: { id },
    select: { portalId: true, moduleId: true, suiteId: true },
  });
  return row ? projectIdForCaseParent(row) : null;
};
export const projectOfCycle = async (id: Id) =>
  id
    ? ((await prisma.testCycle.findUnique({ where: { id }, select: { projectId: true } }))
        ?.projectId ?? null)
    : null;
export const projectOfRun = async (id: Id) =>
  id
    ? ((
        await prisma.testRun.findUnique({
          where: { id },
          select: { cycle: { select: { projectId: true } } },
        })
      )?.cycle.projectId ?? null)
    : null;
export const projectOfQaPortal = async (id: Id) =>
  id
    ? ((await prisma.qaPortal.findUnique({ where: { id }, select: { projectId: true } }))
        ?.projectId ?? null)
    : null;
export const projectOfQaModule = async (id: Id) =>
  id
    ? ((
        await prisma.qaModule.findUnique({
          where: { id },
          select: { portal: { select: { projectId: true } } },
        })
      )?.portal.projectId ?? null)
    : null;
export const projectOfQaFeature = async (id: Id) =>
  id
    ? ((
        await prisma.qaFeature.findUnique({
          where: { id },
          select: { module: { select: { portal: { select: { projectId: true } } } } },
        })
      )?.module.portal.projectId ?? null)
    : null;

// ─── The check ───────────────────────────────────────────────────

function denied(key: PermissionKey): NextResponse {
  return NextResponse.json(
    {
      error: `Your role does not allow this. It needs the "${PERMISSION_LABELS[key]}" permission.`,
    },
    { status: 403 },
  );
}

/**
 * Null when the caller may do `keys` (any one of them) in the workspace `resolve` finds;
 * otherwise the 401/403 response to return. A record that cannot be found is left to the
 * route to report (404 / 400), exactly as before.
 */
export async function guardWrite(
  keys: PermissionKey | PermissionKey[],
  resolve: () => Promise<Id>,
): Promise<NextResponse | null> {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const projectId = await resolve().catch(() => null);
  if (!projectId) return null;
  if (userOrRes.role === 'SuperAdmin') return null;
  const list = Array.isArray(keys) ? keys : [keys];
  const membership = await prisma.membership.findUnique({
    where: { userId_projectId: { userId: userOrRes.id, projectId } },
  });
  if (!membership)
    return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 });
  for (const k of list) {
    if (await hasWorkspacePermission(projectId, k, roleKeyOf(membership))) return null;
  }
  return denied(list[0]);
}

/**
 * Runs: creating, editing and deleting a test run needs "Create Cycles"; a quick log
 * (aggregate result, no per-case runs) and closing / updating an existing run need
 * "Execute Tests / Quick Logs". `edit` accepts either, so a tester can close a run.
 */
export async function guardCycleWrite(
  cycleId: string,
  mode: 'edit' | 'delete',
): Promise<NextResponse | null> {
  const c = await prisma.testCycle.findUnique({
    where: { id: cycleId },
    select: { projectId: true, mode: true },
  });
  if (!c) return null;
  const keys: PermissionKey[] =
    c.mode === 'Manual'
      ? ['executeTests']
      : mode === 'edit'
        ? ['createCycles', 'executeTests']
        : ['createCycles'];
  return guardWrite(keys, async () => c.projectId);
}
