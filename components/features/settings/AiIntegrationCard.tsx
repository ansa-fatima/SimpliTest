'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';

// Settings > Integrations > "AI Test Generation".
// Connects the workspace to Claude, Gemini, OpenAI or a local Ollama (API key or server address + models) and holds the options for
// the duplicate check used by "Generate with AI". Same pattern as the Jira card:
// the key is write-only (only a masked hint comes back) and is checked against
// the AI service before it is saved.

type DuplicateCheck = 'off' | 'titles' | 'titlesSteps';

interface ModelOption {
  id: string;
  label: string;
  hint: string;
}

type ProviderId =
  | 'anthropic'
  | 'gemini'
  | 'openai'
  | 'openrouter'
  | 'groq'
  | 'xai'
  | 'mistral'
  | 'deepseek'
  | 'ollama'
  | 'custom';

interface ProviderInfo {
  id: ProviderId;
  label: string;
  note: string;
  models: ModelOption[];
  defaultModel: string;
  defaultTiebreakModel: string;
  needsKey: boolean;
  keyOptional?: boolean;
  keyPlaceholder: string;
  keyUrl: string;
  keyUrlLabel: string;
  baseUrl: 'none' | 'optional' | 'required';
  defaultBaseUrl: string;
  modelPlaceholder: string;
}

interface AiStatus {
  connected: boolean;
  source: 'workspace' | 'server' | null;
  /** Which provider answers right now (null when nothing is connected). */
  provider: ProviderId | null;
  keyHint: string | null;
  /** The server address in use (the provider's usual one unless changed). */
  baseUrl: string | null;
  model: string | null;
  tiebreakModel: string | null;
  providers: ProviderInfo[];
  encrypted: boolean;
  settings: { duplicateCheck: DuplicateCheck; aiTiebreak: boolean };
}

const DUPLICATE_OPTIONS: { v: DuplicateCheck; label: string; hint: string }[] = [
  { v: 'off', label: 'Off', hint: 'Never compare — every generated case is treated as new.' },
  {
    v: 'titles',
    label: 'Titles only',
    hint: 'Flag a case only when its title is almost the same as an existing one.',
  },
  {
    v: 'titlesSteps',
    label: 'Titles and steps',
    hint: 'Also flag cases whose steps read the same, even if the title is worded differently.',
  },
];

const inputCls =
  'w-full rounded-[7px] border border-border bg-surface px-3 py-2 text-[12.5px] text-text outline-none focus:border-primary disabled:opacity-60';

export function AiIntegrationCard({
  workspaceId,
  canEdit,
}: {
  workspaceId: string;
  canEdit: boolean;
}) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [editing, setEditing] = useState(false); // connect form (or "use my own key")
  const [replacing, setReplacing] = useState(false); // replace the stored key
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState<ProviderId>('anthropic');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.get<AiStatus>(`/api/projects/${workspaceId}/integrations/ai`);
      setStatus(s);
      const p = s.provider ?? 'anthropic';
      setProvider(p);
      // Only a non-standard address is worth pre-filling; empty means "the usual one".
      const usual = s.providers.find(x => x.id === p)?.defaultBaseUrl;
      setBaseUrl(s.baseUrl && s.baseUrl !== usual ? s.baseUrl : '');
      setModel(s.model ?? '');
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (msg: string) => {
    setNote(msg);
    window.setTimeout(() => setNote(null), 3500);
  };

  // Connect / replace key / change models all go through one endpoint.
  const save = async (
    body: {
      provider?: ProviderId;
      apiKey?: string;
      baseUrl?: string | null;
      model?: string | null;
      tiebreakModel?: string | null;
    },
    tag: string,
  ) => {
    setBusy(tag);
    setError(null);
    try {
      await api.post(`/api/projects/${workspaceId}/integrations/ai`, body);
      setApiKey('');
      setEditing(false);
      setReplacing(false);
      await load();
      flash(
        body.apiKey || body.baseUrl !== undefined ? 'Connected — checked and saved.' : 'Saved.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (
      !window.confirm(
        'Disconnect AI? "Generate with AI" will stop working for this workspace until a key is added again.',
      )
    )
      return;
    setBusy('disconnect');
    setError(null);
    try {
      await api.del(`/api/projects/${workspaceId}/integrations/ai`);
      await load();
      flash('Disconnected.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = async (patch: Partial<AiStatus['settings']>) => {
    if (!status) return;
    const prev = status;
    setStatus({ ...status, settings: { ...status.settings, ...patch } });
    try {
      await api.patch(`/api/projects/${workspaceId}/ai-settings`, patch);
    } catch (e) {
      setStatus(prev);
      setError((e as Error).message);
    }
  };

  // The provider that is answering now (or Claude before anything is connected).
  const active =
    status?.providers.find(p => p.id === (status.provider ?? 'anthropic')) ?? status?.providers[0];
  const modelLabel = (id: string | null, fallback: string) =>
    active?.models.find(m => m.id === (id ?? fallback))?.label ?? id ?? fallback;
  const changeProvider = (p: ProviderId) => {
    setProvider(p);
    setModel(''); // model names belong to one provider
    setBaseUrl('');
    setError(null);
  };
  // What a connect / replace submit sends for the provider being set up.
  const formInfo = status?.providers.find(p => p.id === provider);
  const connectBody = () => ({
    provider,
    ...((formInfo?.needsKey || formInfo?.keyOptional) && (formInfo.needsKey || apiKey.trim())
      ? { apiKey }
      : {}),
    ...(formInfo && formInfo.baseUrl !== 'none' ? { baseUrl: baseUrl.trim() || null } : {}),
  });

  const connectedHere = status?.connected && status.source === 'workspace';
  const usingServerKey = status?.connected && status.source === 'server';

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h3 className="text-[14px] font-semibold text-text">AI Test Generation</h3>
          <p className="mt-0.5 text-[11.5px] text-text-3">
            Lets “Generate with AI” and “Improve with AI” write and revise test cases, using{' '}
            {status?.connected && active
              ? active.label
              : 'Claude, Gemini, OpenAI, OpenRouter, Groq, Grok, Mistral, DeepSeek, a local Ollama or any OpenAI-compatible server'}
            .
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {loading ? (
            <p className="text-[12px] text-text-3">Loading…</p>
          ) : status?.connected ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-1 text-[11.5px] font-medium text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              {usingServerKey ? 'Using server key' : 'Connected'}
            </span>
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

      {(error || note) && (
        <p
          className={cn(
            'border-b border-border px-5 py-2 text-[11.5px]',
            error ? 'bg-danger-bg/40 text-danger-text' : 'bg-success/10 text-success',
          )}
        >
          {error ?? note}
        </p>
      )}

      {/* ── Connect form (not connected, or switching from the shared server key) ── */}
      {!loading && status && (!status.connected || usingServerKey) && editing && (
        <KeyForm
          status={status}
          provider={provider}
          setProvider={changeProvider}
          apiKey={apiKey}
          setApiKey={v => {
            setApiKey(v);
            setError(null);
          }}
          baseUrl={baseUrl}
          setBaseUrl={v => {
            setBaseUrl(v);
            setError(null);
          }}
          model={model}
          setModel={setModel}
          busy={busy === 'connect'}
          submitLabel="Connect"
          onSubmit={() => save({ ...connectBody(), model: model || null }, 'connect')}
          onCancel={() => {
            setEditing(false);
            setApiKey('');
            setProvider(status.provider ?? 'anthropic');
            setError(null);
          }}
        />
      )}

      {!loading && status && !status.connected && !editing && (
        <p className="px-5 py-4 text-[12px] text-text-3">
          Not connected.{' '}
          {canEdit
            ? 'Click Connect, choose a provider, then paste its API key (or, for Ollama or a custom server, its address).'
            : 'Ask a workspace admin to connect it.'}
        </p>
      )}

      {/* ── Connected ── */}
      {!loading && status?.connected && (
        <div className="flex flex-col gap-4 px-5 py-4">
          {usingServerKey && !editing && (
            <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
              <p className="text-[12px] text-text-2">
                This workspace is using the shared key set up on the server. You can connect your
                own key instead.
              </p>
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setEditing(true)}
                className="flex-shrink-0 rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-text hover:bg-surface-2 disabled:opacity-50"
              >
                Use my own key
              </button>
            </div>
          )}

          {connectedHere && (
            <div className="flex flex-col gap-1">
              {!replacing && (
                <label className="text-[12.5px] font-semibold text-text">
                  {active?.needsKey ? `${active.label} API key` : 'Server address'}
                </label>
              )}
              {replacing ? (
                <KeyForm
                  compact
                  status={status}
                  provider={provider}
                  setProvider={changeProvider}
                  switching={provider !== (status.provider ?? 'anthropic')}
                  apiKey={apiKey}
                  setApiKey={v => {
                    setApiKey(v);
                    setError(null);
                  }}
                  baseUrl={baseUrl}
                  setBaseUrl={v => {
                    setBaseUrl(v);
                    setError(null);
                  }}
                  model={model}
                  setModel={setModel}
                  busy={busy === 'replace'}
                  submitLabel={formInfo?.needsKey ? 'Save key' : 'Save'}
                  onSubmit={() => save(connectBody(), 'replace')}
                  onCancel={() => {
                    setReplacing(false);
                    setApiKey('');
                    setProvider(status.provider ?? 'anthropic');
                    setError(null);
                  }}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-[7px] border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-text-2">
                    {active?.needsKey ? status.keyHint : status.baseUrl}
                  </code>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setReplacing(true)}
                    className="rounded-[7px] border border-border bg-surface px-3 py-2 text-[12px] font-medium text-text hover:bg-surface-2 disabled:opacity-50"
                  >
                    {active?.needsKey ? 'Replace key' : 'Change'}
                  </button>
                </div>
              )}
              <p className="text-[11px] text-text-3">
                {active?.needsKey
                  ? 'The key is never shown again after saving.' +
                    (!status.encrypted && canEdit
                      ? ' It is stored like the Jira token; set APP_ENCRYPTION_KEY on the server to encrypt it at rest.'
                      : '')
                  : 'Requests go from the SimpliTest server to this address.'}
              </p>
            </div>
          )}

          <div
            className={cn(
              'grid grid-cols-1 gap-4 sm:grid-cols-2',
              // the connect form above already has its own model picker
              usingServerKey && editing && 'hidden',
            )}
          >
            <ModelSelect
              label="Model for writing test cases"
              help={active?.models.find(m => m.id === (status.model ?? active.defaultModel))?.hint}
              value={status.model ?? ''}
              defaultLabel={
                active?.defaultModel
                  ? `Default — ${modelLabel(null, active.defaultModel)}`
                  : 'Not set'
              }
              models={active?.models ?? []}
              placeholder={active?.modelPlaceholder}
              disabled={!canEdit || !connectedHere || busy !== null}
              onChange={v => save({ model: v || null }, 'model')}
            />
            <ModelSelect
              label="Model for the duplicate double-check"
              help="A small, fast model is enough for this."
              value={status.tiebreakModel ?? ''}
              defaultLabel={
                active?.defaultTiebreakModel
                  ? `Default — ${modelLabel(null, active.defaultTiebreakModel)}`
                  : 'Same as the writing model'
              }
              models={active?.models ?? []}
              placeholder={active?.modelPlaceholder}
              disabled={!canEdit || !connectedHere || busy !== null}
              onChange={v => save({ tiebreakModel: v || null }, 'tiebreak')}
            />
          </div>
          {usingServerKey && !editing && (
            <p className="-mt-2 text-[11px] text-text-3">
              Models follow the server&apos;s defaults until you connect your own key.
            </p>
          )}

          <div className="border-t border-border pt-4">
            <p className="mb-2 text-[12.5px] font-semibold text-text">Duplicate check</p>
            <div className="flex flex-col gap-1">
              <select
                className={cn(inputCls, 'max-w-[320px]')}
                value={status.settings.duplicateCheck}
                disabled={!canEdit}
                onChange={e =>
                  void saveSettings({ duplicateCheck: e.target.value as DuplicateCheck })
                }
              >
                {DUPLICATE_OPTIONS.map(o => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-text-3">
                {DUPLICATE_OPTIONS.find(o => o.v === status.settings.duplicateCheck)?.hint} Compared
                against the cases already in the module or feature you generate into; you always
                choose what happens next.
              </p>
            </div>
            <label
              className={cn(
                'mt-3 flex items-start gap-2.5',
                status.settings.duplicateCheck === 'off' && 'opacity-50',
              )}
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={status.settings.aiTiebreak}
                disabled={!canEdit || status.settings.duplicateCheck === 'off'}
                onChange={e => void saveSettings({ aiTiebreak: e.target.checked })}
              />
              <span className="text-[12.5px] text-text">
                Let the AI double-check similar cases
                <span className="mt-0.5 block text-[11px] text-text-3">
                  Catches duplicates that are worded very differently (“Sign in works” vs “Verify
                  login”) and confirms the close ones. Uses one extra short AI request per
                  generation.
                </span>
              </span>
            </label>
          </div>

          {connectedHere && canEdit && (
            <div className="flex justify-end border-t border-border pt-3">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void disconnect()}
                className="rounded-[7px] border border-danger/30 bg-danger-bg px-3 py-1.5 text-[12px] font-medium text-danger-text hover:bg-danger-bg/80 disabled:opacity-50"
              >
                {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KeyForm({
  status,
  provider,
  setProvider,
  switching,
  apiKey,
  setApiKey,
  baseUrl,
  setBaseUrl,
  model,
  setModel,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
  compact,
}: {
  status: AiStatus;
  provider: ProviderId;
  setProvider: (p: ProviderId) => void;
  /** Replacing the key of a connected workspace with one for ANOTHER provider. */
  switching?: boolean;
  apiKey: string;
  setApiKey: (v: string) => void;
  baseUrl: string;
  setBaseUrl: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  busy: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  compact?: boolean;
}) {
  const info = status.providers.find(p => p.id === provider) ?? status.providers[0];
  const needsAddress = info.baseUrl === 'required' && !info.defaultBaseUrl;
  const needsModel = !info.defaultModel;
  const ready =
    (!info.needsKey || !!apiKey.trim()) &&
    (!needsAddress || !!baseUrl.trim()) &&
    (!needsModel || compact || !!model.trim()) &&
    !busy;
  return (
    <div className={cn('flex flex-col gap-3', !compact && 'px-5 py-4')}>
      <div className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-text">AI provider</span>
        <div className="grid w-full max-w-[560px] grid-cols-2 gap-0.5 rounded-[7px] border border-border bg-surface-2 p-0.5 sm:grid-cols-5">
          {status.providers.map(p => (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => setProvider(p.id)}
              aria-pressed={provider === p.id}
              title={p.label}
              className={cn(
                'rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition-colors',
                provider === p.id
                  ? 'bg-surface text-text shadow-sm'
                  : 'text-text-3 hover:text-text',
              )}
            >
              {p.id === 'custom' ? 'Custom' : p.label.split(' (')[0]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-text-3">{info.note}</p>
        {switching && (
          <p className="text-[11px] text-text-3">
            Switching to {info.label} replaces the current connection and puts the models back to
            its defaults.
          </p>
        )}
      </div>
      {(info.needsKey || info.keyOptional) && (
        <div className="flex flex-col gap-1">
          {!compact && (
            <label className="text-[12.5px] font-semibold text-text">
              {info.label} API key{info.needsKey ? '' : ' (optional)'}
            </label>
          )}
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && ready) onSubmit();
            }}
            placeholder={info.keyPlaceholder}
            className={inputCls}
          />
          <p className="text-[11px] text-text-3">
            {info.needsKey ? (
              <>
                Create one at{' '}
                <a
                  href={info.keyUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary hover:underline"
                >
                  {info.keyUrlLabel}
                </a>
                . It is checked with the AI service when you save.
              </>
            ) : (
              'Leave empty if your server does not ask for a key.'
            )}
          </p>
        </div>
      )}
      {info.baseUrl !== 'none' && (
        <div className="flex flex-col gap-1">
          <label className="text-[12.5px] font-semibold text-text">
            Server address{info.baseUrl === 'optional' ? ' (optional)' : ''}
          </label>
          <input
            type="url"
            autoComplete="off"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && ready) onSubmit();
            }}
            placeholder={info.defaultBaseUrl}
            className={inputCls}
          />
          <p className="text-[11px] text-text-3">
            {info.id === 'ollama' ? (
              <>
                Where Ollama is running, as seen from the SimpliTest server. Leave empty for{' '}
                {info.defaultBaseUrl}. Install it from{' '}
                <a
                  href={info.keyUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary hover:underline"
                >
                  {info.keyUrlLabel}
                </a>
                , then pull a model (e.g. <code>ollama pull llama3.1</code>).
              </>
            ) : info.id === 'custom' ? (
              <>
                The address of the server, as seen from the SimpliTest server, e.g.
                http://localhost:1234 for LM Studio. The app adds /v1 itself.
              </>
            ) : (
              <>
                Leave empty for OpenAI itself. Enter another address to use an OpenAI-compatible
                service instead.
              </>
            )}
          </p>
        </div>
      )}
      {!compact && (
        <ModelSelect
          label="Model for writing test cases"
          help={info.models.find(m => m.id === (model || info.defaultModel))?.hint}
          value={model}
          defaultLabel={
            info.defaultModel
              ? `Default — ${info.models.find(m => m.id === info.defaultModel)?.label ?? info.defaultModel}`
              : 'Choose a model…'
          }
          models={info.models}
          placeholder={info.modelPlaceholder}
          onChange={setModel}
        />
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={onSubmit}
          className="btn btn-primary btn-sm"
        >
          {busy ? <i className="ti ti-loader-2 animate-spin text-[13px]" /> : submitLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-text hover:bg-surface-2 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const OTHER = '__other__';

function ModelSelect({
  label,
  help,
  value,
  defaultLabel,
  models,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  help?: string;
  value: string;
  defaultLabel: string;
  models: ModelOption[];
  /** Hint for the "Other model…" text box, e.g. "gemini-…". */
  placeholder?: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  // "Other model…" lets an admin type any model id the provider offers, so a new
  // release can be used before the list above is updated.
  const [other, setOther] = useState(false);
  const [text, setText] = useState('');
  const custom = !!value && !models.some(m => m.id === value);
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[12.5px] font-semibold text-text">{label}</label>
      <select
        className={inputCls}
        value={other ? OTHER : value}
        disabled={disabled}
        onChange={e => {
          if (e.target.value === OTHER) {
            setOther(true);
            setText(custom ? value : '');
          } else {
            setOther(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">{defaultLabel}</option>
        {models.map(m => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
        {custom && !other && <option value={value}>{value}</option>}
        <option value={OTHER}>Other model…</option>
      </select>
      {other && (
        <div className="flex gap-2">
          <input
            autoFocus
            value={text}
            disabled={disabled}
            onChange={e => setText(e.target.value.trim())}
            onKeyDown={e => {
              if (e.key === 'Enter' && text) {
                setOther(false);
                onChange(text);
              }
            }}
            placeholder={placeholder}
            className={inputCls}
          />
          <button
            type="button"
            disabled={disabled || !text}
            onClick={() => {
              setOther(false);
              onChange(text);
            }}
            className="rounded-[7px] border border-border bg-surface px-3 py-2 text-[12px] font-medium text-text hover:bg-surface-2 disabled:opacity-50"
          >
            Use
          </button>
        </div>
      )}
      {help && <p className="text-[11px] text-text-3">{help}</p>}
    </div>
  );
}
