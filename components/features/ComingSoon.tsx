'use client';

import { cn } from '@/lib/utils';

interface ComingSoonProps {
  title: string;
  subtitle: string;
  icon: string; // Tabler icon class
  /** Optional bullet list of features that will eventually live here. */
  features?: { icon: string; label: string; desc: string }[];
  /** Optional CTA: jump to an existing page that already covers this. */
  cta?: { label: string; icon?: string; onClick: () => void; hint?: string };
}

/**
 * Lightweight placeholder used for sidebar entries (Test plans / Platforms / Settings)
 * that are reachable from the design but not yet built. Keeps navigation believable
 * and links the user to the closest existing functionality.
 */
export function ComingSoon({ title, subtitle, icon, features, cta }: ComingSoonProps) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <h1 className="m-0 mb-1 text-[22px] font-semibold tracking-[-0.01em] text-text">{title}</h1>
        <p className="text-[13px] text-text-2">{subtitle}</p>

        <div className="mt-6 rounded-lg border border-border bg-surface p-8">
          <div className="flex flex-col items-center text-center">
            <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary-light text-primary">
              <i className={cn('ti', icon, 'text-[26px]')} />
            </span>
            <p className="text-[15px] font-semibold text-text">Coming soon</p>
            <p className="mt-1 max-w-[420px] text-[12.5px] text-text-3">
              This page is part of the PRD roadmap. The data model and APIs are partly in place —
              the dedicated UI lands in a follow-up.
            </p>

            {cta && (
              <div className="mt-5 flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={cta.onClick}
                  className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-[7px] text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-primary-hover"
                >
                  {cta.icon && <i className={cn('ti', cta.icon, 'text-[15px]')} />}
                  {cta.label}
                </button>
                {cta.hint && <p className="text-[11px] text-text-3">{cta.hint}</p>}
              </div>
            )}
          </div>

          {features && features.length > 0 && (
            <>
              <div className="my-6 border-t border-border" />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {features.map(f => (
                  <div
                    key={f.label}
                    className="flex flex-col items-start gap-1.5 rounded-md border border-border bg-surface-2/40 p-3 text-left"
                  >
                    <i className={cn('ti', f.icon, 'text-[18px] text-primary')} />
                    <p className="text-[12.5px] font-semibold text-text">{f.label}</p>
                    <p className="text-[11.5px] text-text-3">{f.desc}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
