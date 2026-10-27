import { prisma } from '@/lib/db';
import { hasWorkspacePermission } from '@/lib/permissions';
import { roleKeyOf } from '@/lib/roles';

/**
 * Can this user create/edit test cases in this workspace?
 * Returns null when allowed, or the error message + status to send back.
 * SuperAdmins always pass; everyone else needs membership plus the workspace's
 * "Manage test cases" permission.
 */
export async function caseWriteDenied(
  user: { id: string; role: string },
  projectId: string,
): Promise<{ message: string; status: number } | null> {
  if (user.role === 'SuperAdmin') return null;
  const membership = await prisma.membership.findUnique({
    where: { userId_projectId: { userId: user.id, projectId } },
  });
  if (!membership) return { message: 'Not a member of this workspace', status: 403 };
  const allowed = await hasWorkspacePermission(projectId, 'manageTestCases', roleKeyOf(membership));
  if (!allowed)
    return { message: 'You do not have permission to create test cases here.', status: 403 };
  return null;
}
