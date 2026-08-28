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

// LOCAL calendar date as "YYYY-MM-DD" — for <input type="date"> value/max.
// NOT the same as `new Date().toISOString().slice(0, 10)`, which reads the
// UTC date and drifts to the wrong day for part of the day at UTC+ offsets
// (e.g. a Pakistan user at 2am local is still on "yesterday" in UTC).
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Canonical "time ago" formatter. Same calendar day → minute/hour precision
// (meaningful only when the source timestamp carries a real time-of-day).
// Different calendar day → day-level granularity instead of raw hour math,
// since many timestamps here (back-dated quick logs) are date-only and
// anchored to local midnight — hour math off midnight reads as misleading
// ("8h ago" for something logged as "today").
export function relativeTime(iso: string): string {
  const now = new Date();
  const ts = new Date(iso);

  if (now.toDateString() === ts.toDateString()) {
    const min = Math.floor((now.getTime() - ts.getTime()) / 60_000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    return `${Math.floor(min / 60)}h ago`;
  }

  const dayDiff = Math.round(
    (startOfLocalDay(now).getTime() - startOfLocalDay(ts).getTime()) / 86_400_000,
  );
  if (dayDiff <= 1) return 'yesterday';
  if (dayDiff < 30) return `${dayDiff}d ago`;
  const months = Math.floor(dayDiff / 30);
  if (months < 12) return `${months}mo ago`;
  return ts.toLocaleDateString();
}
