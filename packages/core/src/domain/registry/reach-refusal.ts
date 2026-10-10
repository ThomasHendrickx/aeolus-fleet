import type { FleetId, ReachRefusalId, ShipId, WhileUnavailable } from '@aeolus-fleet/common';

import type { CarriedLabel } from './label.js';

/** A ship as a refusal saw it: its id, its name and the label values it carried then, by key. */
export interface RefusedShip {
  id: ShipId;
  name: string;
  labels: readonly CarriedLabel[];
}

/**
 * The record of a send the network rules refused (decision 0034): who tried
 * to reach whom, both ships as they were at that moment, so a later rename or
 * relabelling keeps it true, and the version of the settings that refused it.
 * Not an event: only argo reads it.
 */
export interface ReachRefusal {
  fleetId: FleetId;
  id: ReachRefusalId;
  at: Date;
  sender: RefusedShip;
  /** The ship it was for, or the type and each ship of it, none of which the sender may reach. */
  recipient: { kind: 'ship'; ship: RefusedShip } | { kind: 'type'; type: string; ships: readonly RefusedShip[] };
  settingsVersion: number;
  /** What the networking plugin declared, when it refused while the plugin was not responding (decision 0035); null otherwise. */
  whilePluginUnavailable: Exclude<WhileUnavailable, 'open-all'> | null;
}
