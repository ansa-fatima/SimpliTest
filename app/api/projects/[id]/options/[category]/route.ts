import { prisma } from '@/lib/db';
import { ok, bad, conflict, parseJson, prismaError, serverError } from '@/lib/api';
import { requireUser, requireWorkspacePermission } from '@/lib/auth';
import { listWorkspaceOptions } from '@/lib/options';
import { PALETTE_COLORS, PaletteColor } from '@/lib/colors';
import { OptionCategory, RunResultClass } from '@prisma/client';
import { NextResponse } from 'next/server';

interface Ctx {
  params: { id: string; category: string };
}

const VALID_CATEGORIES: OptionCategory[] = [
  'Priority',
  'Severity',
  'TestType',
  'RunResult',
  'Platform',
  'Environment',
  'Version',
];
function isValidCategory(c: string): c is OptionCategory {
  return (VALID_CATEGORIES as string[]).includes(c);
}
const VALID_RESULT_CLASSES: RunResultClass[] = ['PassLike', 'FailLike', 'Neutral'];

// GET /api/projects/:id/options/:category — every option in this category
// for this workspace, built-ins first. Any member can view (same reference
// every teammate sees in value pickers); only "Settings" can add/delete one.
export async function GET(_req: Request, { params }: Ctx) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;
  if (!isValidCategory(params.category)) return bad('Invalid category');

  try {
    const membership = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: userOrRes.id, projectId: params.id } },
    });
    if (!membership) return bad('Not a member of this workspace', 403);

    const options = await listWorkspaceOptions(params.id, params.category);
    return ok({ options });
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/projects/:id/options/:category — create a custom option.
// Body: { name, color?, countsAs? }. countsAs is REQUIRED for category =
// RunResult -- see lib/options.ts's resultClassOf(): lib/stability.ts and
// the dashboard/report aggregations key off this classification instead of
// the literal string, so a brand-new status has to say whether it counts
// toward pass/fail.
export async function POST(req: Request, { params }: Ctx) {
  if (!isValidCategory(params.category)) return bad('Invalid category');
  const guard = await requireWorkspacePermission(params.id, 'settings');
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await parseJson<{ name?: string; color?: string; countsAs?: string }>(req);
    const name = body?.name?.trim();
    if (!name) return bad('name is required');
    if (name.length > 40) return bad('name must be 40 characters or fewer');

    const color: PaletteColor = PALETTE_COLORS.includes(body?.color as PaletteColor)
      ? (body!.color as PaletteColor)
      : 'slate';

    let countsAs: RunResultClass | null = null;
    if (params.category === 'RunResult') {
      if (!body?.countsAs || !VALID_RESULT_CLASSES.includes(body.countsAs as RunResultClass)) {
        return bad('countsAs is required for a custom run result (PassLike, FailLike, or Neutral)');
      }
      countsAs = body.countsAs as RunResultClass;
    }

    const existing = await prisma.workspaceOption.findUnique({
      where: { projectId_category_name: { projectId: params.id, category: params.category, name } },
    });
    if (existing) return conflict('An option with this name already exists in this category');

    const option = await prisma.workspaceOption.create({
      data: { projectId: params.id, category: params.category, name, color, countsAs },
    });
    return ok(
      {
        key: option.id,
        name: option.name,
        color: option.color,
        isCustom: true,
        isProtected: false,
      },
      201,
    );
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
