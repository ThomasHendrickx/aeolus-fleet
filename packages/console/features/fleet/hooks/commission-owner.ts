'use client';

import type { ShipId } from '@aeolus-fleet/common';
import { RECORD_PAGE_SIZE_DEFAULT } from '@aeolus-fleet/common/rules';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useTRPC } from '../../../lib/trpc';
import { ownerChoicesOf, type OwnerChoice } from '../services/owner-choices';

export type { OwnerChoice };

/** The person ships could not be read: why, and how to read them again. */
export interface OwnerFailure {
  message: string;
  onRetry: () => void;
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
 * until read.
 */
export function useCommissionOwner(isOpen: boolean): CommissionOwner | undefined {
  const trpc = useTRPC();
  const [query, setQuery] = useState('');
  const account = useQuery(trpc.console.account.queryOptions());
  const isArgo = account.data?.kind === 'operator';
  const nameQuery = query.trim();
  const personShips = useQuery(
    trpc.fleet.list.queryOptions(
      { shipKind: ['person'], limit: RECORD_PAGE_SIZE_DEFAULT, ...(nameQuery === '' ? {} : { nameQuery }) },
      { enabled: isOpen && isArgo, placeholderData: keepPreviousData },
    ),
  );
  const lastNamed = useQuery(trpc.fleet.lastNamedOwner.queryOptions(undefined, { enabled: isOpen && isArgo }));
  if (!isArgo) {
    return undefined;
  }
  const failed = personShips.isError ? personShips : lastNamed.isError ? lastNamed : undefined;
  const failure =
    failed === undefined
      ? {}
      : {
          failure: {
            message: failed.error.message,
            onRetry: () => {
              if (personShips.isError) {
                void personShips.refetch();
              }
              if (lastNamed.isError) {
                void lastNamed.refetch();
              }
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
