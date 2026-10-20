'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { colorClassesOf, PALETTE_COLORS } from '@/lib/colors';
import { SIco } from '@/components/layout/sts-icons';
import '../sts-v3.css';

export interface ConfigListItem {
  key: string;
  name: string;
  color: string;
  isCustom: boolean;
  isProtected: boolean;
}

export interface CountsAsOption {
  value: string;
  label: string;
}

interface ConfigListProps {
  title: string;
  description?: string;
  items: ConfigListItem[];
  canEdit: boolean;
  loading?: boolean;
  error?: string | null;
  /** Hide the color dot/picker for a list where color isn't meaningful (e.g. Versions). */
  showColor?: boolean;
  /** When set, adding a new item requires picking one of these (RunResult only). */
  countsAsOptions?: CountsAsOption[];
  /** Omit to hide the "Add" affordance entirely -- e.g. Modules & Suites,
   *  where creation belongs to the test-case tree's portal-aware flow, but
   *  rename/delete still make sense from here. */
  onCreate?: (input: { name: string; color: string; countsAs?: string }) => Promise<void>;
  onDelete: (key: string, name: string) => Promise<void>;
  emptyLabel?: string;
}

// Add/delete a workspace-scoped, optionally-colored value list -- the one
// component every Test Configuration + Projects list in Settings shares
// (Priorities, Severities, Test Types, Run Result Statuses, Platforms,
// Environments, Versions), mirroring the create/delete pattern already
// shipped for custom roles (see Members.tsx's AddRoleForm/deleteRole).
export function ConfigList({
  title,
  description,
  items,
  canEdit,
  loading,
  error,
  showColor = true,
  countsAsOptions,
  onCreate,
  onDelete,
  emptyLabel = 'None yet.',
}: ConfigListProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const deleteItem = async (key: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? Anything still using it must be moved off first.`))
      return;
    setDeletingKey(key);
    try {
      await onDelete(key, name);
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
        {canEdit && onCreate && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowAdd(v => !v)}
          >
            <SIco name="plus" /> Add
          </button>
        )}
      </div>
      <div className="card-pad">
        {description && (
          <p style={{ fontSize: 12, color: 'var(--t-3)', margin: '0 0 12px' }}>{description}</p>
        )}

        {showAdd && onCreate && (
          <AddItemForm
            showColor={showColor}
            countsAsOptions={countsAsOptions}
            onCreate={async input => {
              await onCreate(input);
              setShowAdd(false);
            }}
            onCancel={() => setShowAdd(false)}
          />
        )}

        {error && (
          <div className="login-error" style={{ marginBottom: 10 }}>
            {error}
          </div>
        )}

        {loading ? (
          <p style={{ fontSize: 12, color: 'var(--t-3)', margin: 0 }}>Loading…</p>
        ) : items.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--t-3)', margin: 0 }}>{emptyLabel}</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {items.map(item => {
              const classes = colorClassesOf(item.color);
              return (
                <span
                  key={item.key}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ring-1',
                    classes.pill,
                  )}
                >
                  {showColor && <span className={cn('h-1.5 w-1.5 rounded-full', classes.dot)} />}
                  {item.name}
                  {canEdit && (
                    <button
                      type="button"
                      disabled={deletingKey === item.key}
                      onClick={() => deleteItem(item.key, item.name)}
                      title={`Delete "${item.name}"`}
                      className="ml-0.5 rounded p-0.5 hover:bg-black/10"
                    >
                      {deletingKey === item.key ? (
                        <i className="ti ti-loader-2 animate-spin text-[10px]" />
                      ) : (
                        <i className="ti ti-x text-[10px]" />
                      )}
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AddItemForm({
  showColor,
  countsAsOptions,
  onCreate,
  onCancel,
}: {
  showColor: boolean;
  countsAsOptions?: CountsAsOption[];
  onCreate: (input: { name: string; color: string; countsAs?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(PALETTE_COLORS[0]);
  const [countsAs, setCountsAs] = useState<string>(countsAsOptions?.[0]?.value ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setErr(null);
    setBusy(true);
    try {
      await onCreate({ name: trimmed, color, ...(countsAsOptions ? { countsAs } : {}) });
      setName('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        padding: 10,
        marginBottom: 12,
        background: 'var(--brand-50)',
        border: '1px solid var(--brand-bdr)',
        borderRadius: 'var(--r)',
      }}
    >
      <input
        autoFocus
        className="input"
        style={{ flex: 1, minWidth: 140, width: 'auto' }}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="Name"
        maxLength={40}
      />
      {showColor && (
        <select
          className="select"
          style={{ width: 'auto' }}
          value={color}
          onChange={e => setColor(e.target.value)}
        >
          {PALETTE_COLORS.map(c => (
            <option key={c} value={c}>
              {c[0].toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>
      )}
      {countsAsOptions && (
        <select
          className="select"
          style={{ width: 'auto' }}
          value={countsAs}
          onChange={e => setCountsAs(e.target.value)}
        >
          {countsAsOptions.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <button type="button" className="btn btn-ghost" onClick={onCancel}>
        Cancel
      </button>
      <button
        type="button"
        className="btn btn-primary"
        disabled={!name.trim() || busy}
        onClick={submit}
      >
        {busy ? 'Creating…' : 'Create'}
      </button>
      {err && (
        <p style={{ width: '100%', margin: 0, fontSize: 11.5, color: 'var(--err)' }}>{err}</p>
      )}
    </div>
  );
}
