'use client';

import type { DeliveryId, ShipId } from '@aeolus-fleet/common';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { showToast } from '../../../../components/atoms/toast';
import { LoadMore } from '../../../../components/molecules/load-more';
import { NeedsAttentionList } from '../../../../components/organisms/needs-attention-list';
import { useAccess } from '../../../../lib/access';
import { deliveryWithId, DISMISSED_TOAST, resentToast, useDismissDelivery, useNeedsAttention, useResendDelivery } from '../../../../lib/needs-attention';
import { useNow } from '../../../../lib/now';

/**
 * A ship's not handled deliveries (#304): acknowledged, then its turn died,
 * handed once more and that turn died too. Each offers Resend and Dismiss,
 * with a toast either way. Nothing shows while the ship has none.
 */
export function NotHandled({ shipId }: { shipId: ShipId }) {
  const router = useRouter();
  const now = useNow();
  const attention = useNeedsAttention(shipId);
  const resend = useResendDelivery();
  const dismiss = useDismissDelivery();
  const access = useAccess();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<DeliveryId>>(new Set());
  const deliveries = (attention.items ?? []).filter((delivery) => delivery.state === 'notHandled');

  const act = (deliveryId: DeliveryId, run: () => Promise<void>) => {
    setPendingIds((pending) => new Set([...pending, deliveryId]));
    void run().finally(() => {
      setPendingIds((pending) => new Set([...pending].filter((id) => id !== deliveryId)));
    });
  };
  const onResend = (deliveryId: DeliveryId) => {
    const delivery = deliveryWithId(deliveries, deliveryId);
    act(deliveryId, async () => {
      try {
        await resend.mutateAsync({ deliveryId });
        if (delivery) {
          showToast({ ...resentToast(delivery), tone: 'success' });
        }
      } catch (error) {
        showToast({ title: "Couldn’t resend the message", description: messageOf(error), tone: 'error' });
      }
    });
  };
  const onDismiss = (deliveryId: DeliveryId) => {
    act(deliveryId, async () => {
      try {
        await dismiss.mutateAsync({ deliveryId });
        showToast({ ...DISMISSED_TOAST, tone: 'success' });
      } catch (error) {
        showToast({ title: "Couldn’t dismiss the delivery", description: messageOf(error), tone: 'error' });
      }
    });
  };

  if (deliveries.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="ship-not-handled" data-testid="ship-not-handled" className="flex flex-col gap-2">
      <h2 id="ship-not-handled" className="text-body font-semibold">
        Not handled ({deliveries.length})
      </h2>
      <NeedsAttentionList
        deliveries={deliveries}
        state="ready"
        onRetry={attention.retry}
        onResend={access.canResend ? onResend : undefined}
        onDismiss={access.canResend ? onDismiss : undefined}
        onOpen={(delivery) => {
          router.replace(`/ships/${shipId}?tab=messages&message=${delivery.message.id}`, { scroll: false });
        }}
        pendingIds={pendingIds}
        now={now}
      />
      {attention.hasMore ? (
        <LoadMore what="more not handled" isLoading={attention.isLoadingMore} isFailed={attention.isLoadMoreFailed} onLoad={attention.loadMore} area="ship-not-handled" />
      ) : null}
    </section>
  );
}

/** The refusal's words, safe to show: the server's message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Try again in a moment.';
}
