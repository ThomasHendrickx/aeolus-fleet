import type { ConsoleSessionOutput } from '@aeolus-fleet/common';

/** The reads Settings shows, each answered or not: an answer that failed counts as read, as its section says so. */
export interface SettingsReads {
  /** How this console is signed in; undefined until console.session answers. */
  signedInAs: ConsoleSessionOutput['kind'] | undefined;
  isAccountRead: boolean;
  /** The apps list, which names Your account: read for an account's own sign-in only. */
  isAppsListRead: boolean;
  canManage: boolean;
  /** Each plugin's connection Settings shows how the installation runs from, for a session that manages the fleet. */
  installationReads: readonly boolean[];
}

/**
 * Whether Settings may show its sections (docs/design/conventions.md,
 * loading): until what it shows is read it shows its loading shape, so no
 * section, description or theme switch flips in as each query answers.
 */
export function isSettingsRead({ signedInAs, isAccountRead, isAppsListRead, canManage, installationReads }: SettingsReads): boolean {
  if (signedInAs === undefined || !isAccountRead) {
    return false;
  }
  if (signedInAs === 'account' && !isAppsListRead) {
    return false;
  }
  return !canManage || installationReads.every(Boolean);
}
