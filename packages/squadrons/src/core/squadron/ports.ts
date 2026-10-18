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
  /** Whether its forming gave it up with a ship the fleet refused to retire: no forming holds it any more. */
  isGivenUp: boolean;
  /** Recovery passes in which the fleet refused a retire, kept across restarts. */
  recoveryRefusals: number;
}

/**
 * Outbound port: formation attempts, recorded before forming changes the
 * fleet, so a start after a crash finds what an unfinished one commissioned.
 */
export interface FormationAttempts {
  begin(attempt: Omit<FormationAttempt, 'ships' | 'isGivenUp' | 'recoveryRefusals'>): Promise<void>;
  /** Records the name of a ship before it is commissioned. */
  plan(attemptId: string, name: string): Promise<void>;
  /** Records the id of a planned ship once it is commissioned. */
  commissioned(attemptId: string, ship: { name: string; shipId: ShipId }): Promise<void>;
  /** Records that its forming gave the attempt up unfinished, so a recovery at a rescan may undo it. */
  giveUp(attemptId: string): Promise<void>;
  /** Counts one recovery pass with a refused retire. */
  recordRecoveryRefusal(fleetId: FleetId, attemptId: string): Promise<void>;
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
  tell(notice: { fleetId: FleetId; headline: string; body: string; key: string }): Promise<void>;
}

/** Outbound port: random lowercase alphanumerics, for squadron ids and member names. */
export interface RandomNames {
  suffix(length: number): string;
}

/** A form request squadrons refused: kept by its forming ship and key, so a repeat gets the first answer again. */
export interface FormRefusal {
  formingShipId: ShipId;
  key: string;
  code: string;
  message: string;
}

/** Outbound port: the form requests squadrons refused, within one fleet. */
export interface FormRefusals {
  find(fleetId: FleetId, request: { formingShipId: ShipId; key: string }): Promise<FormRefusal | undefined>;
  keep(refusal: FormRefusal & { fleetId: FleetId }): Promise<void>;
}

/** A member's relay the flagship sent on to its forming ship: the forming ship's answer to it goes back to that member's message. */
export interface Relay {
  fleetId: FleetId;
  squadronId: string;
  /** The message the flagship sent the forming ship. */
  relayMessageId: MessageId;
  memberShipId: ShipId;
  /** The member's message it carried on. */
  memberMessageId: MessageId;
}

/** Outbound port: the relays flagships sent on, within one fleet. */
export interface RelayLog {
  /** Recording one again, after a lost answer, changes nothing. */
  record(relay: Relay): Promise<void>;
  find(fleetId: FleetId, relayMessageId: MessageId): Promise<Relay | undefined>;
}
