import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { Squadron } from './squadron.js';

/** Outbound port: squadrons, in squadrons' own database, always within one fleet. */
export interface SquadronRepository {
  exists(fleetId: FleetId, id: string): Promise<boolean>;
  /** Stores the squadron and finishes the attempt that formed it, together: a crash leaves both or neither. */
  create(squadron: Squadron, attemptId: string): Promise<void>;
  /** The fleet's squadrons, oldest first. */
  list(fleetId: FleetId): Promise<Squadron[]>;
  /**
   * Stores what changed from `before` to `after`, and only that, in one unit
   * of work: a member new in `after` is added. `finishesAttempt` finishes the
   * formation attempt that commissioned a new member in the same unit of work.
   */
  update(change: { before: Squadron; after: Squadron; finishesAttempt?: string }): Promise<void>;
}

/** A forming in progress: every ship it is about to commission, by name, and its id once commissioned. */
export interface FormationAttempt {
  id: string;
  fleetId: FleetId;
  squadronId: string;
  startedAt: Date;
  ships: { name: string; shipId: ShipId | null }[];
}

/**
 * Outbound port: formation attempts, recorded before forming changes the
 * fleet, so a start after a crash finds what an unfinished one commissioned.
 */
export interface FormationAttempts {
  begin(attempt: Omit<FormationAttempt, 'ships'>): Promise<void>;
  /** Records the name of a ship before it is commissioned. */
  plan(attemptId: string, name: string): Promise<void>;
  /** Records the id of a planned ship once it is commissioned. */
  commissioned(attemptId: string, ship: { name: string; shipId: ShipId }): Promise<void>;
  finish(attemptId: string): Promise<void>;
  unfinished(fleetId: FleetId): Promise<FormationAttempt[]>;
}

/** A message a flagship received and does not handle: kept so it never disappears. */
export interface KeptMessage {
  fleetId: FleetId;
  squadronId: string;
  deliveryId: DeliveryId;
  messageId: MessageId;
  senderShipId: ShipId;
  senderName: string;
  contentType: string;
  payload: string;
  inReplyTo: MessageId | null;
  receivedAt: Date;
}

/** Outbound port: the messages flagships kept, for the squadron page. */
export interface FlagshipMessageLog {
  keep(message: KeptMessage): Promise<void>;
  /** A squadron's kept messages, oldest first. */
  list(fleetId: FleetId, squadronId: string): Promise<KeptMessage[]>;
}

/** Outbound port: tells the operator, argo, when something goes wrong: the one party squadrons knows. */
export interface OperatorNotices {
  /** The key makes telling again, for a delivery that came again, send no second notice. */
  tell(notice: { fleetId: FleetId; text: string; key: string }): Promise<void>;
}

/** Outbound port: random lowercase alphanumerics, for squadron ids and member names. */
export interface RandomNames {
  suffix(length: number): string;
}
