/**
 * A plugin argo connected (decision 0034): its ship reads every ship of its
 * fleet, whatever the rules, until a release or a retire of the ship ends it.
 * Connecting is argo's act in the console's Connect.
 */
import type { FleetId, IdGenerator, ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type Actor, type EventLog, type NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { PluginConnectionRepository } from './ports.js';
import type { Ship } from './ship.js';

export interface PluginConnection {
  fleetId: FleetId;
  shipId: ShipId;
  connectedAt: Date;
}

/** Why a connection ended: its ship was released, or retired. */
export type PluginDisconnectedWhy = 'released' | 'retired';

export type ConnectPluginRefusal = DomainError<'NOT_AN_AGENT_SHIP' | 'SHIP_ALREADY_RETIRED'>;

/**
 * Connects the ship as a plugin, with PluginConnected: an active agent ship,
 * never argo's own or the viewer. A ship connected already changes nothing.
 */
export function connectPlugin(
  ship: Ship,
  change: { current: PluginConnection | undefined; at: Date; actor: Actor },
): Result<{ connection: PluginConnection | null; events: NewEvent[] }, ConnectPluginRefusal> {
  if (ship.kind === 'operator' || ship.kind === 'viewer') {
    return refuse('NOT_AN_AGENT_SHIP', `${ship.name} is argo's own ship or the viewer, never a plugin's`);
  }
  if (ship.retiredAt !== null) {
    return refuse('SHIP_ALREADY_RETIRED', `${ship.name} is retired: a retired ship is never connected`);
  }
  if (change.current) {
    return ok({ connection: null, events: [] });
  }
  return ok({
    connection: { fleetId: ship.fleetId, shipId: ship.id, connectedAt: change.at },
    events: [{ fleetId: ship.fleetId, type: 'PluginConnected', occurredAt: change.at, actor: change.actor, shipId: ship.id, details: {} }],
  });
}

/**
 * Ends the ship's connection, if it holds one, with PluginDisconnected saying
 * why: a release or a retire of its ship. In the caller's unit of work.
 */
export async function endPluginConnection(
  deps: { tx: { pluginConnections: PluginConnectionRepository; events: EventLog }; ids: IdGenerator },
  end: { fleetId: FleetId; shipId: ShipId; why: PluginDisconnectedWhy; at: Date; actor: Actor },
): Promise<void> {
  const { fleetId, shipId, why, at, actor } = end;
  if (!(await deps.tx.pluginConnections.find(fleetId, shipId))) {
    return;
  }
  await deps.tx.pluginConnections.disconnect(fleetId, shipId);
  await recordEvent({ events: deps.tx.events, ids: deps.ids }, { fleetId, type: 'PluginDisconnected', occurredAt: at, actor, shipId, details: { why } });
}
