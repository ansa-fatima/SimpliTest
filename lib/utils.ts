import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { CaseStatus, Priority, Severity, TestType } from '@/types';

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

export function statusBadge(status: CaseStatus): string {
  return {
    Active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    Draft: 'bg-slate-100 text-slate-600 ring-slate-200',
    Archived: 'bg-amber-50 text-amber-700 ring-amber-200',
  }[status];
}

// Deterministic pastel avatar colour for users without an uploaded picture.
const AVATAR_COLOURS = [
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-700',
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-indigo-100 text-indigo-700',
  'bg-violet-100 text-violet-700',
  'bg-fuchsia-100 text-fuchsia-700',
  'bg-teal-100 text-teal-700',
];

export function avatarColour(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLOURS[Math.abs(hash) % AVATAR_COLOURS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

let _nextId = 70;
export function nextTestCaseId(): string {
  return `TC-00${String(_nextId++).padStart(3, '0')}`;
}

// Canonical display ID for test cases — always derived from the DB's auto-incrementing caseNum.
export function formatCaseId(caseNum: number | null | undefined): string {
  if (!caseNum && caseNum !== 0) return '';
  return `TC-${String(caseNum).padStart(2, '0')}`;
}

export function todayStr(): string {
  return new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
