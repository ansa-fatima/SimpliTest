import { cn } from '@/lib/utils';
import { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
}

export function Button({ variant = 'default', size = 'md', className, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg font-medium cursor-pointer transition-all border whitespace-nowrap font-sans',
        size === 'sm' && 'px-2.5 py-1 text-xs',
        size === 'md' && 'px-3 py-1.5 text-xs',
        variant === 'default' && 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50',
        variant === 'primary' && 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700 font-semibold',
        variant === 'danger' && 'bg-white border-slate-200 text-red-600 hover:bg-red-50 hover:border-red-200',
        variant === 'ghost' && 'border-transparent bg-transparent text-slate-500 hover:bg-slate-100',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
