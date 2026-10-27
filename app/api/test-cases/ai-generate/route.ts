import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { ok, bad, parseJson, serverError } from '@/lib/api';
import { AiError, generateRawCases, validateGenerated } from '@/lib/ai';
import { applyAiCheck, prepareGeneration, toProposal, type GenerateBody } from '@/lib/aiGenerate';

export const dynamic = 'force-dynamic';

// POST /api/test-cases/ai-generate
// Turns a requirement into proposed test cases. Nothing is saved here -- the
// caller reviews the proposals and saves the ones it wants (see ./save).
// (./stream is the same thing delivered case by case as the AI writes them.)
export async function POST(req: Request) {
  try {
    const userOrRes = await requireUser();
    if (userOrRes instanceof NextResponse) return userOrRes;

    const body = await parseJson<GenerateBody>(req);
    if (!body) return bad('Invalid request body');

    const prep = await prepareGeneration(body, userOrRes);
    if (!prep.ok) return bad(prep.message, prep.status);
    const p = prep.p;

    const raw = await generateRawCases(
      {
        requirement: p.requirement,
        parentPath: p.parentPath,
        count: p.count,
        depth: p.depth,
        style: p.style,
        options: p.options,
        avoidTitles: p.keepTitles,
        attachments: p.attachments,
      },
      p.cfg,
    );
    const cases = validateGenerated(raw, p.options, p.count);
    if (cases.length === 0)
      return bad(
        'The AI did not return any usable test cases. Try rewording the requirement.',
        422,
      );

    // Compare every proposal with what already exists here, so the caller can ask
    // the user whether to create a new case, update the existing one or skip.
    const proposals = cases.map(gc => toProposal(gc, p.existing, p.settings));
    const aiCheck = await applyAiCheck(proposals, p.existing, p.settings, p.cfg);

    return ok({
      cases: proposals,
      options: p.options,
      parentPath: p.parentPath,
      existingCount: p.existing.length,
      settings: p.settings,
      aiCheck,
    });
  } catch (e) {
    if (e instanceof AiError) return bad(e.message, e.status);
    return serverError(e);
  }
}
