'use client';

interface StepEditorProps {
  steps: string[];
  onChange: (steps: string[]) => void;
}

// Each step is a multi-line textarea (not a single-line input) so a step
// that itself needs a short bulleted/numbered list -- e.g. "Verify the
// following:\n- field A\n- field B" -- can actually hold that structure
// instead of having newlines silently collapsed. TestCaseView renders the
// result through RichText, which already turns "- x" / "1. x" lines into
// real lists -- same formatter Description/Expected result use.
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
        <div key={i} className="flex items-start gap-2">
          <span className="mt-1.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary-light text-[10px] font-bold text-primary-text">
            {i + 1}
          </span>
          <textarea
            value={step}
            onChange={e => updateStep(i, e.target.value)}
            placeholder={`Step ${i + 1}… (one line per bullet if it needs a short list)`}
            rows={Math.min(8, Math.max(1, step.split('\n').length))}
            className="flex-1 resize-y rounded-lg border border-border bg-surface px-2.5 py-1.5 font-sans text-xs leading-relaxed text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
          />
          <button
            type="button"
            onClick={() => removeStep(i)}
            className="mt-1 flex-shrink-0 cursor-pointer rounded p-0.5 text-text-3 transition-colors hover:bg-danger-bg hover:text-danger"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addStep}
        className="mt-1 flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-border-strong px-2.5 py-1.5 font-sans text-xs text-text-3 transition-all hover:border-primary hover:bg-primary-light hover:text-primary-text"
      >
        + Add step
      </button>
    </div>
  );
}
