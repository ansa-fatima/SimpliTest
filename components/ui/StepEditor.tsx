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
          <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
            {i + 1}
          </span>
          <input
            type="text"
            value={step}
            onChange={e => updateStep(i, e.target.value)}
            placeholder={`Step ${i + 1}…`}
            className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-sans bg-white text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <button
            type="button"
            onClick={() => removeStep(i)}
            className="text-slate-300 hover:text-red-500 hover:bg-red-50 rounded p-0.5 cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addStep}
        className="flex items-center gap-1.5 px-2.5 py-1.5 border border-dashed border-slate-300 rounded-lg text-xs text-slate-400 hover:bg-slate-50 hover:border-blue-400 hover:text-blue-500 cursor-pointer transition-all mt-1 font-sans"
      >
        + Add step
      </button>
    </div>
  );
}
