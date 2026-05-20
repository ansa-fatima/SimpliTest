import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48) || 'project'
  );
}

// GET /api/projects — returns workspaces I'm a member of.
export async function GET() {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;

  try {
    const projects = await prisma.project.findMany({
      where: { memberships: { some: { userId: userOrRes.id } } },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { portals: true, cycles: true, memberships: true } },
        memberships: {
          where: { userId: userOrRes.id },
          select: { role: true },
        },
      },
    });
    // Expose the caller's role within each workspace so the UI can disable destructive ops.
    return ok(
      projects.map(p => ({
        ...p,
        myRole: p.memberships[0]?.role ?? null,
        memberships: undefined,
      })),
    );
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/projects — any signed-in user can create a workspace; they become its SuperAdmin.
export async function POST(req: Request) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;

  try {
    const body = await parseJson<{ name?: string }>(req);
    const name = body?.name?.trim();
    if (!name) return bad('name is required');

    let slug = slugify(name);
    let suffix = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const exists = await prisma.project.findUnique({ where: { slug } });
      if (!exists) break;
      suffix++;
      slug = `${slugify(name)}-${suffix}`;
    }

    // Create the workspace + the creator's SuperAdmin membership atomically.
    const project = await prisma.project.create({
      data: {
        name,
        slug,
        memberships: {
          create: { userId: userOrRes.id, role: 'SuperAdmin' },
        },
      },
    });
    return ok(project, 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
