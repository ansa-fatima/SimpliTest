import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { bad, parseJson, serverError } from '@/lib/api';
import { AiError, streamRawCases, validateGenerated } from '@/lib/ai';
import {
  applyAiCheck,
  prepareGeneration,
  toProposal,
  type GenerateBody,
  type Proposal,
} from '@/lib/aiGenerate';

export const dynamic = 'force-dynamic';

// POST /api/test-cases/ai-generate/stream
// Same request and same validation as ../ (the plain route), but the answer is a
// server-sent-event stream so the preview fills in case by case while the AI is
// still writing:
//   event: meta      {options, parentPath, existingCount, settings}
//   event: case      <Proposal>             -- one per finished test case
//   event: verdicts  [{index, verdict, match, source}]  -- only if the AI double-check ran
//   event: done      {aiCheck, total}
//   event: error     {message}              -- cases already sent stay valid
// Anything wrong with the REQUEST itself is a normal JSON error response, sent
// before the stream starts.
export async function POST(req: Request) {
  try {
    const userOrRes = await requireUser();
    if (userOrRes instanceof NextResponse) return userOrRes;

    const body = await parseJson<GenerateBody>(req);
    if (!body) return bad('Invalid request body');

    const prep = await prepareGeneration(body, userOrRes);
    if (!prep.ok) return bad(prep.message, prep.status);
    const p = prep.p;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const send = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            );
          } catch {
            closed = true; // the browser went away
          }
        };

        const proposals: Proposal[] = [];
        const seen = new Set<string>();
        try {
          send('meta', {
            options: p.options,
            parentPath: p.parentPath,
            existingCount: p.existing.length,
            settings: p.settings,
          });

          await streamRawCases(
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
            raw => {
              if (proposals.length >= p.count) return;
              const [gc] = validateGenerated([raw], p.options, 1);
              if (!gc) return;
              const key = gc.title.toLowerCase();
              if (seen.has(key)) return;
              seen.add(key);
              const proposal = toProposal(gc, p.existing, p.settings);
              proposals.push(proposal);
              send('case', proposal);
            },
            req.signal,
          );

          if (proposals.length === 0) {
            send('error', {
              message:
                'The AI did not return any usable test cases. Try rewording the requirement.',
            });
          } else {
            // The AI double-check needs the whole set, so it runs once at the end.
            const aiCheck = await applyAiCheck(proposals, p.existing, p.settings, p.cfg);
            if (aiCheck === 'applied') {
              send(
                'verdicts',
                proposals.map((x, i) => ({
                  index: i,
                  verdict: x.verdict,
                  match: x.match,
                  source: x.source,
                })),
              );
            }
            send('done', { aiCheck, total: proposals.length });
          }
        } catch (e) {
          if (!req.signal.aborted) {
            send('error', {
              message: e instanceof AiError ? e.message : 'Something went wrong. Please try again.',
            });
          }
        } finally {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Tell proxies (nginx) not to buffer the stream.
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (e) {
    return serverError(e);
  }
}
