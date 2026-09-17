'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';
import { colorClassesOf } from '@/lib/colors';

// A workspace's Priority/Severity/Test Type options -- built-ins first,
// then any custom ones a SuperAdmin has added in Settings > Test
// Configuration (see lib/options.ts). `key` is what gets submitted to
// /api/test-cases -- either a built-in's enum literal or a custom
// WorkspaceOption.id. Shared by NewTestCaseModal and TestCaseEdit so a
// case's classification pickers look and behave identically whether
// creating or editing.
export interface CaseOption {
  key: string;
  name: string;
  color: string;
}

export interface CaseOptions {
  priority: CaseOption[];
  severity: CaseOption[];
  type: CaseOption[];
}

export function useCaseOptions(projectId: string): CaseOptions {
  const [options, setOptions] = useState<CaseOptions>({ priority: [], severity: [], type: [] });
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ options: CaseOption[] }>(`/api/projects/${projectId}/options/Priority`),
      api.get<{ options: CaseOption[] }>(`/api/projects/${projectId}/options/Severity`),
      api.get<{ options: CaseOption[] }>(`/api/projects/${projectId}/options/TestType`),
    ])
      .then(([p, s, t]) => {
        if (cancelled) return;
        setOptions({ priority: p.options, severity: s.options, type: t.options });
      })
      .catch(() => {
        /* leave empty -- ClassificationField renders nothing until options load */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return options;
}

export function ClassificationField({
  options,
  value,
  onChange,
}: {
  options: CaseOption[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(o => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            'cursor-pointer rounded border px-2 py-1 text-xs font-medium transition-all',
            value === o.key
              ? cn('border-transparent ring-1', colorClassesOf(o.color).pill)
              : 'border-border bg-surface text-text-3 hover:bg-surface-2',
          )}
        >
          {o.name}
        </button>
      ))}
    </div>
  );
}
