'use client';

import type { ListedShip } from '@aeolus-fleet/common';
import { Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

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
import { useSquadronsConnection } from '../../lib/squadrons';
import { useRemoveMember, useSquadrons } from '../../lib/squadrons-api';
import { otherMembersOfRole } from '../../lib/squadrons-view';
import { isUnclaimedPromptOut } from '../../lib/starting-prompt';
import { Button } from '../atoms/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../atoms/dropdown-menu';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../atoms/sheet';
import { showToast } from '../atoms/toast';
import { ComposeMessage } from './compose-message';
import { ReleaseDialog } from './release-dialog';
import { useNewCrewLineFlow } from './get-new-crew-line';
import { RemoveMemberDialog } from './remove-member-dialog';
import { RenameDialog } from './rename-dialog';
import { RetireDialog } from './retire-dialog';
import { StartingPromptDialog, type StartingPromptDialogState } from './starting-prompt-dialog';

type OpenDialog = 'release' | 'recrew' | 'retire' | 'rename' | 'prompt' | 'remove' | undefined;

/**
 * Where a ship's actions show: buttons on its page; the row menu of FleetTable,
 * a DropdownMenu on desktop and a bottom Sheet on phone; or the one next step
 * in a row's Report cell.
 */
export type ShipActionsLayout = 'buttons' | 'menu' | 'sheet' | 'next';

/** One action: its button label, its menu label, and what it does. */
interface ShipAction {
  key: string;
  label: string;
  menuLabel: string;
  testId: string;
  onSelect?: () => void;
  href?: string;
  isDisabled?: boolean;
  isLoading?: boolean;
  isDestructive?: boolean;
  isPrimary?: boolean;
  /** Menus only: Message, Copy ship id and Open inbox are not buttons on the ship page. */
  isMenuOnly?: boolean;
}

/** Where a crewed ship's session runs, as the release dialog names it. */
function sessionLocationOf(ship: ListedShip): string | null {
  if (ship.location === null) {
    return null;
  }
  return ship.location.description ?? ship.location.kind.toLowerCase();
}

/**
 * A ship's actions, each behind its designed dialog (docs/design/conventions.md,
 * "Confirm"), in the layout asked for: buttons on its page; FleetTable's row
 * menu, a DropdownMenu on desktop and a bottom Sheet on phone; or the row's
 * one next step (Get starting prompt for a ship awaiting crew, Get new crew
 * line for a silent member). The menu holds every action
 * (docs/design/png/FleetTable.png): a crewed ship Message this ship, Copy
 * ship id, Ping, Re-crew, Release, Rename and Retire; a ship awaiting crew
 * Message, Copy ship id, Get starting prompt, Rename and Retire; argo Open
 * inbox and Copy ship id; a retired ship Copy ship id. Ping needs no
 * confirm, and while a ping waits it shows that one instead of sending
 * another. A dialog reads the ship's counts first and opens once it has them,
 * so its numbers are exact and a retire never skips the typed confirm. A new
 * or re-crewed prompt shows once, in the StartingPromptDialog.
 *
 * With squadrons (docs/design/conventions.md, "Squadrons"): a flagship offers
 * only Open squadron, since retiring, releasing or renaming it would break its
 * squadron; a member offers Message, Copy ship id, Ping, Get new crew line,
 * Release and Remove from squadron, never Rename, Retire, Re-crew or Get
 * starting prompt. Not configured or not connected, squadrons adds nothing.
 * While a configured squadrons' connection is not yet known, and when
 * connected until its list first answers, only Message, Copy ship id and Ping
 * show, so a member is never offered Retire; a refetch never hides the
 * actions again.
 */
export function ShipActions({ ship, layout = 'buttons' }: { ship: ListedShip; layout?: ShipActionsLayout }) {
  const [dialog, setDialog] = useState<OpenDialog>();
  const [isComposing, setIsComposing] = useState(false);
  const [replacedPrompt, setReplacedPrompt] = useState<{ issuedAt: string } | undefined>(undefined);
  const getStartingPrompt = useGetStartingPrompt();
  const releaseShip = useReleaseShip();
  const retireShip = useRetireShip();
  const recrewShip = useRecrewShip();
  const renameShip = useRenameShip();
  const pingShip = usePingShip();
  const fleet = useFleetSnapshot();
  const counted = useShip(dialog === 'release' || dialog === 'recrew' || dialog === 'retire' || dialog === 'remove' ? ship.id : undefined);
  const connection = useSquadronsConnection();
  const squadrons = useSquadrons();
  const removeMember = useRemoveMember();
  const squadron = squadrons.data?.find(
    (each) => each.state !== 'disbanded' && (each.flagship.shipId === ship.id || each.members.some((member) => member.shipId === ship.id)),
  );
  const isMember = squadron !== undefined && squadron.flagship.shipId !== ship.id;
  // A member's new crew line asks first when it ends a session: that needs its in-flight count.
  const memberDetail = useShip(isMember && ship.status !== 'retired' ? ship.id : undefined);
  const member = squadron?.members.find((each) => each.shipId === ship.id);
  const crewLine = useNewCrewLineFlow(squadron && member ? { squadronId: squadron.id, member, ship: memberDetail.data } : undefined);
  // Pending only until the connection is known and, when connected, until the list first answers: a refetch never hides known actions.
  const isMembershipPending = connection === 'unknown' || (connection === 'connected' && !squadrons.isFetched);

  const close = () => {
    setDialog(undefined);
  };
  const issued = getStartingPrompt.data ?? recrewShip.data;
  const promptState: StartingPromptDialogState = issued ? 'shown' : getStartingPrompt.isError ? 'error' : 'issuing';

  const issuePrompt = () => {
    recrewShip.reset();
    getStartingPrompt.mutate({ shipId: ship.id });
  };
  const requestPrompt = () => {
    getStartingPrompt.reset();
    recrewShip.reset();
    // No confirm: the dialog says the prompt it replaces stops working.
    setReplacedPrompt(isUnclaimedPromptOut(ship) && ship.startingPrompt ? { issuedAt: ship.startingPrompt.issuedAt } : undefined);
    setDialog('prompt');
    getStartingPrompt.mutate({ shipId: ship.id });
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

  const copyId = () => {
    void navigator.clipboard.writeText(ship.id).then(
      () => {
        showToast({ title: 'Ship id copied', description: ship.id, tone: 'success' });
      },
      () => {
        showToast({ title: "Couldn't copy the ship id", description: ship.id, tone: 'error' });
      },
    );
  };
  const isFlagship = squadron?.flagship.shipId === ship.id;
  const message: ShipAction = { key: 'message', label: 'Message', menuLabel: 'Message this ship…', testId: 'fleet-ship-message', onSelect: () => { setIsComposing(true); }, isMenuOnly: true };
  const copy: ShipAction = { key: 'copy', label: 'Copy ship id', menuLabel: 'Copy ship id', testId: 'fleet-ship-copy-id', onSelect: copyId, isMenuOnly: true };
  const pingAction: ShipAction = { key: 'ping', label: 'Ping', menuLabel: 'Ping', testId: 'fleet-ship-ping', onSelect: ping, isDisabled: !canPing(ship), isLoading: pingShip.isPending };
  const actions: ShipAction[] = [];
  if (ship.kind === 'operator') {
    actions.push({ key: 'inbox', label: 'Open inbox', menuLabel: 'Open inbox', testId: 'fleet-ship-open-inbox', href: '/inbox', isMenuOnly: true }, copy);
  } else if (ship.status === 'retired') {
    actions.push(copy);
  } else if (isFlagship) {
    actions.push({ key: 'squadron', label: 'Open squadron', menuLabel: 'Open squadron', testId: 'fleet-ship-open-squadron', href: `/squadrons/${squadron.id}` });
  } else if (isMembershipPending) {
    actions.push(message, copy, pingAction);
  } else if (member && squadron) {
    actions.push(message, copy, pingAction, {
      key: 'crew-line',
      label: 'Get new crew line',
      menuLabel: 'Get new crew line…',
      testId: 'fleet-ship-new-crew-line',
      onSelect: crewLine.start,
      isDisabled: !crewLine.isReady,
      isPrimary: member.health === 'silent',
    });
    if (ship.status === 'crewed') {
      actions.push({ key: 'release', label: 'Release', menuLabel: 'Release ship…', testId: 'fleet-ship-release', onSelect: open('release') });
    }
    if (squadron.state === 'sailing' || squadron.state === 'standing-down') {
      actions.push({ key: 'remove', label: 'Remove from squadron', menuLabel: 'Remove from squadron…', testId: 'fleet-ship-remove', onSelect: open('remove'), isDestructive: true });
    }
  } else {
    actions.push(message, copy);
    if (ship.status === 'awaitingCrew') {
      actions.push({ key: 'prompt', label: 'Get starting prompt', menuLabel: 'Get starting prompt…', testId: 'fleet-ship-prompt', onSelect: requestPrompt });
    } else {
      actions.push(
        pingAction,
        { key: 'recrew', label: 'Re-crew', menuLabel: 'Re-crew…', testId: 'fleet-ship-recrew', onSelect: open('recrew') },
        { key: 'release', label: 'Release', menuLabel: 'Release ship…', testId: 'fleet-ship-release', onSelect: open('release') },
      );
    }
    actions.push(
      { key: 'rename', label: 'Rename', menuLabel: 'Rename…', testId: 'fleet-ship-rename', onSelect: open('rename') },
      { key: 'retire', label: 'Retire', menuLabel: 'Retire ship…', testId: 'fleet-ship-retire', onSelect: open('retire'), isDestructive: true },
    );
  }

  return (
    <>
      <ActionsIn layout={layout} ship={ship} actions={actions} />
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
        crewLines={issued?.crewLines}
        replacesUnclaimed={replacedPrompt}
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
      {crewLine.dialog}
      {isComposing && <ComposeMessage isOpen onOpenChange={setIsComposing} toShipId={ship.id} />}
    </>
  );
}

/** Buttons, ghost for Rename and the destructive ones, as the ship page shows them. */
function ActionButton({ action }: { action: ShipAction }) {
  const variant = action.isPrimary ? 'primary' : action.isDestructive || action.key === 'rename' ? 'ghost' : 'secondary';
  if (action.href !== undefined) {
    return (
      <Button size="xs" variant={variant} nativeButton={false} data-testid={action.testId} render={<Link href={action.href} />}>
        {action.label}
      </Button>
    );
  }
  return (
    <Button size="xs" variant={variant} data-testid={action.testId} disabled={action.isDisabled} isLoading={action.isLoading} onClick={action.onSelect}>
      {action.label}
    </Button>
  );
}

/** The ship's actions in the layout asked for: buttons, a row menu or sheet, or the row's one next step. */
function ActionsIn({ layout, ship, actions }: { layout: ShipActionsLayout; ship: ListedShip; actions: readonly ShipAction[] }): ReactNode {
  if (layout === 'next') {
    // At most one next step: a starting prompt for a ship awaiting crew, a new crew line for a silent member.
    const next = actions.find((action) => action.key === 'prompt' || (action.key === 'crew-line' && action.isPrimary === true));
    return next ? <ActionButton action={{ ...next, isPrimary: false }} /> : null;
  }
  if (layout === 'buttons') {
    const shown = actions.filter((action) => action.isMenuOnly !== true);
    return shown.length === 0 ? null : (
      <div className="flex flex-wrap items-center justify-end gap-2 max-sm:justify-start">
        {shown.map((action) => (
          <ActionButton key={action.key} action={action} />
        ))}
      </div>
    );
  }
  const trigger = <Button size="xs" variant="ghost" isIconOnly aria-label={`Actions for ${ship.name}`} icon={<Ellipsis />} data-testid="fleet-actions" />;
  if (layout === 'sheet') {
    return (
      <Sheet>
        <SheetTrigger render={trigger} />
        <SheetContent side="bottom" data-testid="fleet-row-sheet">
          <SheetHeader>
            <SheetTitle>{ship.name}</SheetTitle>
          </SheetHeader>
          <ul className="flex flex-col pb-2">
            {actions.map((action) => (
              <li key={action.key}>
                <SheetClose
                  render={
                    action.href === undefined ? (
                      <button type="button" disabled={action.isDisabled} onClick={action.onSelect} />
                    ) : (
                      <Link href={action.href} />
                    )
                  }
                  data-testid={action.testId}
                  className={`flex h-(--size-control-touch) w-full items-center px-4 text-left text-body-touch disabled:opacity-45 ${action.isDestructive ? 'text-destructive-text' : 'text-foreground'}`}
                >
                  {action.menuLabel.replace(/…$/, '')}
                </SheetClose>
              </li>
            ))}
          </ul>
          <div className="px-4 pb-4">
            <SheetClose render={<Button size="touch" className="w-full" />}>Cancel</SheetClose>
          </div>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent>
        {actions.map((action) =>
          action.href === undefined ? (
            <DropdownMenuItem
              key={action.key}
              data-testid={action.testId}
              disabled={action.isDisabled}
              variant={action.isDestructive ? 'destructive' : 'default'}
              onClick={action.onSelect}
            >
              {action.menuLabel}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={action.key} data-testid={action.testId} render={<Link href={action.href} />}>
              {action.menuLabel}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
