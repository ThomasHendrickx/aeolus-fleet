'use client';

import type { DeliveryId } from '@aeolus-fleet/common';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { showToast } from '../../components/atoms/toast';
import { ComposeMessage } from '../../components/organisms/compose-message';
import { ConsoleCommands } from '../../components/organisms/console-commands';
import { NeedsAttentionList } from '../../components/organisms/needs-attention-list';
import { GetNewCrewLine } from '../../components/organisms/get-new-crew-line';
import { SilentMembers } from '../../components/organisms/silent-members';
import { ListLayout } from '../../components/templates/list-layout';
import { useOpenInboxCount } from '../../lib/inbox';
import { useLiveFleet } from '../../lib/live-fleet';
import {
  deliveryWithId,
  DISMISSED_TOAST,
  messagePathOf,
  resentToast,
  useAttentionCount,
  useDismissDelivery,
  useNeedsAttention,
  useResendDelivery,
} from '../../lib/needs-attention';
import { useNow } from '../../lib/now';
import { useAccountMenu } from '../../lib/account';
import { useSignInWhenSessionEnds } from '../../lib/session';
import { useFleetSnapshot } from '../../lib/fleet';
import { useHasSquadrons } from '../../lib/squadrons';
import { useShips } from '../../lib/ship';
import { useSquadrons } from '../../lib/squadrons-api';
import { silentMembers } from '../../lib/squadrons-view';

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
  const hasSquadrons = useHasSquadrons();
  const squadrons = useSquadrons({ isEnabled: hasSquadrons });
  const silent = silentMembers(squadrons.data ?? []);
  const silentShips = useShips(silent.map(({ member }) => member.shipId));
  const fleet = useFleetSnapshot();
  const shipsById = new Map((fleet.data ?? []).map((ship) => [ship.id, ship]));
  const attentionCount = useAttentionCount();
  const inboxCount = useOpenInboxCount();
  const [isComposing, setIsComposing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
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

  const deliveriesList = (
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
  );

  return (
    <ListLayout
      title="Needs attention"
      description="Deliveries no ship acknowledged after five tries, oldest first. Resend or dismiss each one."
      live={liveFleet.live}
      nav={{ active: 'attention', inboxCount, attentionCount, hasSquadrons }}
      onCompose={() => {
        setIsComposing(true);
      }}
      onSearch={() => {
        setIsSearching(true);
      }}
      account={accountMenu}
    >
      {silent.length > 0 ? (
        <div className="flex flex-col gap-6">
          <section aria-labelledby="attention-undeliverable" className="flex flex-col gap-2">
            <h2 id="attention-undeliverable" className="text-body font-semibold">
              Undeliverable deliveries ({attention.data?.length ?? 0})
            </h2>
            {attention.data?.length === 0 ? <p className="text-meta text-muted-foreground">None.</p> : deliveriesList}
          </section>
          <section aria-labelledby="attention-silent" className="flex flex-col gap-2 max-sm:order-first">
            <h2 id="attention-silent" className="text-body font-semibold">
              Silent members ({silent.length})
            </h2>
            <SilentMembers
              members={silent}
              ships={shipsById}
              now={now}
              renderAction={({ squadronId, member }) => (
                <GetNewCrewLine squadronId={squadronId} member={member} ship={silentShips.get(member.shipId)} isPrimary testId="silent-member-new-crew-line" />
              )}
            />
            <p className="text-meta text-muted-foreground">
              A member is silent after 3 missed check-ins; only you can start its new session. Late members and blocked reports stay on their squadron page.
            </p>
          </section>
        </div>
      ) : (
        deliveriesList
      )}
      <ComposeMessage isOpen={isComposing} onOpenChange={setIsComposing} />
      <ConsoleCommands
        isOpen={isSearching}
        onOpenChange={setIsSearching}
        onCompose={() => {
          setIsComposing(true);
        }}
      />
    </ListLayout>
  );
}

/** The refusal's words, safe to show: the server's message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Try again in a moment.';
}
