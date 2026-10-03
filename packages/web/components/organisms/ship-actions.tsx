'use client';

import type { ListedShip } from '@aeolus-fleet/common';
import Link from 'next/link';
import { useState } from 'react';

import {
  useFleetSnapshot,
  useGetStartingPrompt,
  usePingShip,
  useRecrewShip,
  useReleaseShip,
  useRenameShip,
  useRetireShip,
} from '../../lib/fleet';
import { canPing } from '../../lib/ping';
import { useShip } from '../../lib/ship';
import { useSquadronsSettings } from '../../lib/squadrons';
import { useRemoveMember, useSquadrons } from '../../lib/squadrons-api';
import { otherMembersOfRole } from '../../lib/squadrons-view';
import { isUnclaimedPromptOut } from '../../lib/starting-prompt';
import { Button } from '../atoms/button';
import { showToast } from '../atoms/toast';
import { ReleaseDialog } from './release-dialog';
import { GetNewCrewLine } from './get-new-crew-line';
import { RemoveMemberDialog } from './remove-member-dialog';
import { RenameDialog } from './rename-dialog';
import { RetireDialog } from './retire-dialog';
import { StartingPromptDialog, type StartingPromptDialogState } from './starting-prompt-dialog';

type OpenDialog = 'release' | 'recrew' | 'retire' | 'rename' | 'prompt' | 'remove' | undefined;

/** Where a crewed ship's session runs, as the release dialog names it. */
function sessionLocationOf(ship: ListedShip): string | null {
  if (ship.location === null) {
    return null;
  }
  return ship.location.description ?? ship.location.kind.toLowerCase();
}

/**
 * A ship's actions, in a fleet row or on its page, each behind its designed
 * dialog (docs/design/conventions.md, "Confirm"). A ship awaiting crew offers
 * Get starting prompt, Rename and Retire, with Ping disabled; a crewed ship
 * Ping, Re-crew, Release, Rename and Retire; argo and retired ships none.
 * Ping needs no confirm: it only asks the session to answer with pong, and
 * while a ping waits it shows that one instead of sending another. A dialog reads the ship's counts first and
 * opens once it has them, so its numbers are exact and a retire never skips
 * the typed confirm because the open deliveries were not known yet. A new or re-crewed prompt shows once, in the
 * StartingPromptDialog.
 *
 * With squadrons (docs/design/conventions.md, "Squadrons"): a flagship offers
 * only Open squadron, since retiring, releasing or renaming it would break its
 * squadron; a member offers Ping, Get new crew line (primary when silent),
 * Release and Remove from squadron, never
 * Rename, Retire, Re-crew or Get starting prompt. Until it is known whether
 * squadrons is set up and, if so, its list, only Ping shows, so a member is
 * never offered Retire.
 */
export function ShipActions({ ship }: { ship: ListedShip }) {
  const [dialog, setDialog] = useState<OpenDialog>();
  const getStartingPrompt = useGetStartingPrompt();
  const releaseShip = useReleaseShip();
  const retireShip = useRetireShip();
  const recrewShip = useRecrewShip();
  const renameShip = useRenameShip();
  const pingShip = usePingShip();
  const fleet = useFleetSnapshot();
  const counted = useShip(dialog === 'release' || dialog === 'recrew' || dialog === 'retire' || dialog === 'remove' ? ship.id : undefined);
  const settings = useSquadronsSettings();
  const hasSquadrons = settings.data?.configured === true;
  const squadrons = useSquadrons({ isEnabled: hasSquadrons });
  const removeMember = useRemoveMember();
  const squadron = squadrons.data?.find(
    (each) => each.state !== 'disbanded' && (each.flagship.shipId === ship.id || each.members.some((member) => member.shipId === ship.id)),
  );
  const isMember = squadron !== undefined && squadron.flagship.shipId !== ship.id;
  // A member's new crew line asks first when it ends a session: that needs its in-flight count.
  const memberDetail = useShip(isMember && ship.status !== 'retired' ? ship.id : undefined);

  if (ship.kind === 'operator' || ship.status === 'retired') {
    return null;
  }
  if (squadron?.flagship.shipId === ship.id) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2 max-sm:justify-start">
        <Button size="xs" nativeButton={false} data-testid="fleet-ship-open-squadron" render={<Link href={`/squadrons/${squadron.id}`} />}>
          Open squadron
        </Button>
      </div>
    );
  }
  const member = squadron?.members.find((each) => each.shipId === ship.id);
  const isMembershipPending = (settings.data === undefined && !settings.isError) || (hasSquadrons && squadrons.data === undefined && !squadrons.isError);

  const close = () => {
    setDialog(undefined);
  };
  const issued = getStartingPrompt.data ?? recrewShip.data;
  const promptState: StartingPromptDialogState = issued
    ? 'shown'
    : getStartingPrompt.isPending || recrewShip.isPending
      ? 'issuing'
      : getStartingPrompt.isError
        ? 'error'
        : 'confirm';

  const issuePrompt = () => {
    recrewShip.reset();
    getStartingPrompt.mutate({ shipId: ship.id });
  };
  const requestPrompt = () => {
    getStartingPrompt.reset();
    recrewShip.reset();
    setDialog('prompt');
    if (!isUnclaimedPromptOut(ship)) {
      getStartingPrompt.mutate({ shipId: ship.id });
    }
  };
  const open = (next: Exclude<OpenDialog, 'prompt' | undefined>) => () => {
    releaseShip.reset();
    retireShip.reset();
    recrewShip.reset();
    renameShip.reset();
    removeMember.reset();
    setDialog(next);
  };

  const ping = () => {
    pingShip.mutate(
      { shipId: ship.id },
      {
        onSuccess: ({ isNew }) => {
          showToast(
            isNew
              ? { title: `Pinged ${ship.name}`, description: 'Its session answers with pong on its next turn.', tone: 'success' }
              : { title: `A ping already waits for ${ship.name}`, description: 'Pings never stack: this is the one shown.', tone: 'info' },
          );
        },
        onError: (error) => {
          showToast({ title: `Couldn't ping ${ship.name}`, description: error.message, tone: 'error' });
        },
      },
    );
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 max-sm:justify-start">
      <Button size="xs" data-testid="fleet-ship-ping" disabled={!canPing(ship)} isLoading={pingShip.isPending} onClick={ping}>
        Ping
      </Button>
      {isMembershipPending ? null : member ? (
        <>
          {squadron && <GetNewCrewLine squadronId={squadron.id} member={member} ship={memberDetail.data} isPrimary={member.health === 'silent'} testId="fleet-ship-new-crew-line" />}
          {ship.status === 'crewed' && (
            <Button size="xs" data-testid="fleet-ship-release" onClick={open('release')}>
              Release
            </Button>
          )}
          {(squadron?.state === 'sailing' || squadron?.state === 'standing-down') && (
            <Button size="xs" variant="ghost" data-testid="fleet-ship-remove" onClick={open('remove')}>
              Remove from squadron
            </Button>
          )}
        </>
      ) : (
        <>
          {ship.status === 'awaitingCrew' ? (
            <Button size="xs" data-testid="fleet-ship-prompt" onClick={requestPrompt}>
              Get starting prompt
            </Button>
          ) : (
            <>
              <Button size="xs" data-testid="fleet-ship-recrew" onClick={open('recrew')}>
                Re-crew
              </Button>
              <Button size="xs" data-testid="fleet-ship-release" onClick={open('release')}>
                Release
              </Button>
            </>
          )}
          <Button size="xs" variant="ghost" data-testid="fleet-ship-rename" onClick={open('rename')}>
            Rename
          </Button>
          <Button size="xs" variant="ghost" data-testid="fleet-ship-retire" onClick={open('retire')}>
            Retire
          </Button>
        </>
      )}

      <ReleaseDialog
        shipName={ship.name}
        sessionLocation={sessionLocationOf(ship)}
        inFlightCount={counted.data?.inFlightDeliveries ?? 0}
        mode={dialog === 'recrew' ? 'recrew' : 'release'}
        isOpen={(dialog === 'release' || dialog === 'recrew') && counted.data !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            close();
          }
        }}
        isPending={releaseShip.isPending || recrewShip.isPending}
        error={(dialog === 'recrew' ? recrewShip.error : releaseShip.error)?.message}
        onConfirm={() => {
          if (dialog === 'recrew') {
            recrewShip.mutate({ shipId: ship.id }, { onSuccess: () => { setDialog('prompt'); } });
          } else {
            releaseShip.mutate({ shipId: ship.id }, { onSuccess: close });
          }
        }}
      />
      <RetireDialog
        shipName={ship.name}
        openDeliveries={counted.data?.openDeliveries ?? 0}
        isCrewed={ship.status === 'crewed'}
        isOpen={dialog === 'retire' && counted.data !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            close();
          }
        }}
        isPending={retireShip.isPending}
        error={retireShip.error?.message}
        onConfirm={() => {
          retireShip.mutate({ shipId: ship.id }, { onSuccess: close });
        }}
      />
      {squadron && member && (
        <RemoveMemberDialog
          squadronId={squadron.id}
          member={member}
          othersOfRole={otherMembersOfRole(squadron, member.shipId)}
          openDeliveries={counted.data?.openDeliveries ?? 0}
          inFlightDeliveries={counted.data?.inFlightDeliveries ?? 0}
          isOpen={dialog === 'remove' && counted.data !== undefined}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              close();
            }
          }}
          isPending={removeMember.isPending}
          error={removeMember.error?.message}
          onConfirm={() => {
            removeMember.mutate({ squadronId: squadron.id, shipId: member.shipId }, { onSuccess: close });
          }}
        />
      )}
      <RenameDialog
        shipName={ship.name}
        activeNames={(fleet.data ?? []).filter((each) => each.status !== 'retired').map((each) => each.name)}
        isOpen={dialog === 'rename'}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            close();
          }
        }}
        isPending={renameShip.isPending}
        error={renameShip.error?.message}
        onSubmit={(name) => {
          renameShip.mutate({ shipId: ship.id, name }, { onSuccess: close });
        }}
      />
      <StartingPromptDialog
        shipName={ship.name}
        state={promptState}
        prompt={issued?.prompt}
        crewLine={issued?.crewLine}
        replacesUnclaimed={
          isUnclaimedPromptOut(ship) && ship.startingPrompt ? { issuedAt: ship.startingPrompt.issuedAt } : undefined
        }
        error={getStartingPrompt.error?.message}
        isOpen={dialog === 'prompt'}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            getStartingPrompt.reset();
            recrewShip.reset();
            close();
          }
        }}
        onConfirm={issuePrompt}
      />
    </div>
  );
}
