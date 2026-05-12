'use client';

import { useState, useMemo } from 'react';
import { Priority, Severity, TestType, Module } from '@/types';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { Button } from '@/components/ui/Button';

interface TestCaseCreateProps {
  modules: Module[];
  defaultModule: string;
  defaultFeature: string;
  onCancel: () => void;
  onSave: (data: {
    module: string;
    feature: string;
    priority: Priority;
    severity: Severity;
    type: TestType;
    title: string;
    desc: string;
    steps: string[];
    expected: string;
  }) => void;
}

const TYPES: TestType[] = ['Functional', 'Regression', 'Smoke', 'Sanity', 'UI', 'API'];

export function TestCaseCreate({
  modules,
  defaultModule,
  defaultFeature,
  onCancel,
  onSave,
}: TestCaseCreateProps) {
  const moduleMap = useMemo(
    () => Object.fromEntries(modules.map(m => [m.name, m.features])) as Record<string, string[]>,
    [modules],
  );
  const initialModule = moduleMap[defaultModule] ? defaultModule : modules[0]?.name || '';
  const initialFeature = moduleMap[initialModule]?.includes(defaultFeature)
    ? defaultFeature
    : moduleMap[initialModule]?.[0] || '';

  const [module, setModule] = useState(initialModule);
  const [feature, setFeature] = useState(initialFeature);
  const [priority, setPriority] = useState<Priority>('High');
  const [severity, setSeverity] = useState<Severity>('Critical');
  const [type, setType] = useState<TestType>('Functional');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [stepsHtml, setStepsHtml] = useState('');
  const [expected, setExpected] = useState('');
  const [error, setError] = useState('');

  const handleModuleChange = (mod: string) => {
    setModule(mod);
    setFeature(moduleMap[mod]?.[0] || '');
  };

  const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '').trim();

  const handleSave = () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (!stripHtml(stepsHtml)) {
      setError('Steps are required');
      return;
    }
    onSave({
      module,
      feature,
      priority,
      severity,
      type,
      title: title.trim(),
      desc,
      steps: [stepsHtml],
      expected,
    });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-slate-50">
      {/* Topbar */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <button
          onClick={onCancel}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-100"
        >
          ← Back
        </button>
        <div className="flex-1 text-xs text-slate-400">
          {module} / {feature} / <span className="font-semibold text-slate-800">New test case</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave}>
            Save test case
          </Button>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-[860px] flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">New test case</h1>

          {/* Properties */}
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">
                Module <span className="text-red-500">*</span>
              </label>
              <select
                value={module}
                onChange={e => handleModuleChange(e.target.value)}
                className="w-[150px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500"
              >
                {modules.map(m => (
                  <option key={m.name}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">
                Feature <span className="text-red-500">*</span>
              </label>
              <select
                value={feature}
                onChange={e => setFeature(e.target.value)}
                className="w-[150px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500"
              >
                {(moduleMap[module] || []).map(f => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">
                Priority <span className="text-red-500">*</span>
              </label>
              <SegmentedControl
                value={priority}
                onChange={v => setPriority(v as Priority)}
                options={[
                  {
                    value: 'High',
                    label: 'High',
                    activeClass: 'bg-red-100 text-red-800 font-semibold',
                  },
                  {
                    value: 'Medium',
                    label: 'Med',
                    activeClass: 'bg-amber-100 text-amber-800 font-semibold',
                  },
                  {
                    value: 'Low',
                    label: 'Low',
                    activeClass: 'bg-green-100 text-green-800 font-semibold',
                  },
                ]}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">
                Severity <span className="text-red-500">*</span>
              </label>
              <SegmentedControl
                value={severity}
                onChange={v => setSeverity(v as Severity)}
                options={[
                  {
                    value: 'Critical',
                    label: 'Critical',
                    activeClass: 'bg-red-100 text-red-800 font-semibold',
                  },
                  {
                    value: 'Major',
                    label: 'Major',
                    activeClass: 'bg-amber-100 text-amber-800 font-semibold',
                  },
                  {
                    value: 'Minor',
                    label: 'Minor',
                    activeClass: 'bg-green-100 text-green-800 font-semibold',
                  },
                ]}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">
                Type <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-wrap gap-1">
                {TYPES.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`cursor-pointer rounded border px-2 py-1 text-xs transition-all ${type === t ? 'border-blue-500 bg-indigo-50 font-semibold text-blue-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Title */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-600">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => {
                setTitle(e.target.value);
                setError('');
              }}
              placeholder="Describe what this test verifies…"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-600">Description</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={2}
              placeholder="Optional background context…"
              className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* Steps — rich text */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-600">
              Steps <span className="text-red-500">*</span>
            </label>
            <RichTextEditor
              value={stepsHtml}
              onChange={setStepsHtml}
              placeholder="Use the toolbar to add bullets, numbering, bold, italic…"
              minHeight={200}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Tip: use <span className="font-semibold">1. List</span> for numbered steps or{' '}
              <span className="font-semibold">• List</span> for bullets.
            </p>
          </div>

          {/* Expected result */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-600">Expected result</label>
            <textarea
              value={expected}
              onChange={e => setExpected(e.target.value)}
              rows={2}
              placeholder="What should happen?"
              className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-2">
            <Button variant="default" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave}>
              Save test case
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
