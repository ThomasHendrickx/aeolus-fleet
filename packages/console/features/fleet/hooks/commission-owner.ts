'use client';

import type { ShipId } from '@aeolus-fleet/common';
import { PAGE_SIZE_MAX } from '@aeolus-fleet/common/rules';
import { useQuery } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';

/** A person ship that may own what argo commissions, by id and name. */
export interface OwnerChoice {
  id: ShipId;
  name: string;
}

/**
 * Who may own a ship argo commissions from the console (decision 0045): the
 * fleet's active person ships, one `fleet.list` read by their kind (one per
 * person, so one page holds them), and the one argo named last, preselected.
 * Undefined when the console is not signed in as argo: an account's commission
 * is owned by its person ship and names no owner. Read only while the dialog is
 * open; choices are undefined until read.
 */
export function useCommissionOwner(isOpen: boolean): { choices: readonly OwnerChoice[] | undefined; lastPicked: ShipId | undefined } | undefined {
  const trpc = useTRPC();
  const account = useQuery(trpc.console.account.queryOptions());
  const isArgo = account.data?.kind === 'operator';
  const personShips = useQuery(trpc.fleet.list.queryOptions({ shipKind: ['person'], limit: PAGE_SIZE_MAX }, { enabled: isOpen && isArgo }));
  const lastNamed = useQuery(trpc.fleet.lastNamedOwner.queryOptions(undefined, { enabled: isOpen && isArgo }));
  if (!isArgo) {
    return undefined;
  }
  const choices = personShips.data?.items.filter((ship) => ship.status !== 'retired').map((ship) => ({ id: ship.id, name: ship.name }));
  const lastPicked = lastNamed.data?.owner?.id;
  return { choices, lastPicked: choices?.some((choice) => choice.id === lastPicked) === true ? lastPicked : undefined };
}
