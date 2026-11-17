'use client';

import type { ShipId } from '@aeolus-fleet/common';
import { RECORD_PAGE_SIZE_DEFAULT } from '@aeolus-fleet/common/rules';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { LAST_SEEN_REFRESH_MS } from '../../../lib/fleet';
import { useTRPC } from '../../../lib/trpc';
import { ownerChoicesOf, type OwnerChoice } from '../services/owner-choices';

export type { OwnerChoice };

/** The person ships could not be read: why, and how to read them again. */
export interface OwnerFailure {
  message: string;
  onRetry: () => void;
  isRetrying: boolean;
}

export interface CommissionOwner {
  choices: readonly OwnerChoice[] | undefined;
  lastPicked: ShipId | undefined;
  /** What the operator typed in the field: the person ships whose names hold it are read. */
  onQueryChange: (query: string) => void;
  failure?: OwnerFailure;
}

/**
 * Who may own a ship argo commissions from the console (decision 0045): the
 * active person ships whose names hold what argo types, one page of them from
 * the fleet, and the one argo named last, preselected (read by itself, so it
 * is offered wherever the search stands). Undefined when the console is not
 * signed in as argo: an account's commission is owned by its person ship and
 * names no owner. Read only while the dialog is open; choices are undefined
 * until read. Open choices refresh every 30 seconds so a person ship
 * commissioned later by the account app becomes available.
 */
export function useCommissionOwner(isOpen: boolean): CommissionOwner | undefined {
  const trpc = useTRPC();
  const [query, setQuery] = useState('');
  const [isRetrying, setIsRetrying] = useState(false);
  const account = useQuery(trpc.console.account.queryOptions());
  const isArgo = account.data?.kind === 'operator';
  const nameQuery = query.trim();
  const personShips = useQuery(
    trpc.fleet.list.queryOptions(
      { shipKind: ['person'], limit: RECORD_PAGE_SIZE_DEFAULT, ...(nameQuery === '' ? {} : { nameQuery }) },
      { enabled: isOpen && isArgo, placeholderData: keepPreviousData, refetchInterval: LAST_SEEN_REFRESH_MS },
    ),
  );
  const lastNamed = useQuery(trpc.fleet.lastNamedOwner.queryOptions(undefined, { enabled: isOpen && isArgo }));
  if (!isArgo) {
    return undefined;
  }
  const failed = personShips.isError ? personShips : lastNamed.isError ? lastNamed : undefined;
  const failure =
    failed === undefined && !isRetrying
      ? {}
      : {
          failure: {
            message: failed?.error.message ?? 'Reading the person ships again. Nothing you typed is lost.',
            isRetrying,
            onRetry: () => {
              setIsRetrying(true);
              void Promise.all([...(personShips.isError ? [personShips.refetch()] : []), ...(lastNamed.isError ? [lastNamed.refetch()] : [])]).finally(() => { setIsRetrying(false); });
            },
          },
        };
  return {
    choices: ownerChoicesOf(personShips.data?.items, lastNamed.data?.owner ?? undefined),
    lastPicked: lastNamed.data?.owner?.id,
    onQueryChange: setQuery,
    ...failure,
  };
}
