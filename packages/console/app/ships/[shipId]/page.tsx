'use client';

import { idSchema, type MessageId, type Party, type ShipId } from '@aeolus-fleet/common';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/atoms/tabs';
import { ComposeMessage } from '../../../components/organisms/compose-message';
import { ConsoleCommands } from '../../../components/organisms/console-commands';
import { ConsoleGuide } from '../../../components/organisms/console-guide';
import { ConsoleNotices } from '../../../components/organisms/console-notices';
import { MessageSheet } from '../../../components/organisms/message-sheet';
import { MessageThreads } from '../../../components/organisms/message-threads';
import { ShipCrewRequest } from '../../../components/organisms/ship-crew-request';
import { ShipSquadron } from '../../../components/organisms/ship-squadron';
import { ShipActions } from '../../../components/organisms/ship-actions';
import { ShipHeader } from '../../../components/organisms/ship-header';
import { ShipTimeline } from '../../../components/organisms/ship-timeline';
import { DetailLayout } from '../../../components/templates/detail-layout';
import { useAccess } from '../../../lib/access';
import { trpcErrorCode } from '../../../lib/errors';
import { useOpenInboxCount } from '../../../lib/inbox';
import { useLabelContext } from '../../../lib/fleet';
import { chipsOf } from '../../../lib/labels';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useAttentionCount } from '../../../lib/needs-attention';
import { useNow } from '../../../lib/now';
import { useAccountMenu } from '../../../lib/account';
import { useSignInWhenSessionEnds } from '../../../lib/session';
import { useMessage, useShip, useShipMessages, useShipTimeline } from '../../../lib/ship';
import { useSquadrons } from '../../../lib/squadrons-api';
import { shipsInSquadrons } from '../../../lib/squadrons-view';
import { usePluginNav } from '../../../lib/plugin-nav';

type SearchParams = Record<string, string | string[] | undefined>;

/** The two tabs of the ship page; Timeline unless the URL says Messages. */
const TABS = { timeline: 'timeline', messages: 'messages' } as const;
type Tab = (typeof TABS)[keyof typeof TABS];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The ship page's view in the URL: its tab and the open message. */
function pathOf(shipId: ShipId, view: { tab: Tab; messageId?: MessageId }): string {
  const params = new URLSearchParams();
  if (view.tab !== TABS.timeline) {
    params.set('tab', view.tab);
  }
  if (view.messageId !== undefined) {
    params.set('message', view.messageId);
  }
  const query = params.toString();
  return query === '' ? `/ships/${shipId}` : `/ships/${shipId}?${query}`;
}

/** A ship's page, read only once its id is a ship id; anything else reads as not found. */
function ShipPageFor({ shipId, searchParams }: { shipId: ShipId; searchParams: SearchParams }) {
  const router = useRouter();
  const now = useNow();
  const tab: Tab = first(searchParams.tab) === TABS.messages ? TABS.messages : TABS.timeline;
  const openMessage = idSchema('message').safeParse(first(searchParams.message));
  const messageId = openMessage.success ? openMessage.data : undefined;

  const ship = useShip(shipId);
  const timeline = useShipTimeline(shipId);
  const messages = useShipMessages(shipId);
  const message = useMessage(messageId);
  const liveFleet = useLiveFleet();
  const accountMenu = useAccountMenu(now);
  const squadrons = useSquadrons();
  const inboxCount = useOpenInboxCount();
  const access = useAccess();
  const labels = useLabelContext();
  const pluginNav = usePluginNav();
  const [isComposing, setIsComposing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [replyTo, setReplyTo] = useState<{ messageId: MessageId; sender: Party }>();
  const attentionCount = useAttentionCount();
  useSignInWhenSessionEnds([ship.error, timeline.error, messages.error, message.error, liveFleet.error]);

  const show = (view: { tab: Tab; messageId?: MessageId }) => {
    router.replace(pathOf(shipId, view), { scroll: false });
  };
  const openMessageAt = (id: MessageId) => {
    show({ tab, messageId: id });
  };

  const isNotFound = trpcErrorCode(ship.error) === 'NOT_FOUND';
  // A ship in a squadron sits below it: Squadrons, then its squadron.
  const inSquadron = shipsInSquadrons(squadrons.data ?? []).get(shipId);

  return (
    <DetailLayout
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
      nav={{ active: 'overview', inboxCount, attentionCount, ...pluginNav }}
      onCompose={
        access.canSend
          ? () => {
              setIsComposing(true);
            }
          : undefined
      }
      onSearch={() => {
        setIsSearching(true);
      }}
      account={accountMenu}
      banner={
        <>
          <ConsoleNotices />
          <ConsoleGuide />
        </>
      }
      header={
        <>
        <ShipHeader
          ship={ship.data}
          shipId={shipId}
          state={isNotFound ? 'not-found' : ship.data ? 'ready' : 'loading'}
          now={now}
          actions={ship.data ? <ShipActions ship={ship.data} /> : undefined}
          crewRequest={ship.data ? <ShipCrewRequest ship={ship.data} timeline={timeline.data ?? []} now={now} /> : undefined}
          labels={ship.data && labels ? chipsOf(ship.data, labels) : undefined}
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
            show({ tab: value === TABS.messages ? TABS.messages : TABS.timeline, messageId });
          }}
        >
          <TabsList variant="line" aria-label={`${ship.data?.name ?? 'Ship'} history`}>
            <TabsTrigger variant="line" value={TABS.timeline}>
              Timeline
            </TabsTrigger>
            <TabsTrigger variant="line" value={TABS.messages}>
              Messages
            </TabsTrigger>
          </TabsList>
          <TabsContent value={TABS.timeline} className="pt-4">
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
          <TabsContent value={TABS.messages} className="pt-4">
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
      <ComposeMessage isOpen={isComposing} onOpenChange={setIsComposing} />
      <ComposeMessage
        isOpen={replyTo !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setReplyTo(undefined);
          }
        }}
        replyTo={replyTo}
      />
      <ConsoleCommands
        isOpen={isSearching}
        onOpenChange={setIsSearching}
        onCompose={() => {
          setIsComposing(true);
        }}
      />
      </>
    </DetailLayout>
  );
}

/**
 * A ship's page, live: its header, its timeline from the event log and its
 * messages grouped into threads, each opening in the MessageSheet with its
 * delivery history. The tab and the open message live in the URL.
 */
export default function ShipPage({
  params,
  searchParams,
}: {
  params: Promise<{ shipId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const parsed = idSchema('ship').safeParse(use(params).shipId);
  const query = use(searchParams);
  // A malformed id names no ship; any well-formed one is looked up, so the
  // header says Ship not found either way.
  const shipId = parsed.success ? parsed.data : idSchema('ship').parse(`shp_${'0'.repeat(26)}`);
  return <ShipPageFor shipId={shipId} searchParams={query} />;
}
