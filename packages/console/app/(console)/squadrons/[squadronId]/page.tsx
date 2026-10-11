'use client';

import { useRouter } from 'next/navigation';
import { use, useState } from 'react';

import { ComposeMessage } from '../../../../features/compose/organisms/compose-message';
import { HandoffWiring } from '../../../../features/squadrons/organisms/handoff-wiring';
import { KeptMessages } from '../../../../features/squadrons/organisms/kept-messages';
import { MemberActions } from '../../../../features/squadrons/organisms/member-actions';
import { SquadronActions } from '../../../../features/squadrons/organisms/squadron-actions';
import { MemberList } from '../../../../features/squadrons/organisms/member-list';
import { SquadronHeader } from '../../../../features/squadrons/organisms/squadron-header';
import { DetailPage } from '../../../../components/organisms/detail-page';
import { useConsoleFrame } from '../../../../lib/console-frame';
import { SquadronSummary } from '../../../../features/squadrons/molecules/squadron-summary';
import { SquadronsNotConnected } from '../../../../features/squadrons/molecules/squadrons-not-connected';
import { LoadingSkeleton } from '../../../../components/molecules/loading-skeleton';
import { lazyDialog } from '../../../../lib/lazy-dialog';
import { useAccess } from '../../../../lib/access';
import { useLiveFleet } from '../../../../lib/live-fleet';
import { useNeedsAttention } from '../../../../lib/needs-attention';
import { useNow } from '../../../../lib/now';
import { useSignInWhenSessionEnds } from '../../../../lib/session';
import { useShips } from '../../../../lib/ship';
import { useSquadronsConnection } from '../../../../lib/squadrons';
import {
  useAddMember,
  useCatalogue,
  useIssuedCrewLines,
  useForceStandDown,
  useKeptMessages,
  useRemoveMember,
  useSquadrons,
  useStandDown,
} from '../../../../lib/squadrons-api';
import type { AddedMember, Squadron } from '../../../../lib/squadrons-schemas';
import { healthCounts, otherMembersOfRole, roleOptions, squadronActionsOffered, workCounts } from '../../../../lib/squadrons-view';

// Dialogs load when first opened, not with the page.
const AddMemberDialog = lazyDialog(() => import('../../../../features/squadrons/organisms/add-member-dialog').then((module) => module.AddMemberDialog), (props) => props.isOpen);
const CrewLineDialog = lazyDialog(() => import('../../../../components/organisms/crew-line-dialog').then((module) => module.CrewLineDialog), (props) => props.isOpen);
const RemoveMemberDialog = lazyDialog(() => import('../../../../components/organisms/remove-member-dialog').then((module) => module.RemoveMemberDialog), (props) => props.isOpen);
const StandDownDialog = lazyDialog(() => import('../../../../features/squadrons/organisms/stand-down-dialog').then((module) => module.StandDownDialog), (props) => props.isOpen);

/**
 * A squadron's page: its header, its members by role, each on station or
 * not, and the messages its flagship kept because it does not handle them. Right after forming, members not on station show their crew lines and
 * launch note once. It asks again every few seconds, so members show on
 * station as they check in.
 */
export default function SquadronPage({
  params,
  searchParams,
}: {
  params: Promise<{ squadronId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { squadronId } = use(params);
  // The command palette's Add member and Stand down land here with their dialog asked for.
  const asked = use(searchParams).action;
  const router = useRouter();
  const now = useNow();
  const frame = useConsoleFrame();
  const attention = useNeedsAttention();
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
  const [isMessagingFlagship, setIsMessagingFlagship] = useState(false);
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
  // squadrons' answer was parsed on the web app's server, the flagship's ship id with it.
  const flagshipId = squadron?.flagship.shipId;
  const offered = squadron
    ? squadronActionsOffered(squadron, { canManage: access.canManage, canSend: access.canSend, hasRoles: roles.length > 0 })
    : undefined;
  const isAddAsked = asked === 'add-member' && offered?.canAddMember === true;
  const isStandDownAsked = asked === 'stand-down' && offered?.canStandDown === true;
  /** Closes a dialog the palette asked for: the page's URL drops the ask, so it opens no more. */
  const settleAsk = () => {
    if (asked !== undefined) {
      router.replace(`/squadrons/${squadronId}`, { scroll: false });
    }
  };
  const isLosingMembersAllowed = squadron?.state === 'sailing' || squadron?.state === 'standing-down';

  return (
    <DetailPage
      onCompose={frame.onCompose}
      onSearch={frame.onSearch}
      banner={frame.banner}
      title={squadronId}
      parents={[{ href: '/squadrons', label: 'Squadrons' }]}
      header={<SquadronHeader squadron={squadron} squadronId={squadronId} state={squadrons.data ? (squadron ? 'ready' : 'not-found') : 'loading'}
          actions={
            squadron && offered ? (
              <SquadronActions
                squadronId={squadron.id}
                offered={offered}
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
          onForceStandDown={
            access.canManage
              ? () => {
                  forceStandDown.reset();
                  setIsForcing(true);
                }
              : undefined
          }
        />}
      live={liveFleet.live}
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
              compose={ComposeMessage}
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
          isOpen={isStandingDown || isStandDownAsked}
          onOpenChange={(isNowOpen) => {
            setIsStandingDown(isNowOpen);
            if (!isNowOpen) {
              settleAsk();
            }
          }}
          isPending={standDown.isPending}
          error={standDown.error?.message}
          onConfirm={() => {
            standDown.mutate(squadron.id, {
              onSuccess: () => {
                setIsStandingDown(false);
                settleAsk();
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
          isOpen={isAdding || isAddAsked}
          onOpenChange={(isNowOpen) => {
            setIsAdding(isNowOpen);
            if (!isNowOpen) {
              settleAsk();
            }
          }}
          isPending={addMember.isPending}
          error={addMember.error?.message}
          onSubmit={(role) => {
            addMember.mutate(
              { squadronId: squadron.id, role },
              {
                onSuccess: (member) => {
                  setIsAdding(false);
                  settleAsk();
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
          model={added.model}
          crewLines={added.crewLines}
          isOpen
          onOpenChange={(isNowOpen) => {
            if (!isNowOpen) {
              setAdded(undefined);
            }
          }}
        />
      )}
      {flagshipId && <ComposeMessage isOpen={isMessagingFlagship} onOpenChange={setIsMessagingFlagship} toShipId={flagshipId} />}
    </DetailPage>
  );
}
