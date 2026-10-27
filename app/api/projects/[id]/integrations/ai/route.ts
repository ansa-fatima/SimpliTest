import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser, requireWorkspacePermission } from '@/lib/auth';
import { ok, bad, parseJson, serverError } from '@/lib/api';
import { AiError, verifyAiKey } from '@/lib/ai';
import {
  PROVIDERS,
  configFromKey,
  isProvider,
  isValidModelId,
  resolveAiConfig,
  type AiProvider,
} from '@/lib/aiConfig';
import { encryptionEnabled, maskSecret, openSecret, sealSecret } from '@/lib/secretBox';
import { normalizeAiSettings } from '@/lib/aiSettings';

export const dynamic = 'force-dynamic';

interface Ctx {
  params: { id: string };
}

// GET /api/projects/:id/integrations/ai -- connection status for the Integrations
// screen. Any member can see whether AI is set up (the Generate button needs to
// know); the key itself is never returned, only a masked hint.
export async function GET(_req: Request, { params }: Ctx) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;
  try {
    const membership = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: userOrRes.id, projectId: params.id } },
    });
    if (!membership && userOrRes.role !== 'SuperAdmin')
      return bad('Not a member of this workspace', 403);

    const [conn, project] = await Promise.all([
      prisma.aiConnection.findUnique({ where: { projectId: params.id } }),
      prisma.project.findUnique({ where: { id: params.id }, select: { aiSettings: true } }),
    ]);
    if (!project) return bad('Workspace not found', 404);

    const cfg = await resolveAiConfig(params.id).catch(() => null);
    let keyHint: string | null = null;
    if (conn) {
      try {
        keyHint = maskSecret(openSecret(conn.apiKey));
      } catch {
        keyHint = '••••••••'; // encrypted with a key this server no longer has
      }
    }

    return ok({
      connected: !!cfg,
      source: cfg?.source ?? null,
      // Which provider answers right now (null when nothing is connected).
      provider: cfg?.provider ?? null,
      keyHint,
      model: conn?.model ?? null,
      tiebreakModel: conn?.tiebreakModel ?? null,
      // Everything the screen needs to offer either provider.
      providers: Object.values(PROVIDERS),
      encrypted: encryptionEnabled(),
      settings: normalizeAiSettings(project.aiSettings),
    });
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/projects/:id/integrations/ai  { provider?, apiKey?, model?, tiebreakModel? }
// Connects (or updates) the workspace's AI provider, key and models. A new key --
// or a new model -- is checked against the AI service first, so a typo is caught
// here. Switching provider needs a key for the new provider.
export async function POST(req: Request, { params }: Ctx) {
  const guard = await requireWorkspacePermission(params.id, 'settings');
  if (guard instanceof NextResponse) return guard;
  try {
    const body = await parseJson<{
      provider?: string;
      apiKey?: string;
      model?: string | null;
      tiebreakModel?: string | null;
    }>(req);
    if (!body) return bad('Invalid request body');

    const existing = await prisma.aiConnection.findUnique({ where: { projectId: params.id } });
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

    const existingProvider: AiProvider = isProvider(existing?.provider)
      ? existing.provider
      : 'anthropic';
    if (body.provider !== undefined && !isProvider(body.provider))
      return bad('That AI provider is not supported.');
    const provider: AiProvider = body.provider ?? existingProvider;
    const switched = !!existing && provider !== existingProvider;
    if (switched && !apiKey)
      return bad(`Enter a ${PROVIDERS[provider].label} API key to switch to it.`);

    // "" / null mean "go back to the default"; anything else must look like a model id.
    const norm = (v: string | null | undefined): string | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null || v === '') return null;
      return v;
    };
    const model = norm(body.model);
    const tiebreakModel = norm(body.tiebreakModel);
    for (const m of [model, tiebreakModel])
      if (m && !isValidModelId(provider, m))
        return bad(
          `That is not a valid ${provider === 'gemini' ? 'Gemini' : 'Claude'} model name.`,
        );

    if (!existing && !apiKey) return bad('Enter an API key to connect.');
    if (apiKey && (apiKey.length < 20 || apiKey.length > 400 || /\s/.test(apiKey)))
      return bad('That does not look like an API key. Paste it exactly as shown, with no spaces.');

    // Model names belong to one provider, so switching starts from its defaults.
    const keep = !switched;
    const nextModel = model === undefined ? (keep ? (existing?.model ?? null) : null) : model;
    const nextTiebreak =
      tiebreakModel === undefined
        ? keep
          ? (existing?.tiebreakModel ?? null)
          : null
        : tiebreakModel;

    // Verify whatever changed: a new key, or a different writing model, against the real service.
    const keyToCheck = apiKey || (existing ? openSecret(existing.apiKey) : '');
    if (apiKey || nextModel !== (existing?.model ?? null))
      await verifyAiKey(configFromKey(provider, keyToCheck, nextModel));
    if (nextTiebreak && (switched || nextTiebreak !== (existing?.tiebreakModel ?? null)))
      await verifyAiKey(configFromKey(provider, keyToCheck, nextTiebreak));

    const data = {
      provider,
      model: nextModel,
      tiebreakModel: nextTiebreak,
      ...(apiKey ? { apiKey: sealSecret(apiKey) } : {}),
    };
    await prisma.aiConnection.upsert({
      where: { projectId: params.id },
      create: {
        projectId: params.id,
        apiKey: sealSecret(apiKey),
        connectedById: guard.id,
        ...data,
      },
      update: data,
    });
    return ok({ saved: true });
  } catch (e) {
    if (e instanceof AiError) return bad(e.message, e.status >= 500 ? 502 : e.status);
    return serverError(e);
  }
}

// DELETE /api/projects/:id/integrations/ai -- disconnect: removes the stored key.
export async function DELETE(_req: Request, { params }: Ctx) {
  const guard = await requireWorkspacePermission(params.id, 'settings');
  if (guard instanceof NextResponse) return guard;
  try {
    await prisma.aiConnection.deleteMany({ where: { projectId: params.id } });
    return ok({ disconnected: true });
  } catch (e) {
    return serverError(e);
  }
}
