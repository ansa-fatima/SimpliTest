import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { seedWorkspaceDefaults } from '@/lib/seedWorkspaceDefaults';
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
          select: {
            userId: true,
            role: true,
            user: { select: { name: true, username: true, avatarUrl: true } },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    // Test cases hang off Portal | Module | Suite, so a workspace's case count
    // is the union of the three parent paths.
    const caseCounts = await Promise.all(
      projects.map(p =>
        prisma.testCase.count({
          where: {
            OR: [
              { portal: { projectId: p.id } },
              { module: { portal: { projectId: p.id } } },
              { suite: { module: { portal: { projectId: p.id } } } },
            ],
          },
        }),
      ),
    );
    // Expose the caller's role within each workspace so the UI can disable destructive ops.
    return ok(
      projects.map((p, i) => ({
        ...p,
        myRole: p.memberships.find(m => m.userId === userOrRes.id)?.role ?? null,
        caseCount: caseCounts[i],
        memberCount: p.memberships.length,
        members: p.memberships.slice(0, 4).map(m => ({
          name: m.user.name || m.user.username,
          avatarUrl: m.user.avatarUrl,
        })),
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
        createdById: userOrRes.id,
        memberships: {
          create: { userId: userOrRes.id, role: 'SuperAdmin' },
        },
      },
    });
    // Materialize built-in roles/config options as real rows so they're
    // listable/deletable the same way a custom role or option is -- see
    // lib/seedWorkspaceDefaults.ts.
    await seedWorkspaceDefaults(project.id);
    return ok(project, 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
