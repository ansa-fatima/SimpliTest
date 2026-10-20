'use client';

import { useEffect, useState } from 'react';
import { TestCase } from '@/types';
import { api } from '@/lib/client';
import {
  TestCaseForm,
  FormTreePortal,
  FormTreeSuite,
  TestCaseFormValues,
  CaseStatusValue,
} from '@/components/features/TestCaseForm';
import { caseCode } from '@/components/features/tc-helpers';
import './testcase-v3.css';

interface TestCaseEditProps {
  tc: TestCase;
  projectId: string | null;
  projectName?: string;
  onBack: () => void;
  onSave: (
    // priority/severity/type are category KEYS (see lib/options.ts) --
    // either a built-in enum literal or a custom WorkspaceOption.id -- not
    // narrowed to Priority/Severity/TestType like TestCase's own fields,
    // since a custom selection isn't one of those literals.
    patch: Omit<Partial<TestCase>, 'priority' | 'severity' | 'type'> & {
      priority?: string;
      severity?: string;
      type?: string;
      status?: string;
      ownerId?: string | null;
      portalId?: string;
      moduleId?: string;
      suiteId?: string;
    },
  ) => void | Promise<void>;
}

// The persisted fields the legacy in-memory `TestCase` shape doesn't carry
// (it only has a flattened `feature` string and no status/owner), so the edit
// page fetches the case itself for its real location, status and owner.
interface RawCase {
  portalId: string | null;
  moduleId: string | null;
  suiteId: string | null;
  status: CaseStatusValue;
  ownerId: string | null;
  labels: string[];
}

function containsSuite(suites: FormTreeSuite[], id: string): boolean {
  return suites.some(s => s.id === id || containsSuite(s.children, id));
}

export function TestCaseEdit({ tc, projectId, projectName, onBack, onSave }: TestCaseEditProps) {
  const [tree, setTree] = useState<FormTreePortal[] | null>(null);
  const [raw, setRaw] = useState<RawCase | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tc.apiId || !projectId) {
      setLoadError('This case is not saved yet, so it cannot be edited.');
      return;
    }
    let cancelled = false;
    Promise.all([
      api.get<FormTreePortal[]>(`/api/portals?projectId=${projectId}`),
      api.get<RawCase>(`/api/test-cases/${tc.apiId}`),
    ])
      .then(([t, r]) => {
        if (cancelled) return;
        setTree(t);
        setRaw(r);
      })
      .catch(e => !cancelled && setLoadError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [tc.apiId, projectId]);

  if (loadError || !tree || !raw || !projectId) {
    return (
      <div className="tcv3 main-scroll">
        <div className="empty">
          {loadError ? (
            <>
              <b>Could not open the editor</b>
              {loadError}
            </>
          ) : (
            'Loading…'
          )}
        </div>
      </div>
    );
  }

  // Resolve the case's real parent into the {portal, module, suite} trio the
  // form's Section picker expects.
  let initialLoc: { portalId: string; moduleId?: string; suiteId?: string } | null = null;
  if (raw.suiteId) {
    for (const p of tree) {
      const m = p.modules.find(mod => containsSuite(mod.suites, raw.suiteId!));
      if (m) {
        initialLoc = { portalId: p.id, moduleId: m.id, suiteId: raw.suiteId };
        break;
      }
    }
  } else if (raw.moduleId) {
    const p = tree.find(pp => pp.modules.some(m => m.id === raw.moduleId));
    if (p) initialLoc = { portalId: p.id, moduleId: raw.moduleId };
  } else if (raw.portalId) {
    initialLoc = { portalId: raw.portalId };
  }

  const submit = async (v: TestCaseFormValues) => {
    setError('');
    setSaving(true);
    try {
      await onSave({
        title: v.title,
        sub: v.desc.split('.')[0] || v.title,
        desc: v.desc,
        preconditions: v.preconditions,
        expected: v.expected,
        steps: v.steps,
        priority: v.priority,
        severity: v.severity,
        type: v.type,
        status: v.status,
        ownerId: v.ownerId,
        labels: v.labels,
        attachments: v.attachments,
        // Exactly one parent — the deepest pick wins.
        ...(v.suiteId
          ? { suiteId: v.suiteId }
          : v.moduleId
            ? { moduleId: v.moduleId }
            : { portalId: v.portalId }),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <TestCaseForm
      mode="edit"
      projectId={projectId}
      projectName={projectName ?? ''}
      tree={tree}
      initial={{
        portalId: initialLoc?.portalId ?? '',
        moduleId: initialLoc?.moduleId,
        suiteId: initialLoc?.suiteId,
        title: tc.title,
        desc: tc.desc,
        preconditions: tc.preconditions ?? '',
        expected: tc.expected,
        steps: tc.steps,
        // A custom override wins over the (possibly-placeholder) enum column —
        // same resolution rule as lib/options.ts's optionKeyOf().
        priority: tc.customPriorityId ?? tc.priority,
        severity: tc.customSeverityId ?? tc.severity,
        type: tc.customTypeId ?? tc.type,
        status: raw.status,
        ownerId: raw.ownerId,
        labels: raw.labels?.length ? raw.labels : tc.labels,
        attachments: tc.attachments ?? [],
      }}
      code={caseCode(tc.caseNum)}
      authorName={tc.author}
      meta={{ author: tc.author, created: tc.created, updated: tc.updatedFull }}
      saving={saving}
      error={error}
      onCancel={onBack}
      onSubmit={submit}
    />
  );
}
