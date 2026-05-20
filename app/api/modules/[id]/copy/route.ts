import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';
import { uniqueName } from '@/lib/copy';

interface Ctx {
  params: { id: string };
}

// POST /api/modules/:id/copy
// Body: { portalId, name?, includeTestCases? }
// Clones the module — including its suites, and optionally each suite's test cases —
// into the destination portal. Resolves name conflicts by appending " (copy)" etc.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const body = await parseJson<{
      portalId?: string;
      name?: string;
      includeTestCases?: boolean;
    }>(req);
    if (!body?.portalId) return bad('portalId is required');

    const source = await prisma.module.findUnique({
      where: { id: params.id },
      include: {
        suites: {
          orderBy: { name: 'asc' },
          include: { testCases: true },
        },
      },
    });
    if (!source) return notFound('Source module not found');

    const targetPortal = await prisma.portal.findUnique({
      where: { id: body.portalId },
      include: { modules: { select: { name: true } } },
    });
    if (!targetPortal) return notFound('Target portal not found');

    const baseName = body.name?.trim() || source.name;
    const newName = uniqueName(
      baseName,
      targetPortal.modules.map(m => m.name),
    );

    const includeCases = body.includeTestCases !== false;

    // One nested create — Prisma writes the module + all suites (+ optional cases) atomically.
    const newModule = await prisma.module.create({
      data: {
        name: newName,
        portalId: targetPortal.id,
        suites: {
          create: source.suites.map(s => ({
            name: s.name,
            ...(includeCases && s.testCases.length > 0
              ? {
                  testCases: {
                    create: s.testCases.map(tc => ({
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
          })),
        },
      },
      include: {
        suites: {
          orderBy: { name: 'asc' },
          include: { _count: { select: { testCases: true } } },
        },
        _count: { select: { suites: true } },
      },
    });

    return ok(
      {
        module: newModule,
        copiedSuites: source.suites.length,
        copiedCases: includeCases
          ? source.suites.reduce((sum, s) => sum + s.testCases.length, 0)
          : 0,
      },
      201,
    );
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
