'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';
import '../sts-v3.css';

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

  if (!prefs) return <div className="empty-note">Loading…</div>;

  return (
    <div className="card">
      <div className="card-head">
        <h3>Notification preferences</h3>
        <span className="meta">Applies to you in this workspace</span>
      </div>
      <div>
        {TOGGLES.map((t, i) => (
          <div
            key={t.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '13px 20px',
              borderBottom: i < TOGGLES.length - 1 ? '1px solid var(--bdr)' : 'none',
              fontSize: 13,
              color: 'var(--t-1)',
            }}
          >
            {t.label}
            <button
              type="button"
              role="switch"
              aria-checked={prefs[t.key]}
              aria-label={t.label}
              onClick={() => toggle(t.key)}
              className={cn('toggle', prefs[t.key] && 'on')}
            />
          </div>
        ))}
      </div>
      <div className="card-foot">
        <span style={{ fontSize: 12, color: 'var(--t-3)' }}>
          {error ? (
            <b style={{ color: 'var(--err)' }}>{error}</b>
          ) : saved ? (
            <b style={{ color: 'var(--ok)' }}>Saved ✓</b>
          ) : (
            'Preferences are saved per workspace.'
          )}
        </span>
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginLeft: 'auto' }}
          disabled={saving}
          onClick={save}
        >
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
    </div>
  );
}
