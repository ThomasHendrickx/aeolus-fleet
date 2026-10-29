import type { FleetId, IdGenerator, ShipId } from '@aeolus-fleet/common';

import { recordEvent, type Actor } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { DataKeysNeeded, HeldDataKeys } from './data-keys.js';
import type { Meeting } from './meeting.js';
import { withRetiredShip } from './meeting-life.js';
import { tellOfChange, type MeetingNoticeTx } from './meeting-notice.js';
import type { AcceptRefusal } from './message.js';
import type { MeetingRepository, RequestHasher } from './ports.js';

export interface RetiredParticipantTx extends MeetingNoticeTx {
  meetings: Pick<MeetingRepository, 'listPresentInForUpdate' | 'save'>;
}

/**
 * The open meetings the retiring ship is present in, held for update. A
 * retire takes them before it locks the ship: a contribution holds its meeting
 * and then its recipients' ships, so the other order would deadlock.
 */
export function lockMeetingsOf(tx: Pick<RetiredParticipantTx, 'meetings'>, ship: { fleetId: FleetId; shipId: ShipId }): Promise<Meeting[]> {
  return tx.meetings.listPresentInForUpdate(ship.fleetId, ship.shipId);
}

/**
 * The meetings a retiring ship is present in, locked by `lockMeetingsOf`, changed within the retire's
 * unit of work (decision 0061, M15, M17): it leaves each, off the mic, its
 * moderatorship going to the owner; a meeting it owns ends, every other
 * present participant told by a message from it, sealed in a sealed fleet
 * with the data keys held (decision 0068, B17). Its deliveries the retire
 * abandons itself.
 */
export async function leaveMeetingsOnRetire(
  deps: { tx: RetiredParticipantTx; ids: IdGenerator; hasher: RequestHasher; held: HeldDataKeys },
  retire: { meetings: readonly Meeting[]; shipId: ShipId; actor: Actor; at: Date },
): Promise<Result<undefined, AcceptRefusal | DataKeysNeeded>> {
  const { tx, ids } = deps;
  const { shipId, actor, at } = retire;
  for (const meeting of retire.meetings) {
    const changed = withRetiredShip(meeting, { shipId, actor, at });
    if (changed !== undefined) {
      await tx.meetings.save(changed.meeting);
      for (const event of changed.events) {
        await recordEvent({ events: tx.events, ids }, event);
      }
      const told = await tellOfChange(deps, { meeting: changed.meeting, micGivenTo: changed.micGivenTo, endedBy: changed.hasEnded ? shipId : null, at });
      if (!told.isOk) {
        return told;
      }
    }
  }
  return ok(undefined);
}
