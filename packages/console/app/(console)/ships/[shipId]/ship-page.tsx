'use client';

import type { MessageId, Party, ShipId } from '@aeolus-fleet/common';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../components/atoms/tabs';
import { ComposeMessage } from '../../../../features/compose/organisms/compose-message';
import { MessageThreads } from '../../../../features/ship/organisms/message-threads';
import { ShipCrewRequest } from '../../../../features/ship/organisms/ship-crew-request';
import { ShipSquadron } from '../../../../features/ship/organisms/ship-squadron';
import { ShipActions } from '../../../../features/ship-actions/organisms/ship-actions';
import { NewCrewLineFlow } from '../../../../features/squadrons/organisms/get-new-crew-line';
import { ShipHeader } from '../../../../features/ship/organisms/ship-header';
import { ShipPageLabels } from '../../../../features/ship/organisms/ship-page-labels';
import { ShipTimeline } from '../../../../features/ship/organisms/ship-timeline';
import { DetailPage } from '../../../../components/organisms/detail-page';
import { useConsoleFrame } from '../../../../lib/console-frame';
import { lazyDialog } from '../../../../lib/lazy-dialog';
import { useAccess } from '../../../../lib/access';
import { trpcErrorCode } from '../../../../lib/errors';
import { useLiveFleet } from '../../../../lib/live-fleet';
import { useNow } from '../../../../lib/now';
import { usePluginShipIds } from '../../../../lib/plugin-ships';
import { useSignInWhenSessionEnds } from '../../../../lib/session';
import { useMessage, useShip, useShipMessages, useShipTimeline } from '../../../../lib/ship';
import { useSquadrons } from '../../../../lib/squadrons-api';
import { shipsInSquadrons } from '../../../../lib/squadrons-view';
import { SHIP_TABS, type ShipTab } from '../../../../features/ship/lib/ship-tab';

// Dialogs load when first opened, not with the page.
const MessageSheet = lazyDialog(() => import('../../../../features/ship/organisms/message-sheet').then((module) => module.MessageSheet), (props) => props.isOpen);

/** The ship page's view in the URL: its tab and the open message. */
function pathOf(shipId: ShipId, view: { tab: ShipTab; messageId?: MessageId }): string {
  const params = new URLSearchParams();
  if (view.tab !== SHIP_TABS.timeline) {
    params.set('tab', view.tab);
  }
  if (view.messageId !== undefined) {
    params.set('message', view.messageId);
  }
  const query = params.toString();
  return query === '' ? `/ships/${shipId}` : `/ships/${shipId}?${query}`;
}

/**
 * A ship's page, live: its header, its timeline from the event log and its
 * messages grouped into threads, each opening in the MessageSheet with its
 * delivery history. The tab and the open message live in the URL, parsed on
 * the web app's server (page.tsx).
 */
export function ShipPageFor({ shipId, tab, messageId }: { shipId: ShipId; tab: ShipTab; messageId?: MessageId }) {
  const router = useRouter();
  const now = useNow();
  const pluginShipIds = usePluginShipIds();

  const ship = useShip(shipId);
  const timeline = useShipTimeline(shipId);
  const messages = useShipMessages(shipId);
  const message = useMessage(messageId);
  const liveFleet = useLiveFleet();
  const frame = useConsoleFrame();
  const squadrons = useSquadrons();
  const access = useAccess();
  const [replyTo, setReplyTo] = useState<{ messageId: MessageId; sender: Party }>();
  useSignInWhenSessionEnds([ship.error, timeline.error, messages.error, message.error, liveFleet.error]);

  const show = (view: { tab: ShipTab; messageId?: MessageId }) => {
    router.replace(pathOf(shipId, view), { scroll: false });
  };
  const openMessageAt = (id: MessageId) => {
    show({ tab, messageId: id });
  };

  const isNotFound = trpcErrorCode(ship.error) === 'NOT_FOUND';
  // A ship in a squadron sits below it: Squadrons, then its squadron.
  const inSquadron = shipsInSquadrons(squadrons.data ?? []).get(shipId);

  return (
    <DetailPage
      onCompose={frame.onCompose}
      onSearch={frame.onSearch}
      banner={frame.banner}
      title={ship.data?.name ?? 'Ship'}
      parents={
        inSquadron
          ? [
              { href: '/squadrons', label: 'Squadrons' },
              { href: `/squadrons/${inSquadron.squadronId}`, label: inSquadron.squadronId },
            ]
          : [{ href: '/', label: 'Fleet overview' }]
      }
      live={liveFleet.live}
      header={
        <>
        <ShipHeader
          ship={ship.data}
          shipId={shipId}
          state={isNotFound ? 'not-found' : ship.data ? 'ready' : 'loading'}
          now={now}
          actions={ship.data ? <ShipActions ship={ship.data} compose={ComposeMessage} crewLineFlow={NewCrewLineFlow} /> : undefined}
          crewRequest={ship.data ? <ShipCrewRequest ship={ship.data} timeline={timeline.data ?? []} now={now} /> : undefined}
          labels={ship.data ? <ShipPageLabels ship={ship.data} /> : undefined}
          isPluginShip={pluginShipIds.has(shipId)}
        />
        {isNotFound ? null : <ShipSquadron shipId={shipId} now={now} />}
        </>
      }
      sheet={
        <MessageSheet
          message={message.data}
          messageId={messageId}
          state={trpcErrorCode(message.error) === 'NOT_FOUND' ? 'not-found' : message.data ? 'ready' : 'loading'}
          isOpen={messageId !== undefined}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              show({ tab });
            }
          }}
          onReply={
            access.canSend
              ? (replied) => {
                  setReplyTo({ messageId: replied.id, sender: replied.sender });
                }
              : undefined
          }
        />
      }
    >
      <>
      {isNotFound ? null : (
        <Tabs
          value={tab}
          onValueChange={(value) => {
            show({ tab: value === SHIP_TABS.messages ? SHIP_TABS.messages : SHIP_TABS.timeline, messageId });
          }}
        >
          <TabsList variant="line" aria-label={`${ship.data?.name ?? 'Ship'} history`}>
            <TabsTrigger variant="line" value={SHIP_TABS.timeline}>
              Timeline
            </TabsTrigger>
            <TabsTrigger variant="line" value={SHIP_TABS.messages}>
              Messages
            </TabsTrigger>
          </TabsList>
          <TabsContent value={SHIP_TABS.timeline} className="pt-4">
            <ShipTimeline
              shipId={shipId}
              entries={timeline.data ?? []}
              state={timeline.isError ? 'error' : timeline.data ? 'ready' : 'loading'}
              onRetry={() => {
                void timeline.refetch();
              }}
              now={now}
              onOpenMessage={openMessageAt}
            />
          </TabsContent>
          <TabsContent value={SHIP_TABS.messages} className="pt-4">
            <MessageThreads
              shipId={shipId}
              messages={messages.data ?? []}
              state={messages.isError ? 'error' : messages.data ? 'ready' : 'loading'}
              onRetry={() => {
                void messages.refetch();
              }}
              now={now}
              onOpenMessage={openMessageAt}
            />
          </TabsContent>
        </Tabs>
      )}
      <ComposeMessage
        isOpen={replyTo !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setReplyTo(undefined);
          }
        }}
        replyTo={replyTo}
      />
      </>
    </DetailPage>
  );
}
