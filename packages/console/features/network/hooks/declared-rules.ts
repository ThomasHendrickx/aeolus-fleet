'use client';

import { useQuery } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';

/**
 * The rules plugins declared, as argo reads them on Network (design point 6
 * on #573; decision 0037): each declaring ship with its whole list, from the
 * fleet, argo's by fleet:network.
 */

/** Every ship's declared rules: asked only while Network shows. */
export function useDeclaredNetworkRules(isShown: boolean) {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.declaredNetworkRules.queryOptions(undefined, { enabled: isShown }));
}
