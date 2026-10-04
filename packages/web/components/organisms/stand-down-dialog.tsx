'use client';

import { Archive, Ban, Hourglass, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { isTypedMatch } from '../../lib/ship-dialogs';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../atoms/alert-dialog';
import { Button } from '../atoms/button';
import { dialogSurface } from '../atoms/dialog-surface';
import { ConsequenceList } from '../molecules/consequence-list';
import { InlineError } from '../molecules/inline-error';
import { TypedConfirm } from '../molecules/typed-confirm';

interface StandDownDialogProps {
  squadronId: string;
  memberCount: number;
  /** The open deliveries its members hold, and how many of them are in flight. */
  openDeliveries: number;
  inFlightDeliveries: number;
  /** Force: retire everything now, abandoning open work; otherwise members finish first. */
  isForced?: boolean;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why the stand down failed, as the squadron manager said it. */
  error?: string;
  onConfirm: () => void;
}

function deliveriesText(count: number): string {
  return `${String(count)} ${count === 1 ? 'delivery' : 'deliveries'}`;
}

/** The open dialog's body: its typed text lives here, so it starts empty each time the dialog opens. */
function StandDownBody(props: StandDownDialogProps) {
  const { squadronId, memberCount, openDeliveries, inFlightDeliveries, isForced = false, isPending, error, onConfirm } = props;
  const [typed, setTyped] = useState('');
  const isTypingNeeded = isForced && openDeliveries > 0;
  const isConfirmed = !isTypingNeeded || isTypedMatch(squadronId, typed);
  const failed = error === undefined ? null : (
    <InlineError title="Couldn’t stand down the squadron" description={`${error} Nothing changed; the squadron still sails.`} />
  );

  if (!isForced) {
    return (
      <>
        <AlertDialogHeader>
          <AlertDialogTitle>Stand down {squadronId}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its {memberCount} {memberCount === 1 ? 'member winds' : 'members wind'} down on their own. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ConsequenceList
          consequences={[
            { icon: Ban, text: 'No new work reaches its members; hand-offs stop.' },
            { icon: Hourglass, text: `Members finish their open work: ${deliveriesText(openDeliveries)}.` },
            { icon: Archive, text: 'Then each member ship and the flagship retire and the squadron is disbanded. History stays read-only.' },
          ]}
        />
        {failed}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button disabled={isPending} />}>Cancel</AlertDialogClose>
          <Button variant="destructive" isLoading={isPending} onClick={onConfirm} data-testid="stand-down-confirm">
            {isPending ? 'Standing down' : 'Stand down squadron'}
          </Button>
        </AlertDialogFooter>
      </>
    );
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Force stand down {squadronId}?</AlertDialogTitle>
        <AlertDialogDescription>The squadron disbands right away. This can&apos;t be undone.</AlertDialogDescription>
      </AlertDialogHeader>
      {openDeliveries > 0 ? (
        <div role="alert" className="flex gap-2 rounded-lg border border-tone-attention-border bg-tone-attention-bg p-3 text-meta text-tone-attention-fg">
          <TriangleAlert aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0" />
          <div className="flex flex-col gap-0.5">
            <p className="font-medium">{deliveriesText(openDeliveries)} will be abandoned</p>
            <p className="text-foreground">
              Members and the flagship retire now, without finishing. {openDeliveries - inFlightDeliveries} pending, {inFlightDeliveries} in flight.
            </p>
          </div>
        </div>
      ) : (
        <ConsequenceList consequences={[{ icon: Archive, text: 'Every member ship and the flagship retire now and the squadron is disbanded. No open work is lost.' }]} />
      )}
      {isTypingNeeded ? <TypedConfirm expected={squadronId} value={typed} onValueChange={setTyped} /> : null}
      {failed}
      <AlertDialogFooter>
        <AlertDialogClose render={<Button disabled={isPending} />}>Cancel</AlertDialogClose>
        <Button variant="destructive" isLoading={isPending} disabled={!isConfirmed} onClick={onConfirm} data-testid="force-stand-down-confirm">
          {openDeliveries > 0 ? `Stand down now and abandon ${deliveriesText(openDeliveries)}` : 'Force stand down'}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

/**
 * Stand down (docs/design/png/StandDownDialog.png): members finish their open
 * work, then retire, and the squadron disbands; irreversible but it loses
 * nothing, so one normal confirm. Force retires everything now and abandons
 * open deliveries, so it needs the TypedConfirm with the squadron id; with no
 * open work, a normal confirm. Desktop: a dialog; phone: a bottom sheet.
 */
export function StandDownDialog(props: StandDownDialogProps) {
  const { isOpen, onOpenChange, isPending, isForced = false } = props;
  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(isNowOpen) => {
        if (!isPending) {
          onOpenChange(isNowOpen);
        }
      }}
    >
      <AlertDialogContent data-testid={isForced ? 'force-stand-down-dialog' : 'stand-down-dialog'} className={dialogSurface.phoneSheet}>
        <StandDownBody {...props} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
