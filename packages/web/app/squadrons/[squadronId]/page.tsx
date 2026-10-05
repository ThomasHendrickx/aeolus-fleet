'use client';

import { idSchema } from '@aeolus-fleet/common';
import { use, useState } from 'react';

import { ComposeMessage } from '../../../components/organisms/compose-message';
import { ConsoleCommands } from '../../../components/organisms/console-commands';
import { ConsoleNotices } from '../../../components/organisms/console-notices';
import { HandoffWiring } from '../../../components/organisms/handoff-wiring';
import { KeptMessages } from '../../../components/organisms/kept-messages';
import { StandDownDialog } from '../../../components/organisms/stand-down-dialog';
import { AddMemberDialog } from '../../../components/organisms/add-member-dialog';
import { CrewLineDialog } from '../../../components/organisms/crew-line-dialog';
import { MemberActions } from '../../../components/organisms/member-actions';
import { SquadronActions } from '../../../components/organisms/squadron-actions';
import { RemoveMemberDialog } from '../../../components/organisms/remove-member-dialog';
import { MemberList } from '../../../components/organisms/member-list';
import { SquadronHeader } from '../../../components/organisms/squadron-header';
import { DetailLayout } from '../../../components/templates/detail-layout';
import { SquadronSummary } from '../../../components/molecules/squadron-summary';
import { SquadronsNotConnected } from '../../../components/molecules/squadrons-not-connected';
import { LoadingSkeleton } from '../../../components/molecules/loading-skeleton';
import { useAccess } from '../../../lib/access';
import { useAccountMenu } from '../../../lib/account';
import { useOpenInboxCount } from '../../../lib/inbox';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useAttentionCount, useNeedsAttention } from '../../../lib/needs-attention';
import { useNow } from '../../../lib/now';
import { useSignInWhenSessionEnds } from '../../../lib/session';
import { useShips } from '../../../lib/ship';
import { useHasSquadrons, useSquadronsConnection } from '../../../lib/squadrons';
import {
  type AddedMember,
  useAddMember,
  useCatalogue,
  useIssuedCrewLines,
  useForceStandDown,
  useKeptMessages,
  useRemoveMember,
  type Squadron,
  useSquadrons,
  useStandDown,
} from '../../../lib/squadrons-api';
import { healthCounts, otherMembersOfRole, roleOptions, squadronActionsOffered, workCounts } from '../../../lib/squadrons-view';

/**
 * A squadron's page: its header, its members by role, each on station or
 * not, and the messages its flagship kept because it does not handle them. Right after forming, members not on station show their crew lines and
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
  const connection = useSquadronsConnection();
  const catalogue = useCatalogue();
  const crewLines = useIssuedCrewLines(squadronId);
  const kept = useKeptMessages(squadronId);
  const standDown = useStandDown();
  const [isStandingDown, setIsStandingDown] = useState(false);
  const forceStandDown = useForceStandDown();
  const [isForcing, setIsForcing] = useState(false);
  const addMember = useAddMember();
  const [isAdding, setIsAdding] = useState(false);
  const [added, setAdded] = useState<AddedMember | undefined>(undefined);
  const removeMember = useRemoveMember();
  const [removing, setRemoving] = useState<Squadron['members'][number] | undefined>(undefined);
  const access = useAccess();
  const [isComposing, setIsComposing] = useState(false);
  const [isMessagingFlagship, setIsMessagingFlagship] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);
  const squadron = squadrons.data?.find((each) => each.id === squadronId);
  const ships = useShips(squadron?.members.map((member) => member.shipId) ?? []);
  const openDeliveries = [...ships.values()].reduce((total, ship) => total + ship.openDeliveries, 0);
  const inFlightDeliveries = [...ships.values()].reduce((total, ship) => total + ship.inFlightDeliveries, 0);
  const blueprint = catalogue.data?.blueprints.find(
    (each) => each.repository === squadron?.blueprint.repository && each.name === squadron.blueprint.name && each.version === squadron.blueprint.version,
  );
  const roles = squadron && blueprint ? roleOptions(squadron, { blueprint, templates: catalogue.data?.templates ?? [] }) : [];
  const removingShip = removing ? ships.get(removing.shipId) : undefined;
  const removingRole = removing ? roles.find((each) => each.role === removing.role) : undefined;
  // The squadron manager's answer names the flagship by a plain string: parsed, as outside data is.
  const flagshipId = squadron ? idSchema('ship').safeParse(squadron.flagship.shipId).data : undefined;
  const isLosingMembersAllowed = squadron?.state === 'sailing' || squadron?.state === 'standing-down';

  return (
    <DetailLayout
      title={squadronId}
      parent={{ href: '/squadrons', label: 'Squadrons' }}
      header={<SquadronHeader squadron={squadron} squadronId={squadronId} state={squadrons.data ? (squadron ? 'ready' : 'not-found') : 'loading'}
          actions={
            squadron ? (
              <SquadronActions
                squadronId={squadron.id}
                offered={squadronActionsOffered(squadron, { canManage: access.canManage, canSend: access.canSend, hasRoles: roles.length > 0 })}
                onAddMember={() => {
                  addMember.reset();
                  setIsAdding(true);
                }}
                onMessageFlagship={() => {
                  setIsMessagingFlagship(true);
                }}
                onStandDown={() => {
                  standDown.reset();
                  setIsStandingDown(true);
                }}
                onForceStandDown={() => {
                  forceStandDown.reset();
                  setIsForcing(true);
                }}
              />
            ) : undefined
          }
        />}
      live={liveFleet.live}
      nav={{
        active: 'squadrons',
        inboxCount,
        attentionCount,
        hasSquadrons,
        hasSettings: hasSquadrons && access.canManage,
      }}
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
      banner={<ConsoleNotices />}
    >
      {connection === 'not-connected' ? (
        <SquadronsNotConnected />
      ) : squadron ? (
        <>
        <SquadronSummary
          health={healthCounts(squadron.members)}
          work={workCounts(squadron.members.map((member) => ships.get(member.shipId)?.report ?? null))}
          openDeliveries={ships.size === squadron.members.length ? openDeliveries : undefined}
          keptCount={kept.data?.length}
        />
        <MemberList squadron={squadron} blueprint={blueprint} templates={catalogue.data?.templates ?? []} crewLines={crewLines}
          ships={ships}
          now={now}
          renderActions={(member) => (
            <MemberActions
              squadronId={squadron.id}
              member={member}
              ship={ships.get(member.shipId)}
              template={roles.find((each) => each.role === member.role)?.template}
              canManage={access.canManage}
              canSend={access.canSend}
              isRemovable={isLosingMembersAllowed}
              onRemove={() => {
                removeMember.reset();
                setRemoving(member);
              }}
            />
          )}
        />
        </>
      ) : squadrons.data ? null : (
        <LoadingSkeleton variant="list" label="Loading the members" />
      )}
      {blueprint && <HandoffWiring blueprint={blueprint} />}
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
          openDeliveries={openDeliveries}
          inFlightDeliveries={inFlightDeliveries}
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
      {squadron && (
        <StandDownDialog
          isForced
          squadronId={squadron.id}
          memberCount={squadron.members.length}
          openDeliveries={openDeliveries}
          inFlightDeliveries={inFlightDeliveries}
          isOpen={isForcing}
          onOpenChange={setIsForcing}
          isPending={forceStandDown.isPending}
          error={forceStandDown.error?.message}
          onConfirm={() => {
            forceStandDown.mutate(squadron.id, {
              onSuccess: () => {
                setIsForcing(false);
              },
            });
          }}
        />
      )}
      {squadron && roles.length > 0 && (
        <AddMemberDialog
          squadronId={squadron.id}
          blueprint={`${squadron.blueprint.name} v${String(squadron.blueprint.version)}`}
          roles={roles}
          isOpen={isAdding}
          onOpenChange={setIsAdding}
          isPending={addMember.isPending}
          error={addMember.error?.message}
          onSubmit={(role) => {
            addMember.mutate(
              { squadronId: squadron.id, role },
              {
                onSuccess: (member) => {
                  setIsAdding(false);
                  setAdded(member);
                },
              },
            );
          }}
        />
      )}
      {squadron && removing && (
        <RemoveMemberDialog
          squadronId={squadron.id}
          member={removing}
          othersOfRole={otherMembersOfRole(squadron, removing.shipId)}
          blueprint={removingRole ? { label: `${squadron.blueprint.name} v${String(squadron.blueprint.version)}`, count: removingRole.inBlueprint } : undefined}
          openDeliveries={removingShip?.openDeliveries ?? 0}
          inFlightDeliveries={removingShip?.inFlightDeliveries ?? 0}
          // Opens once its ship's inbox is known, so a removal never skips the typed confirm.
          isOpen={removingShip !== undefined}
          onOpenChange={(isNowOpen) => {
            if (!isNowOpen) {
              setRemoving(undefined);
            }
          }}
          isPending={removeMember.isPending}
          error={removeMember.error?.message}
          onConfirm={() => {
            removeMember.mutate(
              { squadronId: squadron.id, shipId: removing.shipId },
              {
                onSuccess: () => {
                  setRemoving(undefined);
                },
              },
            );
          }}
        />
      )}
      {added && (
        <CrewLineDialog
          memberName={added.name}
          state="shown"
          template={roles.find((each) => each.role === added.role)?.template}
          launchNote={added.launchNote}
          crewLines={added.crewLines}
          isOpen
          onOpenChange={(isNowOpen) => {
            if (!isNowOpen) {
              setAdded(undefined);
            }
          }}
        />
      )}
      <ComposeMessage isOpen={isComposing} onOpenChange={setIsComposing} />
      {flagshipId && <ComposeMessage isOpen={isMessagingFlagship} onOpenChange={setIsMessagingFlagship} toShipId={flagshipId} />}
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
