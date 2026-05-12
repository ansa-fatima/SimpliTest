'use client';

interface StepEditorProps {
  steps: string[];
  onChange: (steps: string[]) => void;
}

export function StepEditor({ steps, onChange }: StepEditorProps) {
  const addStep = () => onChange([...steps, '']);
  const removeStep = (i: number) => onChange(steps.filter((_, idx) => idx !== i));
  const updateStep = (i: number, val: string) => {
    const next = [...steps];
    next[i] = val;
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700">
            {i + 1}
          </span>
          <input
            type="text"
            value={step}
            onChange={e => updateStep(i, e.target.value)}
            placeholder={`Step ${i + 1}…`}
            className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-sans text-xs text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <button
            type="button"
            onClick={() => removeStep(i)}
            className="cursor-pointer rounded p-0.5 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addStep}
        className="mt-1 flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 font-sans text-xs text-slate-400 transition-all hover:border-blue-400 hover:bg-slate-50 hover:text-blue-500"
      >
        + Add step
      </button>
    </div>
  );
}
