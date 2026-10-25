'use client';

import type { MessageId, ScheduleId, ShipId } from '@aeolus-fleet/common';
import { useState } from 'react';

import { showToast } from '../../../components/atoms/toast';
import { LoadMore } from '../../../components/molecules/load-more';
import { useCancelSchedule, usePauseSchedule, useShipSchedules } from '../hooks/use-ship-schedules';
import { scheduleRowOf } from '../services/schedule-row';
import { CancelScheduleDialog } from '../ui/organisms/cancel-schedule-dialog';
import { ShipSchedules } from '../ui/organisms/ship-schedules';

/**
 * A ship's schedules on its page (decision 0062, S15), for a session that
 * manages the fleet: Pause applies at once, Cancel after its confirm. Each
 * says it worked with a toast and the row's new state; a refusal shows
 * where it was pressed and nothing changes.
 */
export function ShipPageSchedules({ shipId, now, onOpenMessage }: { shipId: ShipId; now: Date; onOpenMessage: (messageId: MessageId) => void }) {
  const schedules = useShipSchedules(shipId);
  const pause = usePauseSchedule();
  const cancel = useCancelSchedule();
  const [pausing, setPausing] = useState<ScheduleId>();
  const [pauseError, setPauseError] = useState<{ scheduleId: ScheduleId; message: string }>();
  const [cancelling, setCancelling] = useState<ScheduleId>();
  const [cancelError, setCancelError] = useState<string>();

  const cancelled = schedules.items?.find((schedule) => schedule.scheduleId === cancelling);

  return (
    <>
      <ShipSchedules
        schedules={schedules.items ?? []}
        state={schedules.isFailed ? 'error' : schedules.items ? 'ready' : 'loading'}
        onRetry={schedules.retry}
        more={schedules.hasMore ? <LoadMore what="older schedules" isLoading={schedules.isLoadingMore} isFailed={schedules.isLoadMoreFailed} onLoad={schedules.loadMore} area="ship-schedules" /> : null}
        now={now}
        pausingId={pause.isPending ? pausing : undefined}
        pauseError={pauseError}
        onPause={(scheduleId) => {
          setPauseError(undefined);
          setPausing(scheduleId);
          pause.mutate(
            { scheduleId },
            {
              onSuccess: () => {
                showToast({ title: 'Schedule paused', description: 'It sends nothing until its ship resumes it.', tone: 'success' });
              },
              onError: (failure) => {
                setPauseError({ scheduleId, message: failure.message });
              },
            },
          );
        }}
        onCancel={(scheduleId) => {
          setCancelError(undefined);
          setCancelling(scheduleId);
        }}
        onOpenMessage={onOpenMessage}
      />
      <CancelScheduleDialog
        schedule={cancelled === undefined ? undefined : scheduleRowOf(cancelled, now)}
        isPending={cancel.isPending}
        error={cancelError}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setCancelling(undefined);
          }
        }}
        onConfirm={() => {
          if (cancelling === undefined) {
            return;
          }
          setCancelError(undefined);
          cancel.mutate(
            { scheduleId: cancelling },
            {
              onSuccess: () => {
                setCancelling(undefined);
                showToast({ title: 'Schedule cancelled', description: 'It sends nothing more.', tone: 'success' });
              },
              onError: (failure) => {
                setCancelError(failure.message);
              },
            },
          );
        }}
      />
    </>
  );
}
