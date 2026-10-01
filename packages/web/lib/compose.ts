import type { ListedShip, MessageId, SendInput } from '@aeolus-fleet/common';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { SelectorValue } from '../components/molecules/selector-picker';
import { useTRPC } from './trpc';

/**
 * Who the operator may write to: the active agent ships (never argo, never a
 * retired one), and the types they use, each once, in order.
 */
export function composeTargets(fleet: readonly ListedShip[]): { ships: ListedShip[]; types: string[] } {
  const ships = fleet.filter((ship) => ship.kind === 'agent' && ship.status !== 'retired');
  return { ships, types: [...new Set(ships.map((ship) => ship.type))].sort() };
}

/** The send of a composed message: plain text, under the key this compose was opened with. */
export function sendInputOf(
  message: { selector: SelectorValue; payload: string; inReplyTo?: MessageId },
  idempotencyKey: string,
): SendInput {
  const { selector, payload, inReplyTo } = message;
  return { selector, payload, contentType: 'text/plain', idempotencyKey, ...(inReplyTo === undefined ? {} : { inReplyTo }) };
}

/** Sends a message as argo from the console. */
export function useSendMessage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    trpc.ship.send.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.fleet.pathKey() }),
    }),
  );
}
