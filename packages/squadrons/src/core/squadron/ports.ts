import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { Squadron } from './squadron.js';

/** Outbound port: squadrons, in squadrons' own database, always within one fleet. */
export interface SquadronRepository {
  exists(fleetId: FleetId, id: string): Promise<boolean>;
  create(squadron: Squadron): Promise<void>;
  /** The fleet's squadrons, oldest first. */
  list(fleetId: FleetId): Promise<Squadron[]>;
  /** Stores the squadron's state, when it sailed, and when each member came on station. */
  update(squadron: Squadron): Promise<void>;
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
  tell(text: string): Promise<void>;
}

/** Outbound port: random lowercase alphanumerics, for squadron ids and member names. */
export interface RandomNames {
  suffix(length: number): string;
}
