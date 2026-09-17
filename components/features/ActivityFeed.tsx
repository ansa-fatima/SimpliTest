'use client';

import { ActivityEvent } from '@/lib/activity';
import { avatarColour, cn, initials, relativeTime } from '@/lib/utils';

// Shared with the Dashboard's "Recent activity" panel -- same feed, same
// two real event kinds, wherever it's shown (Teams' "Recent Team Activity"
// included).
export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="flex flex-col divide-y divide-border">
      {events.map((e, i) => (
        <div key={i} className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
          <span
            className={cn(
              'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold',
              avatarColour(e.actor),
            )}
          >
            {initials(e.actor)}
          </span>
          <div className="min-w-0 flex-1 text-[12.5px] text-text-2">
            <b className="font-semibold text-text">{e.actor}</b>{' '}
            {e.kind === 'run' ? (
              <>
                marked <span className="font-mono text-[11.5px]">{e.caseLabel}</span> as{' '}
                <span
                  className={
                    e.result === 'Passed'
                      ? 'font-semibold text-success'
                      : e.result === 'Failed'
                        ? 'font-semibold text-danger'
                        : 'font-semibold text-warning'
                  }
                >
                  {e.result}
                </span>{' '}
                in {e.cycleName}
              </>
            ) : (
              <>
                logged a quick log against{' '}
                <span className="font-medium text-text">{e.scopeName}</span>
              </>
            )}
          </div>
          <span className="flex-shrink-0 text-[11px] text-text-3">{relativeTime(e.ts)}</span>
        </div>
      ))}
    </div>
  );
}
