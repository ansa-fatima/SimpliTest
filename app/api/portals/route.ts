import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48) || 'portal'
  );
}

// GET /api/portals?projectId=...  — list portals in a project (with their modules + suites)
export async function GET(req: Request) {
  try {
    const projectId = new URL(req.url).searchParams.get('projectId') || undefined;
    // Pull suites flat (with parentId + testCase count) per module, then nest them
    // in JS so the response carries the full recursive tree. Prisma can't recurse
    // arbitrarily, so building it in JS is the cleanest path.
    const portals = await prisma.portal.findMany({
      where: projectId ? { projectId } : undefined,
      include: {
        modules: {
          orderBy: { name: 'asc' },
          include: {
            suites: {
              select: {
                id: true,
                name: true,
                parentId: true,
                _count: { select: { testCases: true } },
              },
            },
            _count: { select: { suites: true, testCases: true } },
          },
        },
        _count: { select: { modules: true, testCases: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Recursive nesting helper — turns a flat suite list into a tree by parentId.
    type FlatSuite = {
      id: string;
      name: string;
      parentId: string | null;
      _count: { testCases: number };
    };
    type NestedSuite = FlatSuite & { children: NestedSuite[] };
    const nestSuites = (flat: FlatSuite[]): NestedSuite[] => {
      const byId = new Map<string, NestedSuite>();
      flat.forEach(s => byId.set(s.id, { ...s, children: [] }));
      const roots: NestedSuite[] = [];
      byId.forEach(node => {
        if (node.parentId && byId.has(node.parentId)) {
          byId.get(node.parentId)!.children.push(node);
        } else {
          roots.push(node);
        }
      });
      // Sort each level alphabetically.
      const sortTree = (nodes: NestedSuite[]) => {
        nodes.sort((a, b) => a.name.localeCompare(b.name));
        nodes.forEach(n => sortTree(n.children));
      };
      sortTree(roots);
      return roots;
    };

    const shaped = portals.map(p => ({
      ...p,
      modules: p.modules.map(m => ({
        ...m,
        suites: nestSuites(m.suites as FlatSuite[]),
      })),
    }));

    return ok(shaped);
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/portals — create a portal inside a project
export async function POST(req: Request) {
  try {
    const body = await parseJson<{
      name?: string;
      projectId?: string;
      icon?: string;
      slug?: string;
    }>(req);
    const name = body?.name?.trim();
    const projectId = body?.projectId?.trim();
    const icon = body?.icon?.trim() || null;
    if (!name) return bad('name is required');
    if (!projectId) return bad('projectId is required');

    const portal = await prisma.portal.create({
      data: {
        name,
        projectId,
        icon,
        slug: body?.slug?.trim() || slugify(name),
      },
    });
    return ok(portal, 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
