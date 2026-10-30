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
  /** fleet:manage: commission, the ship actions, squadrons and Settings. */
  canManage: boolean;
  /** messages:resend: Resend and Dismiss on a delivery that waits for the operator. */
  canResend: boolean;
  /** messages:send: Compose and Message. */
  canSend: boolean;
  /** messages:receive: the operator inbox's Mark read, Mark done and Reply. */
  canReceive: boolean;
  /** labels:define: Define a label, and change or delete the session's own (decision 0031). */
  canDefineLabels: boolean;
  /** labels:assign: put the session's own labels on a ship, change or take them off (decision 0031). */
  canAssignLabels: boolean;
  /** fleet:network: the networking plugin's rules and what it declares (decision 0036), argo's alone. */
  canEditNetwork: boolean;
  /** scopes:define: Define scope, and the fleet's own scopes described anew or removed (design gateway-scopes, 4.1). */
  canDefineScopes: boolean;
  /** fleet:keys: Turn on sealing, Change company key and the recovery key (decision 0068, N5). */
  canChangeKeys: boolean;
  /** A viewer session: the read-only console's own copy (the sidebar foot, the account menu). */
  isViewer: boolean;
}

/** Until the session is known nothing is offered, so a viewer never sees a write flash by. */
export const NO_ACCESS: Access = { canManage: false, canResend: false, canSend: false, canReceive: false, canDefineLabels: false, canAssignLabels: false, canEditNetwork: false, canDefineScopes: false, canChangeKeys: false, isViewer: false };

export function accessOf(session: Pick<ConsoleSessionOutput, 'kind' | 'scopes'> | undefined): Access {
  if (session === undefined) {
    return NO_ACCESS;
  }
  const holds = (scope: Scope) => session.scopes.includes(scope);
  // An account sends nothing from the console, and argo's inbox actions stay argo's (header design, C3, C4).
  const isShip = session.kind !== 'account';
  return {
    canManage: holds('fleet:manage'),
    canResend: holds('messages:resend'),
    canSend: isShip && holds('messages:send'),
    canReceive: isShip && holds('messages:receive'),
    canDefineLabels: holds('labels:define'),
    canAssignLabels: holds('labels:assign'),
    canEditNetwork: holds('fleet:network'),
    canDefineScopes: holds('scopes:define'),
    canChangeKeys: holds('fleet:keys'),
    isViewer: session.kind === 'viewer',
  };
}

export function useAccess(): Access {
  const trpc = useTRPC();
  return accessOf(useQuery(trpc.console.session.queryOptions()).data);
}
