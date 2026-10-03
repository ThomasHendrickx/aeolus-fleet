'use client';

import { use, useState } from 'react';

import { ComposeMessage } from '../../../components/organisms/compose-message';
import { ConsoleCommands } from '../../../components/organisms/console-commands';
import { MemberList } from '../../../components/organisms/member-list';
import { SquadronHeader } from '../../../components/organisms/squadron-header';
import { DetailLayout } from '../../../components/templates/detail-layout';
import { LoadingSkeleton } from '../../../components/molecules/loading-skeleton';
import { useAccountMenu } from '../../../lib/account';
import { useOpenInboxCount } from '../../../lib/inbox';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useNeedsAttention } from '../../../lib/needs-attention';
import { useNow } from '../../../lib/now';
import { useSignInWhenSessionEnds } from '../../../lib/session';
import { useShips } from '../../../lib/ship';
import { useHasSquadrons } from '../../../lib/squadrons';
import { useCatalogue, useIssuedCrewLines, useSquadrons } from '../../../lib/squadrons-api';

/**
 * A squadron's page: its header and its members by role, each on station or
 * not. Right after forming, members not on station show their crew line and
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
  const liveFleet = useLiveFleet();
  const squadrons = useSquadrons();
  const catalogue = useCatalogue();
  const crewLines = useIssuedCrewLines(squadronId);
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
      header={<SquadronHeader squadron={squadron} squadronId={squadronId} state={squadrons.data ? (squadron ? 'ready' : 'not-found') : 'loading'} />}
      live={liveFleet.live}
      nav={{
        active: 'squadrons',
        inboxCount,
        attentionCount: attention.data?.length,
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
