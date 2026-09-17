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
      .then(setJira)
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
// lib/jira.ts and prisma/schema.prisma's JiraConnection model. Connecting
// validates the credentials against Jira before saving anything.
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
  const [siteUrl, setSiteUrl] = useState('');
  const [email, setEmail] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const connect = async () => {
    setFormError(null);
    if (!siteUrl.trim() || !email.trim() || !apiToken.trim()) {
      setFormError('Site URL, email, and API token are all required.');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/projects/${workspaceId}/integrations/jira`, {
        siteUrl: siteUrl.trim(),
        email: email.trim(),
        apiToken: apiToken.trim(),
      });
      setSiteUrl('');
      setEmail('');
      setApiToken('');
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

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-border text-text-3">
            <i className="ti ti-link text-[16px]" />
          </span>
          <div>
            <p className="text-[13px] font-medium text-text">Jira</p>
            <p className="text-[11.5px] text-text-3">
              Link a cycle&apos;s ticket and sync its status plus issue counts from Jira.
            </p>
          </div>
        </div>
        {loading ? (
          <p className="text-[12px] text-text-3">Loading…</p>
        ) : status.connected ? (
          <button
            type="button"
            disabled={!canEdit || busy}
            onClick={disconnect}
            className="flex-shrink-0 rounded-[7px] border border-danger/30 bg-danger-bg px-3 py-1.5 text-[12px] font-medium text-danger-text hover:bg-danger-bg/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <i className="ti ti-loader-2 animate-spin text-[13px]" /> : 'Disconnect'}
          </button>
        ) : (
          !editing && (
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => setEditing(true)}
              className="flex-shrink-0 rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-text hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Connect
            </button>
          )
        )}
      </div>

      {!loading && status.connected && (
        <div className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-[11.5px] text-text-2">
          <p>
            <span className="font-medium text-text">{status.siteUrl}</span> · {status.email}
          </p>
          {status.connectedAt && (
            <p className="mt-0.5 text-text-3">
              Connected {new Date(status.connectedAt).toLocaleDateString()}
              {status.connectedByName ? ` by ${status.connectedByName}` : ''}
            </p>
          )}
        </div>
      )}

      {!loading && !status.connected && editing && (
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
          {formError && <p className="text-[11.5px] text-danger-text">{formError}</p>}
          <input
            type="text"
            value={siteUrl}
            onChange={e => setSiteUrl(e.target.value)}
            placeholder="https://your-team.atlassian.net"
            className="input"
          />
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="input"
          />
          <input
            type="password"
            value={apiToken}
            onChange={e => setApiToken(e.target.value)}
            placeholder="API token"
            className="input"
          />
          <p className="text-[11px] text-text-3">
            Create a token at{' '}
            <span className="font-mono">id.atlassian.com/manage-profile/security/api-tokens</span>.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={connect}
              className="rounded-[7px] border border-border bg-primary px-3 py-1.5 text-[12px] font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
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
    </div>
  );
}
