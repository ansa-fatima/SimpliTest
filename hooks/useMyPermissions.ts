'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client';
import type { PermissionKey } from '@/lib/permissions';

// What the signed-in user may do in a workspace (the Roles & Permissions grid, resolved for
// their role). Used to disable actions the server would refuse anyway. While it loads, and
// if it cannot be read, everything is allowed -- the server is the real gate.
const cache = new Map<string, PermissionKey[]>();

export function useMyPermissions(projectId: string | null | undefined) {
  const [perms, setPerms] = useState<PermissionKey[] | null>(
    projectId ? (cache.get(projectId) ?? null) : null,
  );
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .get<{ permissions: PermissionKey[] }>(`/api/projects/${projectId}/my-permissions`)
      .then(r => {
        cache.set(projectId, r.permissions);
        if (!cancelled) setPerms(r.permissions);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  const can = useCallback(
    (key: PermissionKey) => (perms === null ? true : perms.includes(key)),
    [perms],
  );
  return { can, loaded: perms !== null };
}

/** Tooltip for a disabled action. */
export const NO_PERMISSION = 'Your role does not allow this (see Teams → Roles).';
