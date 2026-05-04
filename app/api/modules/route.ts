import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

// GET /api/modules — list all modules with their features
export async function GET() {
  try {
    const modules = await prisma.module.findMany({
      include: {
        features: { orderBy: { name: 'asc' } },
        _count: { select: { features: true } },
      },
      orderBy: { name: 'asc' },
    });
    return ok(modules);
  } catch (e) { return serverError(e); }
}

// POST /api/modules — create a module
export async function POST(req: Request) {
  try {
    const body = await parseJson<{ name?: string }>(req);
    const name = body?.name?.trim();
    if (!name) return bad('name is required');

    const mod = await prisma.module.create({ data: { name } });
    return ok(mod, 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
