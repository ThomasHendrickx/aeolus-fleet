/** A page of the fixed expected ships with delivery progress and current crew facts. */
import type { ShipId, ShipStatus, TurnState } from '@aeolus-fleet/common';

import { shipStatus, type LeaseRepository, type ShipRepository } from '../registry/public.js';
import type { Page, PageQuery } from '../shared/page.js';
import type { MeetingCall } from './meeting-call.js';
import type { MeetingRepository } from './ports.js';
import type { MeetingParty } from './read-meeting.js';

export interface CallProgressRead {
  ship: MeetingParty;
  progress: 'delivered' | 'acknowledged' | 'answered' | 'late' | 'silent';
  deliveredAt: Date | null;
  acknowledgedAt: Date | null;
  status: ShipStatus;
  turn: TurnState | null;
}

interface ProgressTx {
  meetings: Pick<MeetingRepository, 'progressPage'>;
  ships: Pick<ShipRepository, 'findMany'>;
  leases: Pick<LeaseRepository, 'readCrews'>;
}

/** Answer and silence are round facts; current crew facts come through the published registry port. */
export async function readCallProgress(tx: ProgressTx, input: { call: MeetingCall } & PageQuery<ShipId>): Promise<Page<CallProgressRead, ShipId>> {
  const { call, ...query } = input;
  const page = await tx.meetings.progressPage(call.fleetId, { callId: call.id, ...query });
  const shipIds = page.items.map((row) => row.shipId);
  const [ships, crews] = await Promise.all([tx.ships.findMany(call.fleetId, shipIds), tx.leases.readCrews(call.fleetId, shipIds)]);
  const byId = new Map(ships.map((ship) => [ship.id, ship]));
  const crewById = new Map(crews.map((crew) => [crew.shipId, crew]));
  return { nextCursor: page.nextCursor, items: page.items.map((row) => {
    const ship = byId.get(row.shipId);
    const crew = crewById.get(row.shipId);
    const answer = call.answers.find((held) => held.shipId === row.shipId);
    const progress = answer !== undefined ? (answer.isLate ? 'late' : 'answered')
      : call.silentShipIds.includes(row.shipId) ? 'silent' : row.isAcknowledged ? 'acknowledged' : 'delivered';
    return { ship: { id: row.shipId, name: ship?.name ?? row.shipId }, progress,
      deliveredAt: row.deliveredAt, acknowledgedAt: row.acknowledgedAt,
      status: ship === undefined ? 'awaitingCrew' : shipStatus(ship, { isCrewed: crew !== undefined }), turn: crew?.pushedAt === null ? null : crew?.turn ?? null };
  }) };
}
