'use client';

import { use, useState } from 'react';

import { ComposeMessage } from '../../../components/organisms/compose-message';
import { ConsoleCommands } from '../../../components/organisms/console-commands';
import { Button } from '../../../components/atoms/button';
import { KeptMessages } from '../../../components/organisms/kept-messages';
import { StandDownDialog } from '../../../components/organisms/stand-down-dialog';
import { MemberList } from '../../../components/organisms/member-list';
import { SquadronHeader } from '../../../components/organisms/squadron-header';
import { DetailLayout } from '../../../components/templates/detail-layout';
import { LoadingSkeleton } from '../../../components/molecules/loading-skeleton';
import { useAccountMenu } from '../../../lib/account';
import { useOpenInboxCount } from '../../../lib/inbox';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useAttentionCount, useNeedsAttention } from '../../../lib/needs-attention';
import { useNow } from '../../../lib/now';
import { useSignInWhenSessionEnds } from '../../../lib/session';
import { useShips } from '../../../lib/ship';
import { useHasSquadrons } from '../../../lib/squadrons';
import { useCatalogue, useIssuedCrewLines, useKeptMessages, useSquadrons, useStandDown } from '../../../lib/squadrons-api';

/**
 * A squadron's page: its header, its members by role, each on station or
 * not, and the messages its flagship kept because it does not handle them. Right after forming, members not on station show their crew line and
 * launch note once. It asks again every few seconds, so members show on
 * station as they check in.
 */
export default function SquadronPage({ params }: { params: Promise<{ squadronId: string }> }) {
  const { squadronId } = use(params);
  const now = useNow();
  const accountMenu = useAccountMenu(now);
  const hasSquadrons = useHasSquadrons();
  const inboxCount = useOpenInboxCount();
  const attention = useNeedsAttention();
  const attentionCount = useAttentionCount();
  const liveFleet = useLiveFleet();
  const squadrons = useSquadrons();
  const catalogue = useCatalogue();
  const crewLines = useIssuedCrewLines(squadronId);
  const kept = useKeptMessages(squadronId);
  const standDown = useStandDown();
  const [isStandingDown, setIsStandingDown] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);
  const squadron = squadrons.data?.find((each) => each.id === squadronId);
  const ships = useShips(squadron?.members.map((member) => member.shipId) ?? []);
  const blueprint = catalogue.data?.blueprints.find(
    (each) => each.repository === squadron?.blueprint.repository && each.name === squadron.blueprint.name && each.version === squadron.blueprint.version,
  );

  return (
    <DetailLayout
      title={squadronId}
      parent={{ href: '/squadrons', label: 'Squadrons' }}
      header={<SquadronHeader squadron={squadron} squadronId={squadronId} state={squadrons.data ? (squadron ? 'ready' : 'not-found') : 'loading'}
          actions={
            squadron?.state === 'sailing' ? (
              <Button
                variant="destructive"
                data-testid="squadron-stand-down"
                onClick={() => {
                  standDown.reset();
                  setIsStandingDown(true);
                }}
              >
                Stand down
              </Button>
            ) : undefined
          }
        />}
      live={liveFleet.live}
      nav={{
        active: 'squadrons',
        inboxCount,
        attentionCount,
        hasSquadrons,
      }}
      onCompose={() => {
        setIsComposing(true);
      }}
      onSearch={() => {
        setIsSearching(true);
      }}
      account={accountMenu}
    >
      {squadron ? (
        <MemberList squadron={squadron} blueprint={blueprint} templates={catalogue.data?.templates ?? []} crewLines={crewLines} ships={ships} now={now} />
      ) : squadrons.data ? null : (
        <LoadingSkeleton variant="list" label="Loading the members" />
      )}
      {squadron && (
        <KeptMessages
          messages={kept.data ?? []}
          state={kept.isError ? 'error' : kept.data ? 'ready' : 'loading'}
          error={kept.error?.message}
          onRetry={() => {
            void kept.refetch();
          }}
          flagshipId={squadron.flagship.shipId}
          now={now}
        />
      )}
      {squadron && (
        <StandDownDialog
          squadronId={squadron.id}
          memberCount={squadron.members.length}
          openDeliveries={[...ships.values()].reduce((total, ship) => total + ship.openDeliveries, 0)}
          isOpen={isStandingDown}
          onOpenChange={setIsStandingDown}
          isPending={standDown.isPending}
          error={standDown.error?.message}
          onConfirm={() => {
            standDown.mutate(squadron.id, {
              onSuccess: () => {
                setIsStandingDown(false);
              },
            });
          }}
        />
      )}
      <ComposeMessage isOpen={isComposing} onOpenChange={setIsComposing} />
      <ConsoleCommands
        isOpen={isSearching}
        onOpenChange={setIsSearching}
        onCompose={() => {
          setIsComposing(true);
        }}
      />
    </DetailLayout>
  );
}
