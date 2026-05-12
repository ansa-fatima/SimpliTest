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

export function SegmentedControl({ options, value, onChange }: SegmentedControlProps) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-slate-200">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'cursor-pointer border-r border-slate-200 px-2.5 py-1 text-xs font-medium transition-all last:border-r-0',
            value === opt.value
              ? opt.activeClass || 'bg-blue-50 font-semibold text-blue-700'
              : 'bg-white text-slate-500 hover:bg-slate-50',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
