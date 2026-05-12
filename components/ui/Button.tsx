import { cn } from '@/lib/utils';
import { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
}

export function Button({
  variant = 'default',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border font-sans font-medium transition-all',
        size === 'sm' && 'px-2.5 py-1 text-xs',
        size === 'md' && 'px-3 py-1.5 text-xs',
        variant === 'default' && 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
        variant === 'primary' &&
          'border-blue-600 bg-blue-600 font-semibold text-white hover:bg-blue-700',
        variant === 'danger' &&
          'border-slate-200 bg-white text-red-600 hover:border-red-200 hover:bg-red-50',
        variant === 'ghost' &&
          'border-transparent bg-transparent text-slate-500 hover:bg-slate-100',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
