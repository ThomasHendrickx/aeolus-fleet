'use client';

import type { ListedShip } from '@aeolus-fleet/common';
import { isInReadReach } from '@aeolus-fleet/common/rules';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { CONSOLE_PAGE_SIZE } from './paged-list';
import { useTRPC } from './trpc';

/**
 * The ships a picker offers as the operator types (Thomas, 24 Oct): the
 * first 20 active ships whose name or type holds the text, from `fleet.list`;
 * the first 20 by name before anything is typed. Never the whole fleet
 * (decision 4 of the performance design). Read only while `isEnabled`; while
 * a new text is read, the last answer stays. Only the ships the session reads
 * whole (decision 0034); undefined until the first answer.
 */
export function useShipSearch(query: string, isEnabled: boolean): readonly ListedShip[] | undefined {
  const trpc = useTRPC();
  const text = query.trim();
  const read = useQuery(
    trpc.fleet.list.queryOptions({ ...(text === '' ? {} : { query: text }), limit: CONSOLE_PAGE_SIZE }, { enabled: isEnabled, placeholderData: keepPreviousData }),
  );
  return read.data?.items.filter(isInReadReach);
}
