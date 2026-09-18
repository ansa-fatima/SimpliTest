'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';

// Resolves a TestCycle.ticketLink into a real, clickable Jira URL --
// already a full URL, or a bare key ("NPD-10656") turned into
// {siteUrl}/browse/{key} using the workspace's connected Jira site. Returns
// null when neither applies (no connection, so no site to build a /browse/
// link against), so callers can fall back to plain text.
export function jiraTicketUrl(
  ticketLink: string,
  siteUrl: string | null | undefined,
): string | null {
  if (/^https?:\/\//i.test(ticketLink)) return ticketLink;
  if (!siteUrl) return null;
  return `${siteUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(ticketLink)}`;
}

// Fetches the workspace's connected Jira site URL once (null if
// disconnected or still loading) -- feed straight into jiraTicketUrl/
// JiraTicketLink. Reuses the same status endpoint the "Sync from Jira"
// buttons already check, so `connected` is equivalent to `siteUrl !== null`.
export function useJiraSiteUrl(projectId: string | null): string | null {
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .get<{ connected: boolean; siteUrl?: string }>(`/api/projects/${projectId}/integrations/jira`)
      .then(s => !cancelled && setSiteUrl(s.connected ? (s.siteUrl ?? null) : null))
      .catch(() => !cancelled && setSiteUrl(null));
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return siteUrl;
}

// Renders a ticketLink as a real link when one can be resolved, or plain
// text otherwise -- same display text either way (scheme stripped off a
// full URL, exactly like every ticketLink display already did). Always
// stops propagation: every call site sits inside a clickable row/card, and
// clicking the ticket should open Jira, not also trigger the row's own
// click handler.
export function JiraTicketLink({
  ticketLink,
  siteUrl,
  className,
}: {
  ticketLink: string;
  siteUrl: string | null;
  className?: string;
}) {
  const href = jiraTicketUrl(ticketLink, siteUrl);
  const label = ticketLink.replace(/^https?:\/\//, '');
  if (!href) return <span className={className}>{label}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={e => e.stopPropagation()}
      className={cn(className, 'hover:text-primary hover:underline')}
    >
      {label}
    </a>
  );
}
