'use client';

import type { ConsoleSessionOutput, Scope } from '@aeolus-fleet/common';
import { useQuery } from '@tanstack/react-query';

import { useTRPC } from './trpc';

/**
 * What this console session may do, from its ship's scopes as the server
 * answers them (`console.session`): the operator's argo holds every scope, a
 * viewer's ship `fleet:read` only (decision 0022). The console offers a write
 * only when the session holds its scope, and removes it otherwise, never
 * disables it; the server refuses it either way.
 */
export interface Access {
  /** fleet:manage: commission, the ship actions, resend, dismiss, squadrons and Settings. */
  canManage: boolean;
  /** messages:send: Compose and Message. */
  canSend: boolean;
  /** messages:receive: the operator inbox's Mark read, Mark done and Reply. */
  canReceive: boolean;
  /** labels:define: Define a label, and change or delete the session's own (decision 0031). */
  canDefineLabels: boolean;
  /** A viewer session: the read-only console's own copy (the sidebar foot, the account menu). */
  isViewer: boolean;
}

/** Until the session is known nothing is offered, so a viewer never sees a write flash by. */
export const NO_ACCESS: Access = { canManage: false, canSend: false, canReceive: false, canDefineLabels: false, isViewer: false };

export function accessOf(session: Pick<ConsoleSessionOutput, 'kind' | 'scopes'> | undefined): Access {
  if (session === undefined) {
    return NO_ACCESS;
  }
  const holds = (scope: Scope) => session.scopes.includes(scope);
  return {
    canManage: holds('fleet:manage'),
    canSend: holds('messages:send'),
    canReceive: holds('messages:receive'),
    canDefineLabels: holds('labels:define'),
    isViewer: session.kind === 'viewer',
  };
}

export function useAccess(): Access {
  const trpc = useTRPC();
  return accessOf(useQuery(trpc.console.session.queryOptions()).data);
}
