'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';

interface LocalIntegrations {
  slack: boolean;
  github: boolean;
}

interface JiraStatus {
  connected: boolean;
  siteUrl?: string;
  email?: string;
  connectedAt?: string;
  connectedByName?: string | null;
  projectKey?: string | null;
  jqlPrefilter?: string | null;
  apiTokenRotatedAt?: string | null;
  autoSyncIntervalMinutes?: number;
  autoSyncEnabled?: boolean;
  lastSyncAt?: string | null;
  lastSyncCount?: number | null;
}

// Supported auto-sync intervals, mirrored by the API's allow-list so the
// dropdown can never offer a value the backend rejects.
const AUTO_SYNC_INTERVALS: { minutes: number; label: string }[] = [
  { minutes: 5, label: 'Every 5 minutes' },
  { minutes: 15, label: 'Every 15 minutes' },
  { minutes: 30, label: 'Every 30 minutes' },
  { minutes: 60, label: 'Every hour' },
  { minutes: 120, label: 'Every 2 hours' },
  { minutes: 360, label: 'Every 6 hours' },
  { minutes: 1440, label: 'Daily' },
];

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const LOCAL_INTEGRATIONS: {
  key: keyof LocalIntegrations;
  name: string;
  desc: string;
  icon: string;
}[] = [
  {
    key: 'slack',
    name: 'Slack',
    desc: 'Post cycle completions and critical defects to a channel.',
    icon: 'ti-bell',
  },
  {
    key: 'github',
    name: 'GitHub',
    desc: 'Attach commits and pull requests to defects.',
    icon: 'ti-brand-github',
  },
];

export function IntegrationsTab({
  workspaceId,
  canEdit,
}: {
  workspaceId: string;
  canEdit: boolean;
}) {
  const [state, setState] = useState<LocalIntegrations>({ slack: false, github: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [jira, setJira] = useState<JiraStatus>({ connected: false });
  const [jiraLoading, setJiraLoading] = useState(true);

  const loadJira = () => {
    setJiraLoading(true);
    return api
      .get<JiraStatus>(`/api/projects/${workspaceId}/integrations/jira`)
      .then(s => {
        setJira(s);
        setError(null);
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setJiraLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ integrations: LocalIntegrations | null }>(`/api/projects/${workspaceId}`)
      .then(p => !cancelled && setState({ slack: false, github: false, ...p.integrations }))
      .catch(e => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    loadJira();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const toggle = async (key: keyof LocalIntegrations) => {
    setError(null);
    setBusy(key);
    const next = { ...state, [key]: !state[key] };
    try {
      await api.patch(`/api/projects/${workspaceId}`, { integrations: next });
      setState(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-[12px] text-danger-text">
          {error}
        </p>
      )}

      <JiraCard
        workspaceId={workspaceId}
        canEdit={canEdit}
        status={jira}
        loading={jiraLoading}
        onChange={loadJira}
      />

      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="mb-3 text-[11px] text-text-3">
          No live sync is wired up yet — this just remembers which integrations you&apos;ve marked
          as connected.
        </p>
        {loading ? (
          <p className="text-[12px] text-text-3">Loading…</p>
        ) : (
          <ul className="divide-y divide-border">
            {LOCAL_INTEGRATIONS.map(i => (
              <li key={i.key} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-border text-text-3">
                    <i className={cn('ti', i.icon, 'text-[16px]')} />
                  </span>
                  <div>
                    <p className="text-[13px] font-medium text-text">{i.name}</p>
                    <p className="text-[11.5px] text-text-3">{i.desc}</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!canEdit || busy === i.key}
                  onClick={() => toggle(i.key)}
                  className={cn(
                    'flex-shrink-0 rounded-[7px] px-3 py-1.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-50',
                    state[i.key]
                      ? 'border border-danger/30 bg-danger-bg text-danger-text hover:bg-danger-bg/80'
                      : 'border border-border bg-surface text-text hover:bg-surface-2',
                  )}
                >
                  {busy === i.key ? (
                    <i className="ti ti-loader-2 animate-spin text-[13px]" />
                  ) : state[i.key] ? (
                    'Disconnect'
                  ) : (
                    'Connect'
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Jira is a real connection (HTTP Basic auth, email + API token) -- see
// lib/jira.ts and prisma/schema.prisma's JiraConnection model.
//
// When disconnected: a minimal three-field form (site URL, email, token)
// is shown; Connect validates against Jira before saving.
//
// When connected: a full detail card with the mockup's rows -- instance
// URL, project key, service account, API token (with Rotate), auto-sync
// interval + toggle, and JQL prefilter. "Save changes" PATCHes only the
// fields that actually changed; the token has its own rotate flow so a
// stray Save cannot blank it.
function JiraCard({
  workspaceId,
  canEdit,
  status,
  loading,
  onChange,
}: {
  workspaceId: string;
  canEdit: boolean;
  status: JiraStatus;
  loading: boolean;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [newSiteUrl, setNewSiteUrl] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newApiToken, setNewApiToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [siteUrl, setSiteUrl] = useState('');
  const [email, setEmail] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [jqlPrefilter, setJqlPrefilter] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [autoSyncOn, setAutoSyncOn] = useState(true);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [rotating, setRotating] = useState(false);
  const [rotateToken, setRotateToken] = useState('');

  useEffect(() => {
    if (status.connected) {
      setSiteUrl(status.siteUrl ?? '');
      setEmail(status.email ?? '');
      setProjectKey(status.projectKey ?? '');
      setJqlPrefilter(status.jqlPrefilter ?? '');
      setIntervalMinutes(status.autoSyncIntervalMinutes ?? 15);
      setAutoSyncOn(status.autoSyncEnabled ?? true);
    }
  }, [
    status.connected,
    status.siteUrl,
    status.email,
    status.projectKey,
    status.jqlPrefilter,
    status.autoSyncIntervalMinutes,
    status.autoSyncEnabled,
  ]);

  const connect = async () => {
    setFormError(null);
    if (!newSiteUrl.trim() || !newEmail.trim() || !newApiToken.trim()) {
      setFormError('Jira instance URL, service account, and API token are all required.');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/projects/${workspaceId}/integrations/jira`, {
        siteUrl: newSiteUrl.trim(),
        email: newEmail.trim(),
        apiToken: newApiToken.trim(),
        autoSyncIntervalMinutes: intervalMinutes,
        autoSyncEnabled: autoSyncOn,
      });
      setNewSiteUrl('');
      setNewEmail('');
      setNewApiToken('');
      setEditing(false);
      onChange();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect Jira? Cycles already synced keep their last-synced values.'))
      return;
    setBusy(true);
    try {
      await api.del(`/api/projects/${workspaceId}/integrations/jira`);
      onChange();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const dirty =
    status.connected &&
    (siteUrl.trim() !== (status.siteUrl ?? '') ||
      email.trim() !== (status.email ?? '') ||
      (projectKey.trim().toUpperCase() || null) !== (status.projectKey ?? null) ||
      (jqlPrefilter.trim() || null) !== (status.jqlPrefilter ?? null) ||
      intervalMinutes !== (status.autoSyncIntervalMinutes ?? 15) ||
      autoSyncOn !== (status.autoSyncEnabled ?? true));

  const saveChanges = async () => {
    setFormError(null);
    setSaveMsg(null);
    setBusy(true);
    try {
      await api.patch(`/api/projects/${workspaceId}/integrations/jira`, {
        siteUrl: siteUrl.trim(),
        email: email.trim(),
        projectKey: projectKey.trim().toUpperCase() || null,
        jqlPrefilter: jqlPrefilter.trim() || null,
        autoSyncIntervalMinutes: intervalMinutes,
        autoSyncEnabled: autoSyncOn,
      });
      setSaveMsg('Saved');
      onChange();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rotateApiToken = async () => {
    if (!rotateToken.trim()) {
      setFormError('Enter the new API token first.');
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      await api.post(`/api/projects/${workspaceId}/integrations/jira/rotate-token`, {
        apiToken: rotateToken.trim(),
      });
      setRotateToken('');
      setRotating(false);
      onChange();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h3 className="text-[14px] font-semibold text-text">Jira Integration</h3>
          <p className="mt-0.5 text-[11.5px] text-text-3">
            Where issues, tickets, and sub-tasks come from.
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {loading ? (
            <p className="text-[12px] text-text-3">Loading…</p>
          ) : status.connected ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-1 text-[11.5px] font-medium text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                Connected
              </span>
              <button
                type="button"
                disabled={!canEdit || busy || !dirty}
                onClick={saveChanges}
                className="rounded-[7px] bg-primary px-3 py-1.5 text-[12px] font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <i className="ti ti-loader-2 animate-spin text-[13px]" /> : 'Save changes'}
              </button>
            </>
          ) : (
            !editing && (
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setEditing(true)}
                className="rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-text hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Connect
              </button>
            )
          )}
        </div>
      </div>

      {(formError || saveMsg) && (
        <p
          className={cn(
            'border-b border-border px-5 py-2 text-[11.5px]',
            formError ? 'bg-danger-bg/40 text-danger-text' : 'bg-success/10 text-success',
          )}
        >
          {formError ?? saveMsg}
        </p>
      )}

      {!loading && !status.connected && editing && (
        <div className="flex flex-col gap-3 px-5 py-4">
          <JiraField
            label="Jira instance URL"
            help="The Atlassian Cloud URL for your workspace."
            value={newSiteUrl}
            onChange={v => {
              setNewSiteUrl(v);
              setFormError(null);
            }}
            placeholder="https://your-team.atlassian.net"
          />
          <JiraField
            label="Service account"
            help="A dedicated user for API access — never a personal token."
            value={newEmail}
            onChange={v => {
              setNewEmail(v);
              setFormError(null);
            }}
            placeholder="qa-bot@your-company.com"
            type="email"
          />
          <div className="flex flex-col gap-1">
            <label className="text-[12.5px] font-semibold text-text">API token</label>
            <input
              type="password"
              value={newApiToken}
              onChange={e => {
                setNewApiToken(e.target.value);
                setFormError(null);
              }}
              placeholder="Paste the token"
              className="w-full rounded-[7px] border border-border bg-surface px-3 py-2 text-[12.5px] text-text outline-none focus:border-primary"
            />
            <p className="text-[11px] text-text-3">
              Create one at{' '}
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary hover:underline"
              >
                id.atlassian.com/manage-profile/security/api-tokens
              </a>
              .
            </p>
          </div>

          {/* Auto-sync defaults picked here on setup, so a new connection
              starts with the right cadence instead of inheriting the API
              default and then needing a second trip to Settings. */}
          <div className="flex flex-col gap-1">
            <label className="text-[12.5px] font-semibold text-text">Auto-sync interval</label>
            <select
              value={intervalMinutes}
              onChange={e => setIntervalMinutes(Number(e.target.value))}
              className="w-full rounded-[7px] border border-border bg-surface px-3 py-2 text-[12.5px] text-text outline-none focus:border-primary"
            >
              {AUTO_SYNC_INTERVALS.map(o => (
                <option key={o.minutes} value={o.minutes}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-text-3">
              How often the console pulls updates from Jira.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
            <div>
              <p className="text-[12.5px] font-semibold text-text">Auto-sync</p>
              <p className="mt-0.5 text-[11px] text-text-3">
                When off, sync only fires on the &quot;Sync from Jira&quot; button.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoSyncOn}
              onClick={() => setAutoSyncOn(!autoSyncOn)}
              className={cn(
                'relative h-6 w-11 flex-shrink-0 rounded-full transition-colors',
                autoSyncOn ? 'bg-primary' : 'bg-surface-3',
              )}
            >
              <span
                className={cn(
                  'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                  autoSyncOn ? 'translate-x-5' : 'translate-x-0',
                )}
              />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={connect}
              className="rounded-[7px] bg-primary px-3 py-1.5 text-[12px] font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <i className="ti ti-loader-2 animate-spin text-[13px]" /> : 'Test & Connect'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setFormError(null);
              }}
              className="rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-text hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!loading && status.connected && (
        <div className="divide-y divide-border">
          <JiraRow label="Jira instance URL" help="The Atlassian Cloud URL for your workspace.">
            <input
              type="url"
              value={siteUrl}
              disabled={!canEdit}
              onChange={e => setSiteUrl(e.target.value)}
              placeholder="https://your-team.atlassian.net"
              className="w-full rounded-[7px] border border-border bg-surface px-3 py-2 text-[12.5px] text-text outline-none focus:border-primary disabled:opacity-60"
            />
          </JiraRow>

          <JiraRow label="Project key" help="JQL filters use `project = KEY` against every sync.">
            <div className="flex flex-col gap-1">
              <input
                type="text"
                value={projectKey}
                disabled={!canEdit}
                onChange={e => setProjectKey(e.target.value.toUpperCase())}
                placeholder="NPD"
                className="w-full rounded-[7px] border border-border bg-surface px-3 py-2 text-[12.5px] uppercase text-text outline-none focus:border-primary disabled:opacity-60"
              />
              {status.projectKey && (
                <p className="text-[11px] text-text-3">
                  Currently syncing project{' '}
                  <span className="font-semibold text-text-2">{status.projectKey}</span>.
                </p>
              )}
            </div>
          </JiraRow>

          <JiraRow
            label="Service account"
            help="A dedicated user for API access — never a personal token."
          >
            <input
              type="email"
              value={email}
              disabled={!canEdit}
              onChange={e => setEmail(e.target.value)}
              placeholder="qa-bot@your-company.com"
              className="w-full rounded-[7px] border border-border bg-surface px-3 py-2 text-[12.5px] text-text outline-none focus:border-primary disabled:opacity-60"
            />
          </JiraRow>

          <JiraRow label="API token" help="Rotate every 90 days. Stored encrypted at rest.">
            <div className="flex flex-col gap-1">
              {rotating ? (
                <>
                  <input
                    type="password"
                    value={rotateToken}
                    autoFocus
                    onChange={e => setRotateToken(e.target.value)}
                    placeholder="Paste the new API token"
                    className="w-full rounded-[7px] border border-border bg-surface px-3 py-2 text-[12.5px] text-text outline-none focus:border-primary"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy || !rotateToken.trim()}
                      onClick={rotateApiToken}
                      className="rounded-[7px] bg-primary px-3 py-1 text-[11.5px] font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? (
                        <i className="ti ti-loader-2 animate-spin text-[12px]" />
                      ) : (
                        'Save token'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRotating(false);
                        setRotateToken('');
                      }}
                      className="rounded-[7px] border border-border bg-surface px-3 py-1 text-[11.5px] text-text hover:bg-surface-2"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <input
                    type="password"
                    value="•••••••••••••••••••••••"
                    disabled
                    className="w-full rounded-[7px] border border-border bg-surface px-3 py-2 text-[12.5px] text-text outline-none disabled:opacity-70"
                  />
                  <p className="text-[11px] text-text-3">
                    Last rotated{' '}
                    <span className="text-text-2">
                      {status.apiTokenRotatedAt
                        ? timeAgo(status.apiTokenRotatedAt)
                        : status.connectedAt
                          ? timeAgo(status.connectedAt)
                          : 'never'}
                    </span>{' '}
                    ·{' '}
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setRotating(true)}
                      className="text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Rotate now
                    </button>
                  </p>
                </>
              )}
            </div>
          </JiraRow>

          <JiraRow label="Auto-sync interval" help="How often the console pulls updates from Jira.">
            <select
              value={intervalMinutes}
              disabled={!canEdit || !autoSyncOn}
              onChange={e => setIntervalMinutes(Number(e.target.value))}
              className="w-full rounded-[7px] border border-border bg-surface px-3 py-2 text-[12.5px] text-text outline-none focus:border-primary disabled:opacity-60"
            >
              {AUTO_SYNC_INTERVALS.map(o => (
                <option key={o.minutes} value={o.minutes}>
                  {o.label}
                </option>
              ))}
            </select>
          </JiraRow>

          <JiraRow
            label="Auto-sync"
            help='When off, sync only fires on the "Sync from Jira" button.'
          >
            <div className="flex flex-col items-start gap-1">
              <label className="flex items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoSyncOn}
                  disabled={!canEdit}
                  onClick={() => setAutoSyncOn(!autoSyncOn)}
                  className={cn(
                    'relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    autoSyncOn ? 'bg-primary' : 'bg-surface-3',
                  )}
                >
                  <span
                    className={cn(
                      'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                      autoSyncOn ? 'translate-x-5' : 'translate-x-0',
                    )}
                  />
                </button>
                <span className="text-[12px] text-text-2">Automatic background sync</span>
              </label>
              <p className="text-[11px] text-text-3">
                Last sync:{' '}
                <span className="font-semibold text-text-2">{timeAgo(status.lastSyncAt)}</span>
                {typeof status.lastSyncCount === 'number' && (
                  <>
                    {' '}
                    · {status.lastSyncCount} ticket
                    {status.lastSyncCount === 1 ? '' : 's'} updated
                  </>
                )}
              </p>
            </div>
          </JiraRow>

          <JiraRow
            label="JQL prefilter"
            help="Optional. Narrows what gets pulled (e.g. skip a status)."
          >
            <input
              type="text"
              value={jqlPrefilter}
              disabled={!canEdit}
              onChange={e => setJqlPrefilter(e.target.value)}
              placeholder="status != Closed"
              className="w-full rounded-[7px] border border-border bg-surface px-3 py-2 font-mono text-[12px] text-text outline-none focus:border-primary disabled:opacity-60"
            />
          </JiraRow>

          <div className="flex items-center justify-end px-5 py-3">
            <button
              type="button"
              disabled={!canEdit || busy}
              onClick={disconnect}
              className="rounded-[7px] border border-danger/30 bg-danger-bg px-3 py-1.5 text-[12px] font-medium text-danger-text hover:bg-danger-bg/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function JiraRow({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-[260px_1fr] md:items-start">
      <div>
        <p className="text-[12.5px] font-semibold text-text">{label}</p>
        <p className="mt-0.5 text-[11.5px] text-primary">{help}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

function JiraField({
  label,
  help,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: 'text' | 'email' | 'password' | 'url';
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[12.5px] font-semibold text-text">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[7px] border border-border bg-surface px-3 py-2 text-[12.5px] text-text outline-none focus:border-primary"
      />
      <p className="text-[11px] text-text-3">{help}</p>
    </div>
  );
}
