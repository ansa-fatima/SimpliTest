import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Priority, Severity, TestType } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function priorityBadge(priority: Priority): string {
  return {
    High: 'bg-red-100 text-red-800',
    Medium: 'bg-amber-100 text-amber-800',
    Low: 'bg-green-100 text-green-800',
  }[priority];
}

export function severityBadge(severity: Severity): string {
  return {
    Critical: 'bg-red-100 text-red-800',
    Major: 'bg-amber-100 text-amber-800',
    Minor: 'bg-green-100 text-green-800',
  }[severity];
}

export function typeBadge(type: TestType): string {
  return {
    Functional: 'bg-indigo-100 text-indigo-800',
    Regression: 'bg-violet-100 text-violet-800',
    Smoke: 'bg-orange-100 text-orange-800',
    Sanity: 'bg-emerald-100 text-emerald-800',
    UI: 'bg-purple-100 text-purple-800',
    API: 'bg-sky-100 text-sky-800',
  }[type];
}

let _nextId = 70;
export function nextTestCaseId(): string {
  return `TC-00${String(_nextId++).padStart(3, '0')}`;
}

export function todayStr(): string {
  return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
