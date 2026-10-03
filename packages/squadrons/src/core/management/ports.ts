import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';

/**
 * Why the fleet refused a ship call: its code (CONFLICT, UNAUTHORIZED,
 * LEASE_ENDED, ...) and its message. UNAVAILABLE: no answer came, so the call
 * may or may not have been carried out.
 */
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
  /**
   * Commissions a ship under squadrons' own idempotency key. A repeat under the
   * same key answers the same ship with no crew line: its secret was shown once.
   */
  commission(crewToken: string, ship: { name: string; type: string; idempotencyKey: string }): Promise<Result<{ shipId: ShipId; crewLine: string | null }, FleetRefusal>>;
  /** A ship of the fleet, retired ones included; needs fleet:read. */
  getShip(crewToken: string, ship: { shipId: ShipId }): Promise<Result<FleetShip, FleetRefusal>>;
  /** Ends this session's crew of its ship: the lease and the secret it claimed with. */
  deregister(crewToken: string): Promise<Result<undefined, FleetRefusal>>;
  /** A new starting prompt's crew line for a ship awaiting crew; the earlier secret stops working. */
  getStartingPrompt(crewToken: string, ship: { shipId: ShipId }): Promise<Result<{ crewLine: string }, FleetRefusal>>;
  /** The fleet's ships that are not retired, by id and name (fleet:read). */
  listShips(crewToken: string): Promise<Result<{ shipId: ShipId; name: string }[], FleetRefusal>>;
  /** Retires a ship as the crew token's ship (fleet:manage). */
  retire(crewToken: string, ship: { shipId: ShipId }): Promise<Result<undefined, FleetRefusal>>;
  /** The crew token's next deliveries, waiting briefly when there are none. */
  receive(crewToken: string, until?: { signal: AbortSignal }): Promise<Result<ReceivedMessage[], FleetRefusal>>;
  ack(crewToken: string, deliveryId: DeliveryId): Promise<Result<undefined, FleetRefusal>>;
  send(crewToken: string, message: OutgoingMessage): Promise<Result<{ messageId: MessageId }, FleetRefusal>>;
}

/** A ship as `fleet.ship` shows it: what squadrons reads of it. */
export interface FleetShip {
  status: 'awaitingCrew' | 'crewed' | 'retired';
  scopes: string[];
  /** When its session last called the fleet; null while no session crews it. */
  lastSeenAt: Date | null;
  /** Since when its crew has held it; null while not crewed. */
  crewedSince: Date | null;
  /** When its crew last reported; null until it reports, and for a ship no session crews. */
  reportedAt: Date | null;
}

/** A delivery as a receive hands it over: what squadrons reads of it. */
export interface ReceivedMessage {
  deliveryId: DeliveryId;
  messageId: MessageId;
  senderShipId: ShipId;
  senderName: string;
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
  /** The ship's name when squadrons connected, shown while the fleet does not answer. */
  name: string;
  crewToken: string;
  crewedAt: Date;
}

/** The fleet and ship squadrons was last connected as; kept when its crew token is dropped. */
export interface ManagementBinding {
  fleetId: FleetId;
  shipId: ShipId;
}

/** Outbound port: where squadrons keeps its management ship's crew token across restarts. */
export interface ManagementCrewStore {
  /** The crew, while squadrons holds a crew token: while it is connected. */
  find(): Promise<ManagementCrew | undefined>;
  /** The last connection's fleet and ship, with or without a crew token; none before the first. */
  binding(): Promise<ManagementBinding | undefined>;
  save(crew: ManagementCrew): Promise<void>;
  /** Forgets the crew token, keeping the binding: squadrons is not connected. */
  drop(): Promise<void>;
}

/**
 * Whether squadrons holds a working crew token for its management ship, as
 * which ship, and the ship it was last connected as.
 */
export interface ConnectionStatus {
  state: 'not-connected' | 'connected';
  ship: { shipId: ShipId; name: string } | null;
  lastShipId: ShipId | null;
}
