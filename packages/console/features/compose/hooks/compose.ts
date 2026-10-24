import type { ListedShip, MessageId, SendInput } from '@aeolus-fleet/common';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { SelectorValue } from '../molecules/selector-picker';
import { useTRPC } from '../../../lib/trpc';

/** Who the operator may write to, of the ships given: the active agent ships, never argo, never a retired one, each once. */
export function composeShips(ships: readonly ListedShip[]): ListedShip[] {
  return ships.filter((ship, index) => ship.kind === 'agent' && ship.status !== 'retired' && ships.findIndex((each) => each.id === ship.id) === index);
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
