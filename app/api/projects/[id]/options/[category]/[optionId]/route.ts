import { prisma } from '@/lib/db';
import { ok, bad, notFound, serverError } from '@/lib/api';
import { requireWorkspacePermission } from '@/lib/auth';
import { isBuiltinOptionValue } from '@/lib/options';
import { Priority, Severity, TestType, RunResult, OptionCategory } from '@prisma/client';
import { NextResponse } from 'next/server';

interface Ctx {
  params: { id: string; category: string; optionId: string };
}

// DELETE /api/projects/:id/options/:category/:optionId — remove an option,
// built-in or custom. `optionId` is a category KEY (see lib/options.ts):
// either a built-in's legacy enum literal (e.g. "High") or a
// WorkspaceOption.id. Refuses if any TestCase/TestRun still uses it, same
// "reassign first" guarantee as role deletion. Platform/Environment/Version
// aren't enforced relations (see prisma/schema.prisma's WorkspaceOption
// comment -- TestCycle keeps them as free text), so removing one of those
// is just removing a suggestion; nothing to check.
export async function DELETE(_req: Request, { params }: Ctx) {
  const guard = await requireWorkspacePermission(params.id, 'settings');
  if (guard instanceof NextResponse) return guard;

  try {
    const category = params.category as OptionCategory;
    const option = isBuiltinOptionValue(category, params.optionId)
      ? await prisma.workspaceOption.findFirst({
          where: { projectId: params.id, category, isBuiltin: true, name: params.optionId },
        })
      : await prisma.workspaceOption.findUnique({ where: { id: params.optionId } });
    if (!option || option.projectId !== params.id || option.category !== params.category) {
      return notFound('Option not found');
    }

    const usageCount = await countUsage(params.id, option);
    if (usageCount > 0) {
      return bad(
        `${usageCount} test case(s)/run(s) still use this value — reassign them first`,
        409,
      );
    }

    await prisma.workspaceOption.delete({ where: { id: option.id } });
    return ok({ deleted: true });
  } catch (e) {
    return serverError(e);
  }
}

// A test case attaches to portal, module, OR suite directly, so match any
// of the three to reach every case in this project -- same pattern already
// used by the Dashboard/Members workload queries (see their `wsCase`).
function wsCaseFilter(projectId: string) {
  return {
    OR: [
      { portal: { projectId } },
      { module: { portal: { projectId } } },
      { suite: { module: { portal: { projectId } } } },
    ],
  };
}

async function countUsage(
  projectId: string,
  option: {
    id: string;
    category: OptionCategory;
    name: string;
    isBuiltin: boolean;
  },
): Promise<number> {
  switch (option.category) {
    case 'Priority':
      return prisma.testCase.count({
        where: {
          AND: [
            wsCaseFilter(projectId),
            {
              OR: [
                { customPriorityId: option.id },
                ...(option.isBuiltin
                  ? [{ customPriorityId: null, priority: option.name as Priority }]
                  : []),
              ],
            },
          ],
        },
      });
    case 'Severity':
      return prisma.testCase.count({
        where: {
          AND: [
            wsCaseFilter(projectId),
            {
              OR: [
                { customSeverityId: option.id },
                ...(option.isBuiltin
                  ? [{ customSeverityId: null, severity: option.name as Severity }]
                  : []),
              ],
            },
          ],
        },
      });
    case 'TestType':
      return prisma.testCase.count({
        where: {
          AND: [
            wsCaseFilter(projectId),
            {
              OR: [
                { customTypeId: option.id },
                ...(option.isBuiltin
                  ? [{ customTypeId: null, type: option.name as TestType }]
                  : []),
              ],
            },
          ],
        },
      });
    case 'RunResult':
      return prisma.testRun.count({
        where: {
          cycle: { projectId },
          OR: [
            { customResultId: option.id },
            ...(option.isBuiltin
              ? [{ customResultId: null, result: option.name as RunResult }]
              : []),
          ],
        },
      });
    case 'Platform':
    case 'Environment':
    case 'Version':
      return 0;
    default:
      return 0;
  }
}
