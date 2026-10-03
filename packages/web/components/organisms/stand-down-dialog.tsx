'use client';

import { Archive, Ban, Hourglass } from 'lucide-react';

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

interface StandDownDialogProps {
  squadronId: string;
  memberCount: number;
  /** The open deliveries its members hold: the work they finish first. */
  openDeliveries: number;
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

/**
 * Stand down (docs/design/png/StandDownDialog.png): members finish their open
 * work, then retire, and the squadron disbands. Irreversible but it loses
 * nothing, so one normal confirm. Desktop: a dialog; phone: a bottom sheet.
 */
export function StandDownDialog(props: StandDownDialogProps) {
  const { squadronId, memberCount, openDeliveries, isOpen, onOpenChange, isPending, error, onConfirm } = props;
  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(isNowOpen) => {
        if (!isPending) {
          onOpenChange(isNowOpen);
        }
      }}
    >
      <AlertDialogContent data-testid="stand-down-dialog" className={dialogSurface.phoneSheet}>
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
        {error === undefined ? null : (
          <InlineError title="Couldn't stand down the squadron" description={`${error} Nothing changed; the squadron still sails.`} />
        )}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button disabled={isPending} />}>Cancel</AlertDialogClose>
          <Button variant="destructive" isLoading={isPending} onClick={onConfirm} data-testid="stand-down-confirm">
            {isPending ? 'Standing down' : 'Stand down squadron'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
