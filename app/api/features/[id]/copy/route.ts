import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';
import { uniqueName } from '@/lib/copy';

interface Ctx {
  params: { id: string };
}

// POST /api/features/:id/copy
// Body: { moduleId, name?, includeTestCases? }
// Clones a suite (legacy "feature") — optionally with its test cases —
// into the destination module. Resolves name conflicts by appending " (copy)" etc.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const body = await parseJson<{
      moduleId?: string;
      name?: string;
      includeTestCases?: boolean;
    }>(req);
    if (!body?.moduleId) return bad('moduleId is required');

    const source = await prisma.suite.findUnique({
      where: { id: params.id },
      include: { testCases: true },
    });
    if (!source) return notFound('Source suite not found');

    const targetModule = await prisma.module.findUnique({
      where: { id: body.moduleId },
      include: { suites: { select: { name: true } } },
    });
    if (!targetModule) return notFound('Target module not found');

    const baseName = body.name?.trim() || source.name;
    const newName = uniqueName(
      baseName,
      targetModule.suites.map(s => s.name),
    );

    const includeCases = body.includeTestCases !== false;

    const newSuite = await prisma.suite.create({
      data: {
        name: newName,
        moduleId: targetModule.id,
        ...(includeCases && source.testCases.length > 0
          ? {
              testCases: {
                create: source.testCases.map(tc => ({
                  title: tc.title,
                  sub: tc.sub,
                  desc: tc.desc,
                  steps: tc.steps as Prisma.InputJsonValue,
                  expected: tc.expected,
                  priority: tc.priority,
                  severity: tc.severity,
                  type: tc.type,
                  status: tc.status,
                  author: tc.author,
                  ownerId: tc.ownerId,
                })),
              },
            }
          : {}),
      },
      include: { _count: { select: { testCases: true } } },
    });

    return ok(
      {
        suite: newSuite,
        copiedCases: includeCases ? source.testCases.length : 0,
      },
      201,
    );
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
