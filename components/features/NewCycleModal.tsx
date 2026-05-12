'use client';

import { useEffect, useState } from 'react';
import { CycleScopeType, Module } from '@/types';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/client';

interface ApiModule {
  id: string;
  name: string;
  features: { id: string; name: string }[];
}

interface NewCycleModalProps {
  modules: Module[]; // unused — we fetch fresh from API
  onClose: () => void;
  onSave: (input: {
    name: string;
    description?: string;
    scopeType: CycleScopeType;
    scopeId?: string | null;
    targetDate?: string | null;
  }) => Promise<void>;
}

export function NewCycleModal({ onClose, onSave }: NewCycleModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scopeType, setScopeType] = useState<CycleScopeType>('All');
  const [scopeId, setScopeId] = useState<string>('');
  const [targetDate, setTargetDate] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [modules, setModules] = useState<ApiModule[]>([]);
  const [loadingModules, setLoadingModules] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.get<ApiModule[]>('/api/modules');
        setModules(list);
        if (list.length > 0) setScopeId(list[0].id);
      } catch (e) {
        setError(`Failed to load modules: ${(e as Error).message}`);
      } finally {
        setLoadingModules(false);
      }
    })();
  }, []);

  const features =
    scopeType === 'Feature'
      ? modules.flatMap(m => m.features.map(f => ({ ...f, moduleName: m.name })))
      : [];

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if ((scopeType === 'Module' || scopeType === 'Feature') && !scopeId) {
      setError(`Pick a ${scopeType.toLowerCase()}`);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        scopeType,
        scopeId: scopeType === 'Module' || scopeType === 'Feature' ? scopeId : null,
        targetDate: targetDate || null,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-[460px] flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 pb-4 pt-5">
          <h2 className="text-base font-bold text-slate-900">New test run</h2>
          <button
            onClick={onClose}
            className="cursor-pointer rounded p-1 text-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 px-6 py-4">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-500">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => {
                setName(e.target.value);
                setError('');
              }}
              placeholder="e.g. Sprint 24 regression"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-500">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional notes about this cycle…"
              className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-500">
              Scope <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {(['All', 'Module', 'Feature'] as CycleScopeType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setScopeType(t)}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs transition-all ${
                    scopeType === t
                      ? 'border-blue-500 bg-indigo-50 font-semibold text-blue-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {t === 'All' ? 'All test cases' : t}
                </button>
              ))}
            </div>
          </div>

          {scopeType === 'Module' && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">Pick module</label>
              {loadingModules ? (
                <span className="text-xs text-slate-400">Loading…</span>
              ) : (
                <select
                  value={scopeId}
                  onChange={e => setScopeId(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                >
                  {modules.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {scopeType === 'Feature' && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">Pick feature</label>
              {loadingModules ? (
                <span className="text-xs text-slate-400">Loading…</span>
              ) : (
                <select
                  value={scopeId}
                  onChange={e => setScopeId(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                >
                  {features.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.moduleName} — {f.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-500">
              Target date (optional)
            </label>
            <input
              type="date"
              value={targetDate}
              onChange={e => setTargetDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
          <p className="text-[11px] text-slate-400">
            On creation, one test run will be auto-generated for every test case in scope (status:{' '}
            <span className="font-semibold">Not Run</span>).
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit}>
            {submitting ? 'Creating…' : 'Create test run'}
          </Button>
        </div>
      </div>
    </div>
  );
}
