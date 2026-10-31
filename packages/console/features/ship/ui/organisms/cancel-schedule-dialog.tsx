'use client';

import { Button, dialogSurface } from '@aeolus-fleet/ui';
import { AlertDialog, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../../../components/atoms/alert-dialog';
import { InlineError } from '../../../../components/molecules/inline-error';

interface CancelScheduleDialogProps {
  /** Whom the schedule sends to and when, such as "To chief-of-staff" and "Every 6 h"; the confirm is open while one is given. */
  schedule: { recipient: string; timing: string } | undefined;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why the server refused it; nothing changed. */
  error?: string;
  onConfirm: () => void;
}

/**
 * Cancel a ship's schedule (decision 0062, S10): it sends nothing more, and
 * nothing brings it back; its ship schedules anew to send again.
 */
export function CancelScheduleDialog({ schedule, onOpenChange, isPending, error, onConfirm }: CancelScheduleDialogProps) {
  return (
    <AlertDialog
      open={schedule !== undefined}
      onOpenChange={(isOpen) => {
        if (!isPending) {
          onOpenChange(isOpen);
        }
      }}
    >
      <AlertDialogContent data-testid="cancel-schedule-dialog" className={dialogSurface.phoneSheet}>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this schedule?</AlertDialogTitle>
          <AlertDialogDescription>
            {schedule === undefined ? null : `${schedule.recipient}: ${schedule.timing}. It sends nothing more, and it cannot be resumed: its ship schedules anew to send again.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error === undefined ? null : <InlineError title="Couldn’t cancel the schedule" description={`${error}. Nothing changed: try again.`} />}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button disabled={isPending} />}>Keep it</AlertDialogClose>
          <Button variant="destructive" isLoading={isPending} data-testid="cancel-schedule-confirm" onClick={onConfirm}>
            {isPending ? 'Cancelling…' : 'Cancel schedule'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
