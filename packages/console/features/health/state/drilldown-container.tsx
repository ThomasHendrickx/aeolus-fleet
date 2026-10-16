'use client';

import type { DeliveryId, StuckCause } from '@aeolus-fleet/common';
import { useState } from 'react';

import { showToast } from '../../../components/atoms/toast';
import { useAccess } from '../../../lib/access';
import { useFleetSnapshot } from '../../../lib/fleet';
import { useFleetHealth } from '../../../lib/fleet-health';
import { DISMISSED_TOAST, useDismissDelivery, useResendDelivery } from '../../../lib/needs-attention';
import { useNow } from '../../../lib/now';
import { useStuckMessages } from '../hooks/use-stuck-messages';
import { causeGroupsOf, placeName } from '../services/health-view';
import { StuckDrilldown, type DrilldownShip } from '../ui/organisms/stuck-drilldown';

/**
 * One cause opened, read live: its places from the fleet's health, each
 * ship's status, type and last seen from the fleet snapshot, and each stuck
 * delivery's message. A manager resends or dismisses an undeliverable one,
 * with a toast either way.
 */
export function DrilldownContainer({ cause }: { cause: StuckCause }) {
  const now = useNow();
  const health = useFleetHealth();
  const fleet = useFleetSnapshot();
  const access = useAccess();
  const resend = useResendDelivery();
  const dismiss = useDismissDelivery();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<DeliveryId>>(new Set());
  const places = causeGroupsOf(health.data ?? { stuck: [] }).find((group) => group.cause === cause)?.places ?? [];
  const { messages } = useStuckMessages(places.flatMap((place) => place.deliveries.map((delivery) => delivery.messageId)));
  const ships = new Map<string, DrilldownShip>((fleet.data ?? []).map((ship) => [ship.id, { status: ship.status, type: ship.type, lastSeenAt: ship.lastSeenAt }]));

  const act = (deliveryId: DeliveryId, run: () => Promise<void>) => {
    setPendingIds((pending) => new Set([...pending, deliveryId]));
    void run().finally(() => {
      setPendingIds((pending) => new Set([...pending].filter((id) => id !== deliveryId)));
    });
  };
  const onResend = (deliveryId: DeliveryId) => {
    const place = places.find((one) => one.deliveries.some((delivery) => delivery.deliveryId === deliveryId));
    act(deliveryId, async () => {
      try {
        await resend.mutateAsync({ deliveryId });
        showToast({
          title: 'Message resent',
          description: place === undefined ? 'The original is dismissed.' : `A new message went to ${placeName(place.place)}. The original is dismissed.`,
          tone: 'success',
        });
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

  return (
    <StuckDrilldown
      cause={cause}
      state={health.isError ? 'error' : health.data ? 'ready' : 'loading'}
      places={places}
      ships={ships}
      messages={messages}
      onRetry={() => {
        void health.refetch();
      }}
      onResend={access.canManage ? onResend : undefined}
      onDismiss={access.canManage ? onDismiss : undefined}
      pendingIds={pendingIds}
      now={now}
    />
  );
}

/** The refusal's words, safe to show: the server's message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Try again in a moment.';
}
