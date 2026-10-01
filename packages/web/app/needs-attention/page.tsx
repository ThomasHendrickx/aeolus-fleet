'use client';

import type { DeliveryId } from '@aeolus-fleet/common';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { showToast } from '../../components/atoms/toast';
import { ComposeMessage } from '../../components/organisms/compose-message';
import { NeedsAttentionList } from '../../components/organisms/needs-attention-list';
import { ListLayout } from '../../components/templates/list-layout';
import { useOpenInboxCount } from '../../lib/inbox';
import { useLiveFleet } from '../../lib/live-fleet';
import {
  deliveryWithId,
  DISMISSED_TOAST,
  messagePathOf,
  resentToast,
  useDismissDelivery,
  useNeedsAttention,
  useResendDelivery,
} from '../../lib/needs-attention';
import { useNow } from '../../lib/now';
import { useAccountMenu } from '../../lib/account';
import { useSignInWhenSessionEnds } from '../../lib/session';

/**
 * Needs attention, live: every undeliverable delivery, oldest first. Resend
 * sends it again as a new message from its sender; Dismiss lets it go. Either
 * removes it from the list, with a toast. Without a session it sends the
 * operator to sign in.
 */
export default function NeedsAttentionPage() {
  const router = useRouter();
  const now = useNow();
  const attention = useNeedsAttention();
  const resend = useResendDelivery();
  const dismiss = useDismissDelivery();
  const liveFleet = useLiveFleet();
  const accountMenu = useAccountMenu(now);
  const inboxCount = useOpenInboxCount();
  const [isComposing, setIsComposing] = useState(false);
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<DeliveryId>>(new Set());

  const settle = (deliveryId: DeliveryId) => {
    setPendingIds((pending) => new Set([...pending].filter((id) => id !== deliveryId)));
  };
  const act = (deliveryId: DeliveryId, run: () => Promise<void>) => {
    setPendingIds((pending) => new Set([...pending, deliveryId]));
    void run().finally(() => {
      settle(deliveryId);
    });
  };

  const onResend = (deliveryId: DeliveryId) => {
    const delivery = deliveryWithId(attention.data, deliveryId);
    act(deliveryId, async () => {
      try {
        await resend.mutateAsync({ deliveryId });
        if (delivery) {
          showToast({ ...resentToast(delivery), tone: 'success' });
        }
      } catch (error) {
        showToast({ title: "Couldn't resend the message", description: messageOf(error), tone: 'error' });
      }
    });
  };
  const onDismiss = (deliveryId: DeliveryId) => {
    act(deliveryId, async () => {
      try {
        await dismiss.mutateAsync({ deliveryId });
        showToast({ ...DISMISSED_TOAST, tone: 'success' });
      } catch (error) {
        showToast({ title: "Couldn't dismiss the delivery", description: messageOf(error), tone: 'error' });
      }
    });
  };

  return (
    <ListLayout
      title="Needs attention"
      description="Deliveries no ship acknowledged after five tries, oldest first. Resend or dismiss each one."
      live={liveFleet.live}
      nav={{ active: 'attention', inboxCount, attentionCount: attention.data?.length }}
      onCompose={() => {
        setIsComposing(true);
      }}
      account={accountMenu}
    >
      <NeedsAttentionList
        deliveries={attention.data ?? []}
        state={attention.isError ? 'error' : attention.data ? 'ready' : 'loading'}
        onRetry={() => {
          void attention.refetch();
        }}
        onResend={onResend}
        onDismiss={onDismiss}
        onOpen={(delivery) => {
          router.push(messagePathOf(delivery));
        }}
        pendingIds={pendingIds}
        now={now}
      />
      <ComposeMessage isOpen={isComposing} onOpenChange={setIsComposing} />
    </ListLayout>
  );
}

/** The refusal's words, safe to show: the server's message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Try again in a moment.';
}
