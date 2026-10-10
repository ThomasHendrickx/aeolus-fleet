import type { DeliveryId, FleetId, NetworkPluginDeclaration, NetworkRule, ShipId } from '@aeolus-fleet/common';

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

/** A ship as `fleet.ship` shows it: what the networking plugin reads of it. */
export interface FleetShip {
  status: 'awaitingCrew' | 'crewed' | 'retired';
  scopes: string[];
}

/**
 * Outbound port: the fleet's public ship calls, as the networking plugin makes
 * them for its own ship. The networking plugin is a ship like any other
 * (decision 0035).
 */
export interface FleetDoor {
  register(claim: { shipId: ShipId; secret: string }): Promise<Result<{ crewToken: string }, FleetRefusal>>;
  whoami(crewToken: string): Promise<Result<{ shipId: ShipId; fleetId: FleetId; name: string; type: string }, FleetRefusal>>;
  /** A ship of the fleet, retired ones included; needs fleet:read. */
  getShip(crewToken: string, ship: { shipId: ShipId }): Promise<Result<FleetShip, FleetRefusal>>;
  /** Ends this session's crew of its ship: the lease and the secret it claimed with. */
  deregister(crewToken: string): Promise<Result<undefined, FleetRefusal>>;
  /** Makes the crew token's ship the fleet's networking plugin with what it declares, or declares again (fleet:network, decision 0035). */
  registerNetworkPlugin(crewToken: string, declaration: NetworkPluginDeclaration): Promise<Result<undefined, FleetRefusal>>;
  /** The plugin unregisters, its rules going with it; FORBIDDEN when its ship is not the fleet's plugin. */
  unregisterNetworkPlugin(crewToken: string): Promise<Result<undefined, FleetRefusal>>;
  /** Sets the fleet's rules, the whole list, or none for all-to-all; only the fleet's plugin may (decision 0034). */
  setNetworkRules(crewToken: string, rules: readonly NetworkRule[] | null): Promise<Result<undefined, FleetRefusal>>;
  /** The deliveries waiting for the crew token's ship, waiting a while for one (a long poll), until the signal aborts. */
  receive(crewToken: string, until?: { signal: AbortSignal }): Promise<Result<{ deliveryId: DeliveryId }[], FleetRefusal>>;
  /** Acknowledges a delivery: received. */
  ack(crewToken: string, deliveryId: DeliveryId): Promise<Result<undefined, FleetRefusal>>;
}

/** The crew token the networking plugin holds for its ship in a fleet, and when it got it. */
export interface PluginCrew {
  /** The fleet the ship belongs to: the fleet the networking plugin serves. */
  fleetId: FleetId;
  shipId: ShipId;
  /** The ship's name when the networking plugin connected, shown while the fleet does not answer. */
  name: string;
  crewToken: string;
  crewedAt: Date;
}

/** The fleet and ship the networking plugin was last connected as; kept when its crew token is dropped. */
export interface PluginBinding {
  fleetId: FleetId;
  shipId: ShipId;
}

/**
 * Outbound port: where the networking plugin keeps each fleet's crew token
 * across restarts. One install serves many fleets, one connection each.
 */
export interface ConnectionStore {
  /** The fleet's crew, while the networking plugin holds a crew token for it: while it is connected to that fleet. */
  find(fleetId: FleetId): Promise<PluginCrew | undefined>;
  /** The fleet's last connection, with or without a crew token; none before its first. */
  binding(fleetId: FleetId): Promise<PluginBinding | undefined>;
  /** Every fleet's crew the networking plugin holds a crew token for: the fleets it is connected to. */
  connected(): Promise<PluginCrew[]>;
  save(crew: PluginCrew): Promise<void>;
  /** Forgets the fleet's crew token, keeping its binding: the networking plugin is not connected to that fleet. */
  drop(fleetId: FleetId): Promise<void>;
}

/**
 * Whether the networking plugin holds a working crew token for its ship, as
 * which ship, and the ship it was last connected as.
 */
export interface ConnectionStatus {
  state: 'not-connected' | 'connected';
  ship: { shipId: ShipId; name: string } | null;
  lastShipId: ShipId | null;
}
