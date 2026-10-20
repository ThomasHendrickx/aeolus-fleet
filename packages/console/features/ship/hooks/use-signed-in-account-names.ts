'use client';

import type { AccountId, TimelineEntry } from '@aeolus-fleet/common';

import { useConsoleRead } from '../../../lib/console-read-query';
import { fetchConsoleRead } from '../../../lib/fetch-console-read';

/**
 * The names pagasae gives the accounts a timeline names as signed in as
 * argo, asked by the web app's server and never stored (decisions 0054,
 * 0058). Empty while it loads, without pagasae, and for an account pagasae
 * gives no name: the timeline shows its id then.
 */
export function useSignedInAccountNames(entries: readonly TimelineEntry[]): Partial<Record<AccountId, string>> {
  const accountIds = [...new Set(entries.flatMap((entry) => (entry.signedInAccountId === null ? [] : [entry.signedInAccountId])))].sort();
  const names = useConsoleRead({
    queryKey: ['account-names', ...accountIds],
    queryFn: () => fetchConsoleRead({ read: 'account-names', input: { accountIds } }),
    enabled: accountIds.length > 0,
  });
  return names.data ?? {};
}
