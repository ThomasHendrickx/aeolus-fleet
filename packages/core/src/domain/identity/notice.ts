import type { AccountId, ConsoleSessionId, NoticeAudience, NoticeLink, ShipKind } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';

/**
 * A notice (decision 0023): plain text the installation shows above every
 * console page to the sessions of its audience, with optional links, and
 * dismissible or not. Its shape is checked where the installation sets it
 * (`setNoticesInputSchema`); here it is trusted.
 */
export interface Notice {
  id: string;
  audience: NoticeAudience;
  text: string;
  links: readonly NoticeLink[];
  isDismissible: boolean;
}

/**
 * A console sign-in (blueprint, Sign-in), which reads notices and the guide
 * and keeps what it dismissed and where it is: as argo or the viewer, by its
 * console session's id; as an account, by its account id (accounts design, A9).
 */
export type ConsoleSignIn = { kind: ShipKind; consoleSessionId: ConsoleSessionId } | { kind: 'account'; accountId: AccountId };

/** The caller as a console sign-in; none for a ship calling without a console session, or the installation. */
export function consoleSignInOf(caller: Caller): ConsoleSignIn | undefined {
  switch (caller.kind) {
    case 'account':
      return { kind: 'account', accountId: caller.accountId };
    case 'installation':
      return undefined;
    case 'operator':
    case 'viewer':
    case 'agent':
    case 'person':
    case 'app':
    case 'plugin':
      return caller.consoleSessionId === undefined ? undefined : { kind: caller.kind, consoleSessionId: caller.consoleSessionId };
  }
}

/** Whether a console sign-in sees the notice (or the guide, decision 0024): everyone's always, the operators' on argo, the viewers' on the viewer ship, the accounts' by an account. */
export function isForSessionOf(notice: Pick<Notice, 'audience'>, kind: ConsoleSignIn['kind']): boolean {
  switch (notice.audience) {
    case 'everyone':
      return true;
    case 'operators':
      return kind === 'operator';
    case 'viewers':
      return kind === 'viewer';
    case 'accounts':
      return kind === 'account';
  }
}
