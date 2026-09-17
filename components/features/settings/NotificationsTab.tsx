'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';

interface Preferences {
  cycleCompletion: boolean;
  failedTests: boolean;
  criticalDefects: boolean;
  reopenedDefects: boolean;
  recurringIssues: boolean;
}

const TOGGLES: { key: keyof Preferences; label: string }[] = [
  { key: 'cycleCompletion', label: 'Cycle completion' },
  { key: 'failedTests', label: 'Failed tests' },
  { key: 'criticalDefects', label: 'Critical defects' },
  { key: 'reopenedDefects', label: 'Reopened defects' },
  { key: 'recurringIssues', label: 'Recurring issues' },
];

// Personal per-user preferences for this workspace -- any member can edit
// their own, no "Settings" permission required (unlike the other tabs). No
// email/push sending exists anywhere in this app yet; these persist the
// choice only.
export function NotificationsTab({ workspaceId }: { workspaceId: string }) {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ preferences: Preferences }>(`/api/projects/${workspaceId}/notifications`)
      .then(r => !cancelled && setPrefs(r.preferences))
      .catch(e => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const toggle = (key: keyof Preferences) => {
    if (!prefs) return;
    setPrefs({ ...prefs, [key]: !prefs[key] });
    setSaved(false);
  };

  const save = async () => {
    if (!prefs) return;
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const r = await api.patch<{ preferences: Preferences }>(
        `/api/projects/${workspaceId}/notifications`,
        prefs,
      );
      setPrefs(r.preferences);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!prefs) return <p className="text-[12px] text-text-3">Loading…</p>;

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <ul className="divide-y divide-border">
        {TOGGLES.map(t => (
          <li
            key={t.key}
            className="flex items-center justify-between py-2.5 text-[13px] text-text"
          >
            {t.label}
            <button
              type="button"
              role="switch"
              aria-checked={prefs[t.key]}
              onClick={() => toggle(t.key)}
              className={cn(
                'inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full border px-0.5 transition-colors',
                prefs[t.key] ? 'border-primary bg-primary' : 'border-border bg-surface-2',
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 flex-shrink-0 rounded-full bg-white shadow-sm transition-transform',
                  prefs[t.key] ? 'translate-x-4' : 'translate-x-0',
                )}
              />
            </button>
          </li>
        ))}
      </ul>

      {error && <p className="mt-3 text-[12px] text-danger-text">{error}</p>}
      {saved && !error && <p className="mt-3 text-[12px] text-success">Saved.</p>}

      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="mt-4 inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-2 text-[13px] font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving && <i className="ti ti-loader-2 animate-spin text-[14px]" />}
        Save Preferences
      </button>
    </div>
  );
}
