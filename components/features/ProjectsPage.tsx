'use client';

import { useMemo, useState } from 'react';
import { Project } from '@/types';
import { SessionUser } from '@/hooks/useStore';
import { cn, initials, relativeTime } from '@/lib/utils';
import { avatarGradient } from '@/components/features/tc-helpers';
import { SIco } from '@/components/layout/sts-icons';
import { ProjectIcon } from './ProjectIcon';
import './sts-v3.css';

interface ProjectsPageProps {
  user: SessionUser | null;
  projects: Project[];
  currentProjectId: string | null;
  onOpen: (id: string) => void;
  onCreate: (name: string) => void | Promise<unknown>;
}

type Filter = 'all' | 'owned' | 'shared';
type View = 'grid' | 'list';

// Screen 02 — "Your projects": every workspace the signed-in user belongs to,
// as cards with their live case / run / portal / member counts.
export function ProjectsPage({
  user,
  projects,
  currentProjectId,
  onOpen,
  onCreate,
}: ProjectsPageProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<View>('grid');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const owned = projects.filter(p => user && p.createdById === user.id);
  const shared = projects.filter(p => !(user && p.createdById === user.id));

  const visible = useMemo(() => {
    const base = filter === 'owned' ? owned : filter === 'shared' ? shared : projects;
    const q = query.trim().toLowerCase();
    return q
      ? base.filter(p => p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q))
      : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, query, projects, user]);

  const lastActivity = projects.reduce<string | null>(
    (latest, p) => (!latest || p.updatedAt > latest ? p.updatedAt : latest),
    null,
  );

  const submitNew = async () => {
    const name = draft.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onCreate(name);
      setDraft('');
      setCreating(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stv3 main-scroll">
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <span className="crumb">Home</span>
            <span className="sep">/</span>
            <span className="current">Projects</span>
          </div>
          <h1 className="page-title">
            Your <em>projects</em>
          </h1>
          <div className="page-sub">
            {projects.length} {projects.length === 1 ? 'project' : 'projects'}
            {lastActivity ? ` · Last activity ${relativeTime(lastActivity)}` : ''}
          </div>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setSearching(s => !s);
              if (searching) setQuery('');
            }}
          >
            <SIco name="search" />
            Search
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(c => !c)}>
            <SIco name="plus" />
            New project
          </button>
        </div>
      </div>

      {creating && (
        <div className="new-proj-form">
          <input
            autoFocus
            className="input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submitNew();
              if (e.key === 'Escape') setCreating(false);
            }}
            placeholder="Project name…"
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={!draft.trim() || busy}
            onClick={submitNew}
          >
            Create project
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
      )}

      {searching && (
        <div style={{ marginBottom: 14, maxWidth: 360 }}>
          <input
            autoFocus
            className="input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search projects…"
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 20 }}>
        <div className="filter-pills">
          <button
            type="button"
            className={cn('fpill', filter === 'all' && 'active')}
            onClick={() => setFilter('all')}
          >
            All <span className="count">{projects.length}</span>
          </button>
          <button
            type="button"
            className={cn('fpill', filter === 'owned' && 'active')}
            onClick={() => setFilter('owned')}
          >
            Owned by me <span className="count">{owned.length}</span>
          </button>
          <button
            type="button"
            className={cn('fpill', filter === 'shared' && 'active')}
            onClick={() => setFilter('shared')}
          >
            Shared with me <span className="count">{shared.length}</span>
          </button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="icon-btn"
            title="Grid view"
            onClick={() => setView('grid')}
            style={
              view === 'grid'
                ? {
                    background: 'var(--brand-100)',
                    color: 'var(--brand-700)',
                    borderColor: 'var(--brand-bdr)',
                  }
                : undefined
            }
          >
            <SIco name="grid" />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="List view"
            onClick={() => setView('list')}
            style={
              view === 'list'
                ? {
                    background: 'var(--brand-100)',
                    color: 'var(--brand-700)',
                    borderColor: 'var(--brand-bdr)',
                  }
                : undefined
            }
          >
            <SIco name="list" />
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <div className="empty-note">
            {projects.length === 0
              ? 'No projects yet — create your first one.'
              : 'No projects match this filter.'}
          </div>
        </div>
      ) : (
        <div className={view === 'grid' ? 'proj-grid' : 'proj-list'}>
          {visible.map(p => (
            <ProjectCard
              key={p.id}
              project={p}
              current={p.id === currentProjectId}
              onOpen={() => onOpen(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({
  project: p,
  current,
  onOpen,
}: {
  project: Project;
  current: boolean;
  onOpen: () => void;
}) {
  const portals = p._count?.portals ?? 0;
  const runs = p._count?.cycles ?? 0;
  const memberCount = p.memberCount ?? p._count?.memberships ?? 0;
  const members = p.members ?? [];

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn('proj-card', current && 'current')}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="proj-card-head">
        <ProjectIcon project={p} />
        <div style={{ minWidth: 0 }}>
          <div className="proj-card-name">{p.name}</div>
          <div className="proj-card-key">{p.caseKey || p.slug}</div>
        </div>
      </div>
      <div className="proj-summary">
        {p.description ? `${p.description} · ` : ''}
        {portals} {portals === 1 ? 'portal' : 'portals'} · {memberCount}{' '}
        {memberCount === 1 ? 'member' : 'members'}
        {p.myRole ? ` · You are ${p.myRole}` : ''}
      </div>
      <div className="proj-shortcuts">
        <span className="proj-shortcut">
          <b>{(p.caseCount ?? 0).toLocaleString()}</b> cases
        </span>
        <span className="proj-shortcut">
          <b>{runs}</b> runs
        </span>
        <span className="proj-shortcut">
          <b>{portals}</b> portals
        </span>
        <span className="proj-shortcut">
          <b>{memberCount}</b> members
        </span>
      </div>
      <div className="proj-card-foot">
        <div className="avatar-stack">
          {members.slice(0, 3).map((m, i) => (
            <div
              key={i}
              className="avatar sm"
              style={{ background: avatarGradient(m.name) }}
              title={m.name}
            >
              {initials(m.name)}
            </div>
          ))}
          {memberCount > 3 && (
            <div className="avatar sm" style={{ background: 'var(--bg-2)', color: 'var(--t-3)' }}>
              +{memberCount - 3}
            </div>
          )}
        </div>
        <span>Updated {relativeTime(p.updatedAt)}</span>
      </div>
    </div>
  );
}
