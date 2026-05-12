'use client';

import { useState, useMemo } from 'react';
import { TestCase, Priority, Severity, TestType, Module } from '@/types';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { StepEditor } from '@/components/ui/StepEditor';
import { Button } from '@/components/ui/Button';

interface TestCaseEditProps {
  tc: TestCase;
  modules: Module[];
  currentKey: string;
  onBack: () => void;
  onSave: (patch: Partial<TestCase>) => void;
}

const TYPES: TestType[] = ['Functional', 'Regression', 'Smoke', 'Sanity', 'UI', 'API'];

export function TestCaseEdit({ tc, modules, currentKey, onBack, onSave }: TestCaseEditProps) {
  const moduleMap = useMemo(
    () => Object.fromEntries(modules.map(m => [m.name, m.features])) as Record<string, string[]>,
    [modules],
  );
  const [mod, feat] = currentKey.split(':');

  const [title, setTitle] = useState(tc.title);
  const [desc, setDesc] = useState(tc.desc);
  const [expected, setExpected] = useState(tc.expected);
  const [steps, setSteps] = useState<string[]>(tc.steps);
  const [priority, setPriority] = useState<Priority>(tc.priority);
  const [severity, setSeverity] = useState<Severity>(tc.severity);
  const [type, setType] = useState<TestType>(tc.type);
  const [feature, setFeature] = useState(tc.feature);
  const [module, setModule] = useState(mod);

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      sub: desc.split('.')[0] || title.trim(),
      desc,
      expected,
      steps: steps.filter(Boolean),
      priority,
      severity,
      type,
      feature,
    });
  };

  const handleModuleChange = (m: string) => {
    setModule(m);
    setFeature(moduleMap[m]?.[0] || '');
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Topbar */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <button
          onClick={onBack}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-100"
        >
          ← Back
        </button>
        <div className="flex flex-1 items-center gap-1 text-xs text-slate-400">
          {mod} / {feat} / <span className="font-mono font-semibold text-slate-800">{tc.id}</span>
          <span
            className="ml-1 inline-block h-2 w-2 rounded-full bg-amber-400"
            title="Unsaved changes"
          />
        </div>
        <Button variant="default" onClick={onBack}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M2 8l5 5 7-9" />
          </svg>
          Save
        </Button>
      </div>

      {/* Form */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
        {/* Properties section */}
        <div>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Properties
          </p>
          <div className="flex flex-wrap items-end gap-3">
            {/* Case ID (readonly) */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">Case ID</label>
              <input
                type="text"
                value={tc.id}
                readOnly
                className="w-[90px] cursor-default rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-400 outline-none"
              />
            </div>

            {/* Module */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">
                Module <span className="text-red-500">*</span>
              </label>
              <select
                value={module}
                onChange={e => handleModuleChange(e.target.value)}
                className="w-[130px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-sans text-xs text-slate-900 outline-none focus:border-blue-500"
              >
                {modules.map(m => (
                  <option key={m.name}>{m.name}</option>
                ))}
              </select>
            </div>

            {/* Feature */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">
                Feature <span className="text-red-500">*</span>
              </label>
              <select
                value={feature}
                onChange={e => setFeature(e.target.value)}
                className="w-[130px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-sans text-xs text-slate-900 outline-none focus:border-blue-500"
              >
                {(moduleMap[module] || []).map(f => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </div>

            {/* Priority */}
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

            {/* Severity */}
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

            {/* Type */}
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
            onChange={e => setTitle(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-sans text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-600">Description</label>
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            rows={2}
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-sans text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        {/* Steps */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-600">
            Steps <span className="text-red-500">*</span>
          </label>
          <StepEditor steps={steps} onChange={setSteps} />
        </div>

        {/* Expected */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-600">Expected result</label>
          <textarea
            value={expected}
            onChange={e => setExpected(e.target.value)}
            rows={2}
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-sans text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <hr className="border-slate-100" />

        {/* Meta */}
        <div className="flex items-center gap-5">
          <span className="text-xs text-slate-400">📅 Created {tc.created}</span>
          <span className="text-xs text-slate-400">👤 {tc.author}</span>
          <span className="text-xs text-slate-400">✏️ Updated {tc.updatedFull}</span>
        </div>
      </div>
    </div>
  );
}
