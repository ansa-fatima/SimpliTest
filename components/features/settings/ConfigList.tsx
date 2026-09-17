'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { colorClassesOf, PALETTE_COLORS } from '@/lib/colors';

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
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-[13px] font-semibold text-text">{title}</h4>
          {description && <p className="mt-0.5 text-[11px] text-text-3">{description}</p>}
        </div>
        {canEdit && onCreate && (
          <button
            type="button"
            onClick={() => setShowAdd(v => !v)}
            className="inline-flex flex-shrink-0 items-center gap-1 rounded-[7px] border border-border bg-surface px-2.5 py-1 text-[11.5px] font-medium text-text hover:bg-surface-2"
          >
            <i className="ti ti-plus text-[13px]" />
            Add
          </button>
        )}
      </div>

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
        <div className="mb-2 rounded border border-danger/30 bg-danger-bg px-3 py-2 text-[12px] text-danger-text">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-[12px] text-text-3">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-[12px] text-text-3">{emptyLabel}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
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
    <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-2/40 p-2.5">
      <div className="min-w-[140px] flex-1">
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="Name"
          maxLength={40}
          className="w-full rounded border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
        />
      </div>
      {showColor && (
        <select
          value={color}
          onChange={e => setColor(e.target.value)}
          className="rounded border border-border bg-surface px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
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
          value={countsAs}
          onChange={e => setCountsAs(e.target.value)}
          className="rounded border border-border bg-surface px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
        >
          {countsAsOptions.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[7px] border border-border bg-surface px-2.5 py-1.5 text-[12px] font-medium text-text-3 hover:bg-surface-2"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!name.trim() || busy}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-[7px] bg-primary px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <i className="ti ti-loader-2 animate-spin text-[12px]" />}
          Create
        </button>
      </div>
      {err && <p className="w-full text-[11.5px] text-danger-text">{err}</p>}
    </div>
  );
}
