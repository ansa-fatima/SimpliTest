'use client';

import { cloneElement, isValidElement, type ReactElement } from 'react';
import { NO_PERMISSION } from '@/hooks/useMyPermissions';

/**
 * Disables a single button (and explains why on hover) when the user's role does not allow
 * what it does. The server refuses the action either way; this just says so up front.
 */
export function Gate({
  allowed,
  children,
}: {
  allowed: boolean;
  children: ReactElement<{ disabled?: boolean }>;
}) {
  if (allowed || !isValidElement(children)) return children;
  return (
    <span title={NO_PERMISSION} style={{ display: 'inline-flex' }}>
      {cloneElement(children, { disabled: true })}
    </span>
  );
}
