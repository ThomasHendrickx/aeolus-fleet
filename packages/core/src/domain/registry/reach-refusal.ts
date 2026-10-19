import type { AccountId, FleetId, NetworkVerb, ReachRefusalId, ShipId, WhileUnavailable } from '@aeolus-fleet/common';

import type { CarriedLabel } from './label.js';

/** A ship as a refusal saw it: its id, its name, the label values it carried then, by key, and its owner's ship then. */
export interface RefusedShip {
  id: ShipId;
  name: string;
  labels: readonly CarriedLabel[];
  owner: { id: ShipId; name: string } | null;
}

/** An account as a refusal saw it: by its id only, the `group` values its token carried that the fleet defines, and its person ship then. */
export interface RefusedAccount {
  kind: 'account';
  accountId: AccountId;
  labels: readonly CarriedLabel[];
  personShip: { id: ShipId; name: string } | null;
}

/** Who a refusal refused (decision 0057): a ship, an account, or the installation. */
export type RefusedActor = ({ kind: 'ship' } & RefusedShip) | RefusedAccount | { kind: 'installation' };

/**
 * The record of a send the network rules refused (decision 0034): who tried
 * to reach whom, both ships as they were at that moment, so a later rename,
 * relabelling or change of owner keeps it true, and the version of the settings that refused it.
 * Not an event: only argo reads it.
 */
export interface ReachRefusal {
  fleetId: FleetId;
  id: ReachRefusalId;
  at: Date;
  sender: RefusedActor;
  /** The plugin ship that read on behalf of the sender (decision 0034), as it was then; null for the sender's own call. */
  askedBy: RefusedShip | null;
  /** The ship it was for, or the type and each ship of it, none of which the sender may reach. */
  recipient: { kind: 'ship'; ship: RefusedShip } | { kind: 'type'; type: string; ships: readonly RefusedShip[] };
  /** What the sender tried to do: send, or read for a read refused rather than filtered (decision 0034). */
  verb: NetworkVerb;
  settingsVersion: number;
  /** What the networking plugin declared, when it refused while the plugin was not responding (decision 0035); null otherwise. */
  whilePluginUnavailable: Exclude<WhileUnavailable, 'open-all'> | null;
}
