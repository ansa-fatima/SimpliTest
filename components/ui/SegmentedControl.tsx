'use client';

import { cn } from '@/lib/utils';

interface Option {
  value: string;
  label: string;
  activeClass?: string;
}

interface SegmentedControlProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}

// Shared by NewTestCaseModal and TestCaseEdit — one control, one place to
// fix if its styling ever needs to change.
export function SegmentedControl({ options, value, onChange }: SegmentedControlProps) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-border">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex-1 px-2.5 py-1.5 text-xs transition-colors',
            value === opt.value
              ? `font-semibold ${opt.activeClass || 'bg-primary-light text-primary-text'}`
              : 'bg-surface text-text-3 hover:bg-surface-2',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
