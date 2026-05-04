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
    <div className="flex border border-slate-200 rounded-lg overflow-hidden">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-2.5 py-1 text-xs font-medium border-r border-slate-200 last:border-r-0 cursor-pointer transition-all',
            value === opt.value
              ? (opt.activeClass || 'bg-blue-50 text-blue-700 font-semibold')
              : 'bg-white text-slate-500 hover:bg-slate-50'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
