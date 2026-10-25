import type { FleetId } from '@aeolus-fleet/common';

import { appliedLimits, type AppliedLimitsTx } from '../registry/public.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { utcDayStart } from '../shared/utc-day.js';
import type { MessageRepository } from './ports.js';

export interface DailyMessageLimitTx extends AppliedLimitsTx {
  messages: Pick<MessageRepository, 'lockDailyCount' | 'countStoredOn'>;
}

/**
 * Whether the fleet may store `count` more messages today (one by default), in
 * the caller's unit of work, before it stores them: every message the fleet
 * stored since 00:00 UTC counts, whatever its kind or sender. With a limit, the
 * count is taken under the fleet's lock, held until the messages are stored, so
 * sends at the limit never overshoot it, nor does a unit of work that stores
 * several. Without one, nothing is counted or locked.
 */
export async function withinDailyMessageLimit(
  tx: DailyMessageLimitTx,
  at: { fleetId: FleetId; time: Date; count?: number },
): Promise<Result<undefined, DomainError<'MESSAGE_LIMIT_REACHED'>>> {
  const { fleetId, time, count = 1 } = at;
  const { dailyMessages } = await appliedLimits(tx, fleetId);
  if (dailyMessages === null) {
    return ok(undefined);
  }
  await tx.messages.lockDailyCount(fleetId);
  if ((await tx.messages.countStoredOn(fleetId, utcDayStart(time))) + count <= dailyMessages) {
    return ok(undefined);
  }
  return refuse(
    'MESSAGE_LIMIT_REACHED',
    `The fleet reached its limit of ${String(dailyMessages)} messages today (UTC), so nothing was stored. Sending works again after 00:00 UTC.`,
  );
}
