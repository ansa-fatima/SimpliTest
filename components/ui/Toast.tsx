'use client';

import { cn } from '@/lib/utils';

interface ToastProps {
  msg: string;
  type?: 'success' | 'error';
}

export function Toast({ msg, type }: ToastProps) {
  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg',
        'animate-in slide-in-from-bottom-4 fade-in duration-300',
        type === 'success' && 'bg-green-800',
        type === 'error' && 'bg-red-800',
        !type && 'bg-slate-900',
      )}
    >
      {msg}
    </div>
  );
}
