'use client';

import { useState } from 'react';

import { composeTargets, sendInputOf, useSendMessage } from '../../lib/compose';
import { useFleetSnapshot } from '../../lib/fleet';
import { showToast } from '../atoms/toast';
import { ComposeDialog } from './compose-dialog';

interface ComposeMessageProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

/**
 * Compose, from the Header on any page: a message from argo to one active
 * ship or any ship of a type, sent as plain text. Each message keeps one
 * idempotency key until it is sent, so trying again after a lost answer never
 * sends it twice. A refusal keeps what the operator wrote.
 */
export function ComposeMessage({ isOpen, onOpenChange }: ComposeMessageProps) {
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
      onSend={(message) => {
        send.mutate(sendInputOf(message, idempotencyKey), {
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
