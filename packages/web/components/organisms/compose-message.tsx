'use client';

import type { MessageId, Party, ShipId } from '@aeolus-fleet/common';
import { useState } from 'react';

import { composeTargets, sendInputOf, useSendMessage } from '../../lib/compose';
import { useFleetSnapshot } from '../../lib/fleet';
import { showToast } from '../atoms/toast';
import { ComposeDialog } from './compose-dialog';

interface ComposeMessageProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** A reply: the message it answers and its sender, who the reply goes to. */
  replyTo?: { messageId: MessageId; sender: Party };
  /** Message this ship, from its row menu: the recipient is set. */
  toShipId?: ShipId;
}

/**
 * Compose, from the Header on any page: a message from argo to one active
 * ship or any ship of a type, sent as plain text. Each message keeps one
 * idempotency key until it is sent, so trying again after a lost answer never
 * sends it twice. A refusal keeps what the operator wrote. A reply starts
 * with its recipient set and names the message it answers.
 */
export function ComposeMessage({ isOpen, onOpenChange, replyTo, toShipId }: ComposeMessageProps) {
  const fleet = useFleetSnapshot();
  const send = useSendMessage();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const { ships, types } = composeTargets(fleet.data ?? []);

  return (
    <ComposeDialog
      isOpen={isOpen}
      onOpenChange={(isNowOpen) => {
        if (!isNowOpen) {
          send.reset();
        }
        onOpenChange(isNowOpen);
      }}
      ships={ships}
      types={types}
      state={send.isPending ? 'sending' : send.isError ? 'failed' : 'editing'}
      error={send.error?.message}
      draft={replyTo ? { selector: { kind: 'ship', shipId: replyTo.sender.id }, payload: '' } : toShipId && { selector: { kind: 'ship', shipId: toShipId }, payload: '' }}
      onSend={(message) => {
        send.mutate(sendInputOf({ ...message, inReplyTo: replyTo?.messageId }, idempotencyKey), {
          onSuccess: () => {
            setIdempotencyKey(crypto.randomUUID());
            send.reset();
            onOpenChange(false);
            showToast({ title: 'Message sent', description: 'It waits in the inbox until a ship receives it.', tone: 'success' });
          },
        });
      }}
    />
  );
}
