import { prisma } from '@/lib/db';
import { ok, bad, serverError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { buildRecentActivity } from '@/lib/activity';
import { hasWorkspacePermission } from '@/lib/permissions';
import { roleKeyOf, listWorkspaceRoles } from '@/lib/roles';
import { failedOnlyResultWhereClause } from '@/lib/options';
import { NextResponse } from 'next/server';

// GET /api/members?projectId=...
// Workspace-scoped member list. Caller must be a member
// of the target workspace. Each row carries Membership.role (the user's role
// *inside this workspace*) plus their derived status / lastActiveAt.
export async function GET(req: Request) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;

  const projectId = new URL(req.url).searchParams.get('projectId');
  if (!projectId) return bad('projectId is required');

  try {
    // Caller must belong to this workspace.
    const my = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: userOrRes.id, projectId } },
    });
    if (!my) return bad('Not a member of this workspace', 403);

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { createdById: true },
    });

    const memberships = await prisma.membership.findMany({
      where: { projectId },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            email: true,
            avatarUrl: true,
            passwordHash: true,
            googleId: true,
            microsoftId: true,
            createdAt: true,
            sessions: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { createdAt: true },
            },
          },
        },
      },
    });

    // Per-member workload -- Assigned/Executed/Open Defects, shown on the
    // Teams cards. A test case attaches to portal, module, OR suite directly,
    // so match any of the three to reach every case in this project (same
    // pattern as the Dashboard's wsCase).
    const wsCase = {
      OR: [
        { portal: { projectId } },
        { module: { portal: { projectId } } },
        { suite: { module: { portal: { projectId } } } },
      ],
    };
    // Same "Failed, Blocked kept separate" convention as the Dashboard's
    // Failed tile, extended to a custom FailLike RunResult option (see
    // lib/options.ts).
    const failedFilter = await failedOnlyResultWhereClause(projectId);
    const [assignedGroups, executedGroups, openDefectGroups] = await Promise.all([
      // Assigned -- test cases this member owns.
      prisma.testCase.groupBy({
        by: ['ownerId'],
        where: { ...wsCase, ownerId: { not: null } },
        _count: { _all: true },
      }),
      // Executed -- test runs they've given a verdict to, ever. `executedBy`
      // is free text captured at execution time (same convention the Cycle
      // History / Stability reports already key their Tester filter on), so
      // this only counts runs whose executedBy matches the member's current
      // name/username -- a run logged under a since-changed display name
      // won't be found, same known limitation as those reports.
      prisma.testRun.groupBy({
        by: ['executedBy'],
        where: { executedBy: { not: '' }, cycle: { projectId } },
        _count: { _all: true },
      }),
      // Open Defects -- Failed runs THEY executed, in cycles still Active
      // (not yet Completed/Archived) -- "bugs you found that nobody's closed
      // yet", not every failure they've ever run into.
      prisma.testRun.groupBy({
        by: ['executedBy'],
        where: { executedBy: { not: '' }, ...failedFilter, cycle: { status: 'Active', projectId } },
        _count: { _all: true },
      }),
    ]);
    const assignedByOwner = new Map(assignedGroups.map(g => [g.ownerId, g._count._all]));
    const executedByName = new Map(executedGroups.map(g => [g.executedBy, g._count._all]));
    const openDefectsByName = new Map(openDefectGroups.map(g => [g.executedBy, g._count._all]));

    const items = memberships.map(m => {
      const u = m.user;
      const isActive = !!(u.passwordHash || u.googleId || u.microsoftId);
      const attributionName = u.name || u.username;
      return {
        id: u.id,
        username: u.username,
        name: u.name,
        email: u.email,
        avatarUrl: u.avatarUrl,
        // Workspace role (membership) — a built-in role name or a custom
        // WorkspaceRole.id (see lib/roles.ts). This is what RBAC decisions
        // should use, resolved against the `roles` list below for display.
        role: roleKeyOf(m),
        status: isActive ? 'Active' : 'Pending',
        createdAt: u.createdAt,
        joinedAt: m.joinedAt,
        lastActiveAt: u.sessions[0]?.createdAt ?? null,
        stats: {
          assigned: assignedByOwner.get(u.id) ?? 0,
          executed: executedByName.get(attributionName) ?? 0,
          openDefects: openDefectsByName.get(attributionName) ?? 0,
        },
      };
    });

    // Also surface pending invites (people who haven't joined yet).
    const pendingInvites = await prisma.invite.findMany({
      where: { projectId, status: 'Pending' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        customRoleId: true,
        createdAt: true,
        expiresAt: true,
        token: true,
      },
    });

    const inviteRows = pendingInvites.map(inv => ({
      id: `invite_${inv.id}`,
      username: '',
      name: '',
      email: inv.email,
      avatarUrl: null,
      role: roleKeyOf(inv),
      status: 'Pending' as const,
      createdAt: inv.createdAt,
      joinedAt: null,
      lastActiveAt: null,
      invite: {
        token: inv.token,
        expiresAt: inv.expiresAt,
      },
    }));

    const combined = [...items, ...inviteRows];

    const counts = {
      total: combined.length,
      active: items.length,
      pending: inviteRows.length,
    };

    // Recent Team Activity -- same two real event kinds as the Dashboard
    // (see lib/activity.ts), scoped to this project.
    const [recentRunEvents, recentQuickLogs] = await Promise.all([
      prisma.testRun.findMany({
        where: { executedAt: { not: null }, NOT: { result: 'NotRun' }, cycle: { projectId } },
        orderBy: { executedAt: 'desc' },
        take: 8,
        select: {
          result: true,
          customResult: { select: { name: true } },
          executedAt: true,
          executedBy: true,
          testCase: { select: { caseNum: true } },
          cycle: { select: { name: true } },
        },
      }),
      prisma.testCycle.findMany({
        where: { mode: 'Manual', projectId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          name: true,
          createdAt: true,
          loggedBy: true,
          portalName: true,
          moduleName: true,
          featureName: true,
        },
      }),
    ]);
    const recentActivity = buildRecentActivity(recentRunEvents, recentQuickLogs, 8);
    const [roles, canManageTeam, canEditSettings] = await Promise.all([
      listWorkspaceRoles(projectId),
      hasWorkspacePermission(projectId, 'manageTeamRoles', roleKeyOf(my)),
      hasWorkspacePermission(projectId, 'settings', roleKeyOf(my)),
    ]);

    return ok({
      items: combined,
      counts,
      myRole: roleKeyOf(my),
      // Every role available in this workspace -- 5 built-ins + any custom
      // ones a SuperAdmin has added -- so the client can resolve labels/
      // colors and populate role-assignment dropdowns without a second fetch.
      roles,
      // Whether the CALLER currently holds "Manage Team & Roles" -- checked
      // against the live Permission Matrix, not just "is SuperAdmin", since a
      // SuperAdmin can grant this to another role from the Teams screen.
      canManageTeam,
      // Whether the CALLER currently holds "Settings" -- gates the Settings
      // page's edit affordances (Test Configuration, General, Projects,
      // Integrations). Notifications is a personal preference and stays
      // editable by any member regardless of this flag.
      canEditSettings,
      // Only the workspace creator may change their own role — every other
      // member (even an invited SuperAdmin) can't self-edit it.
      isCreator: !!project?.createdById && project.createdById === userOrRes.id,
      recentActivity,
    });
  } catch (e) {
    return serverError(e);
  }
}
