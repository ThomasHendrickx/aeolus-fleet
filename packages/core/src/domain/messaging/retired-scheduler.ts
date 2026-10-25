import type { FleetId, IdGenerator, ShipId } from '@aeolus-fleet/common';

import { recordEvent, type Actor, type EventLog } from '../shared/events.js';
import type { ScheduleRepository } from './ports.js';
import { cancelSchedule, type Schedule } from './schedule.js';

export interface RetiredSchedulerTx {
  schedules: Pick<ScheduleRepository, 'listOpenOfShipForUpdate' | 'save'>;
  events: EventLog;
}

/**
 * The retiring ship's active and paused schedules, held for update. A retire
 * takes them before it locks the ship: a send time holds its schedule and
 * then the ship it sends to, which may be the retiring ship itself, so the
 * other order would deadlock.
 */
export function lockSchedulesOf(tx: Pick<RetiredSchedulerTx, 'schedules'>, ship: { fleetId: FleetId; shipId: ShipId }): Promise<Schedule[]> {
  return tx.schedules.listOpenOfShipForUpdate(ship.fleetId, ship.shipId);
}

/**
 * The schedules locked by `lockSchedulesOf`, cancelled within the retire's
 * unit of work (decision 0062, S11), each with ScheduleCancelled, the reason
 * retired, caused by the retire's actor: a retired ship sends nothing more.
 */
export async function cancelSchedulesOnRetire(deps: { tx: RetiredSchedulerTx; ids: IdGenerator }, retire: { schedules: readonly Schedule[]; actor: Actor; at: Date }): Promise<void> {
  const { tx, ids } = deps;
  for (const schedule of retire.schedules) {
    const cancelled = cancelSchedule(schedule, { reason: 'retired', actor: retire.actor, at: retire.at });
    // Never refused: the schedules held are active or paused.
    if (cancelled.isOk) {
      await tx.schedules.save(cancelled.value.schedule);
      for (const event of cancelled.value.events) {
        await recordEvent({ events: tx.events, ids }, event);
      }
    }
  }
}
