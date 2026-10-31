import type { MessageId, ScheduleId, ScheduleItem } from '@aeolus-fleet/common';
import { CalendarClock, CircleX, Pause, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@aeolus-fleet/ui';
import { scheduleRowOf, type ScheduleRow } from '../../services/schedule-row';
import { EmptyState } from '../../../../components/molecules/empty-state';
import { InlineError } from '../../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../../components/molecules/loading-skeleton';
import { StatusBadge } from '../../../../components/molecules/status-badge';

/** What the console does to a schedule: Pause, or Cancel once confirmed. */
export type ScheduleAction = 'pause' | 'cancel';

interface ShipSchedulesProps {
  /** The ship's schedules, newest first. */
  schedules: readonly ScheduleItem[];
  state: 'ready' | 'loading' | 'error';
  onRetry?: () => void;
  /** What ends the list while older schedules follow: Load more. */
  more?: ReactNode;
  /** The time relative times are measured from. */
  now: Date;
  /** The schedule whose Pause the server is working on. */
  pausingId?: ScheduleId;
  /** Why the server refused to pause a schedule; nothing changed. */
  pauseError?: { scheduleId: ScheduleId; message: string };
  onPause: (scheduleId: ScheduleId) => void;
  /** Opens the confirm; the schedule is cancelled only from there. */
  onCancel: (scheduleId: ScheduleId) => void;
  onOpenMessage: (messageId: MessageId) => void;
}

function ScheduleRowItem({
  row,
  isPausing,
  pauseError,
  onPause,
  onCancel,
  onOpenMessage,
}: Pick<ShipSchedulesProps, 'onPause' | 'onCancel' | 'onOpenMessage'> & { row: ScheduleRow; isPausing: boolean; pauseError: string | undefined }) {
  const outcome = row.lastOutcome;
  return (
    <li data-testid="ship-schedule" data-schedule-id={row.scheduleId} className="flex flex-col gap-2 border-b border-border px-3.5 py-3 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-body text-foreground max-sm:text-body-touch">{row.recipient}</span>
          <span className="text-meta text-muted-foreground">{row.timing}</span>
          <span className="flex flex-wrap gap-x-3 text-meta text-muted-foreground tabular-nums">
            {row.nextSend === undefined ? null : <span>{row.nextSend}</span>}
            {outcome === undefined ? (
              <span>Nothing sent yet</span>
            ) : outcome.messageId === undefined ? (
              <span data-testid="ship-schedule-outcome">{outcome.text}</span>
            ) : (
              <button
                type="button"
                data-testid="ship-schedule-outcome"
                className="underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  if (outcome.messageId !== undefined) {
                    onOpenMessage(outcome.messageId);
                  }
                }}
              >
                {outcome.text}
              </button>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={row.state} />
          {row.canPause ? (
            <Button
              size="sm"
              icon={<Pause aria-hidden />}
              isLoading={isPausing}
              data-testid="ship-schedule-pause"
              onClick={() => {
                onPause(row.scheduleId);
              }}
            >
              {isPausing ? 'Pausing…' : 'Pause'}
            </Button>
          ) : null}
          {row.canCancel ? (
            <Button
              size="sm"
              variant="destructive"
              icon={<CircleX aria-hidden />}
              disabled={isPausing}
              data-testid="ship-schedule-cancel"
              onClick={() => {
                onCancel(row.scheduleId);
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
      {pauseError === undefined ? null : <InlineError title="Couldn’t pause the schedule" description={`${pauseError}. Nothing changed: try again.`} />}
    </li>
  );
}

/**
 * A ship's schedules on its page (decision 0062, S15): whom each sends to,
 * when, its state, next send time and last outcome, a sent one opening its
 * message. An active one offers Pause; an active or paused one offers Cancel.
 * There is no Resume here: only its own ship resumes a schedule (S10).
 */
export function ShipSchedules({ schedules, state, onRetry, more, now, pausingId, pauseError, onPause, onCancel, onOpenMessage }: ShipSchedulesProps) {
  if (state === 'loading') {
    return <LoadingSkeleton variant="list" rows={3} label="Loading the schedules" />;
  }
  if (state === 'error') {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
        <InlineError title="Couldn’t load the schedules" description="The rest of the page is current. Try again in a moment." />
        {onRetry ? (
          <Button size="sm" icon={<RotateCw aria-hidden />} onClick={onRetry} className="self-start">
            Try again
          </Button>
        ) : null}
      </div>
    );
  }
  if (schedules.length === 0 && !more) {
    return <EmptyState variant="section" icon={<CalendarClock />} title="No schedules" description="Messages this ship schedules appear here, with what each last sent." />;
  }
  return (
    <div className="flex flex-col gap-3">
      <ol aria-label="Schedules" className="overflow-hidden rounded-lg border border-border bg-card">
        {schedules.map((schedule) => (
          <ScheduleRowItem
            key={schedule.scheduleId}
            row={scheduleRowOf(schedule, now)}
            isPausing={pausingId === schedule.scheduleId}
            pauseError={pauseError?.scheduleId === schedule.scheduleId ? pauseError.message : undefined}
            onPause={onPause}
            onCancel={onCancel}
            onOpenMessage={onOpenMessage}
          />
        ))}
      </ol>
      {more}
    </div>
  );
}
