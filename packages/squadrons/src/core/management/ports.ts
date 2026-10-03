import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';

/** Why the fleet refused a ship call: its code (CONFLICT, UNAUTHORIZED, LEASE_ENDED, ...) and its message. */
export interface FleetRefusal {
  code: string;
  message: string;
}

/**
 * Outbound port: the fleet's public ship calls, as squadrons makes them for
 * its management ship. squadrons is a ship like any other (decision 0017).
 */
export interface FleetDoor {
  register(claim: { shipId: ShipId; secret: string }): Promise<Result<{ crewToken: string }, FleetRefusal>>;
  whoami(crewToken: string): Promise<Result<{ shipId: ShipId; fleetId: FleetId; name: string; type: string }, FleetRefusal>>;
  /** Commissions an agent ship as the crew token's ship (fleet:manage); answers its id and its crew line, which holds its secret. */
  commission(crewToken: string, ship: { name: string; type: string }): Promise<Result<{ shipId: ShipId; crewLine: string }, FleetRefusal>>;
  /** Retires a ship as the crew token's ship (fleet:manage). */
  retire(crewToken: string, ship: { shipId: ShipId }): Promise<Result<undefined, FleetRefusal>>;
  /** The crew token's next deliveries, waiting briefly when there are none. */
  receive(crewToken: string, until?: { signal: AbortSignal }): Promise<Result<ReceivedMessage[], FleetRefusal>>;
  ack(crewToken: string, deliveryId: DeliveryId): Promise<Result<undefined, FleetRefusal>>;
  send(crewToken: string, message: OutgoingMessage): Promise<Result<{ messageId: MessageId }, FleetRefusal>>;
}

/** A delivery as a receive hands it over: what squadrons reads of it. */
export interface ReceivedMessage {
  deliveryId: DeliveryId;
  messageId: MessageId;
  senderShipId: ShipId;
  contentType: string;
  payload: string;
  inReplyTo: MessageId | null;
}

/** A message squadrons sends from one of its ships. */
export interface OutgoingMessage {
  selector: { kind: 'ship'; shipId: ShipId } | { kind: 'ship'; name: string } | { kind: 'type'; type: string };
  payload: string;
  contentType: string;
  inReplyTo?: MessageId;
  /** New per message; the same only to retry the same send. */
  idempotencyKey: string;
}

/** The crew token squadrons holds for its management ship, and when it got it. */
export interface ManagementCrew {
  /** The fleet the management ship belongs to: the fleet squadrons serves. */
  fleetId: FleetId;
  shipId: ShipId;
  crewToken: string;
  crewedAt: Date;
}

/** Outbound port: where squadrons keeps its management ship's crew token across restarts. */
export interface ManagementCrewStore {
  find(): Promise<ManagementCrew | undefined>;
  save(crew: ManagementCrew): Promise<void>;
}
