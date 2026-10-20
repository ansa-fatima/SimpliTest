'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { ConfigList, ConfigListItem, CountsAsOption } from './ConfigList';
import '../sts-v3.css';

const RUN_RESULT_COUNTS_AS: CountsAsOption[] = [
  { value: 'PassLike', label: 'Counts as Passed' },
  { value: 'FailLike', label: 'Counts as Failed' },
  { value: 'Neutral', label: 'Neutral (not pass or fail)' },
];

const CATEGORIES = [
  { key: 'RunResult', title: 'Run Result Statuses' },
  { key: 'Priority', title: 'Priorities' },
  { key: 'Severity', title: 'Severities' },
  { key: 'TestType', title: 'Test Types' },
  { key: 'Platform', title: 'Platforms' },
  { key: 'Environment', title: 'Environments' },
] as const;

export function TestConfigurationTab({
  workspaceId,
  canEdit,
}: {
  workspaceId: string;
  canEdit: boolean;
}) {
  const [data, setData] = useState<Record<string, ConfigListItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setError(null);
    try {
      const results = await Promise.all(
        CATEGORIES.map(c =>
          api.get<{ options: ConfigListItem[] }>(`/api/projects/${workspaceId}/options/${c.key}`),
        ),
      );
      const next: Record<string, ConfigListItem[]> = {};
      CATEGORIES.forEach((c, i) => (next[c.key] = results[i].options));
      setData(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return (
    <div>
      {error && (
        <div className="login-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}
      <div className="cfg-grid">
        {CATEGORIES.map(c => (
          <ConfigList
            key={c.key}
            title={c.title}
            items={data[c.key] ?? []}
            canEdit={canEdit}
            loading={loading}
            countsAsOptions={c.key === 'RunResult' ? RUN_RESULT_COUNTS_AS : undefined}
            onCreate={async input => {
              await api.post(`/api/projects/${workspaceId}/options/${c.key}`, input);
              await reload();
            }}
            onDelete={async key => {
              await api.del(`/api/projects/${workspaceId}/options/${c.key}/${key}`);
              await reload();
            }}
          />
        ))}
      </div>
      <p style={{ fontSize: 12, color: 'var(--t-3)', margin: '16px 0 0' }}>
        These values drive dropdowns and colors across Test Cases, Runs, and Reports. Deleting a
        value that&apos;s still in use is blocked until it&apos;s reassigned.
      </p>
    </div>
  );
}
