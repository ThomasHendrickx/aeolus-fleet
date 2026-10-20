import type { Scope, ShipStatus } from '@aeolus-fleet/common';

/**
 * Connecting a plugin from the console, squadrons (decision 0017), the
 * trierarch plugin (decision 0030) or the gateway (decision 0048): the web app's server commissions the
 * plugin's ship, or gives the one it had a new starting prompt, and hands its
 * secret to the plugin, server to server. The secret never leaves the one
 * request that carries it; the browser sees only the connection's new state.
 */

/** A plugin's ship: its name, type and fleet scopes. Infrastructure, fixed, never the operator's to choose. */
export interface PluginShip {
  name: string;
  type: string;
  scopes: Scope[];
}

/** Squadrons' management ship: it reads the fleet, reads on behalf of a named ship, commissions squadrons' ships and labels them for their reach. */
export const SQUADRONS_SHIP: PluginShip = { name: 'squadrons', type: 'squadrons', scopes: ['fleet:read', 'fleet:commission', 'fleet:manage', 'labels:define', 'labels:assign', 'fleet:on-behalf', 'scopes:declare'] };

/** The trierarch plugin's ship: it reads the fleet, commissions machines' ships with crew:run, assigns crew requests, labels machines (os and arch) and declares its scopes (trierarch:join, decision 0055). */
export const TRIERARCH_PLUGIN_SHIP: PluginShip = { name: 'trierarch-plugin', type: 'trierarch-plugin', scopes: ['fleet:read', 'fleet:commission', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'scopes:declare'] };

/**
 * The gateway's ship: it reads the fleet and commissions an app proxy ship for
 * each outside party argo approves, naming the owner argo picked; argo labels
 * proxy ships in the console (decisions 0044 to 0046, interop design I-5).
 */
export const GATEWAY_SHIP: PluginShip = { name: 'gateway', type: 'gateway', scopes: ['fleet:read', 'fleet:commission', 'fleet:on-behalf'] };

export interface PluginConnection {
  /** False when the plugin is off for this operator's fleet: the console then shows nothing of it. */
  isEnabled: boolean;
  state: 'not-connected' | 'connected';
  ship: { shipId: string; name: string } | null;
  lastShipId: string | null;
}

/** The calls connecting makes, each with the operator's console session; a refusal throws. */
export interface ConnectCalls {
  status(): Promise<PluginConnection>;
  connect(handOver: { shipId: string; secret: string }): Promise<PluginConnection>;
  ships(): Promise<{ id: string; name: string; type: string; status: ShipStatus }[]>;
  commission(ship: { name: string; type: string; scopes: Scope[]; idempotencyKey: string }): Promise<{ shipId: string; secret: string | null }>;
  release(shipId: string): Promise<void>;
  /** argo connects the ship as a plugin in the fleet: it reads every ship until a release or retire ends it (decision 0034). */
  connectAsPlugin(shipId: string): Promise<void>;
  startingPrompt(shipId: string): Promise<{ secret: string }>;
}

/** A refusal to show the operator as it is: it names what to do. */
export class ConnectPluginError extends Error {
  override name = 'ConnectPluginError';
}

/**
 * Connects a plugin, unless it is connected already. The ship is the one it
 * was last connected as while that is still active, else an active ship of
 * the plugin's name and type, else a new one with the plugin's scopes. A
 * crewed one is released first (its session is gone: the plugin holds no
 * token), and an existing one gets a new starting prompt, so a connect that
 * failed halfway is finished by the next one. argo then connects the ship as
 * a plugin in the fleet, after the release that would end it, and before the
 * plugin gets the secret, so it reads every ship from its first call
 * (decision 0034).
 */
export async function connectPlugin(calls: ConnectCalls, at: { ship: PluginShip; newKey: () => string }): Promise<PluginConnection> {
  const { ship: wanted, newKey } = at;
  const status = await calls.status();
  if (status.state === 'connected') {
    return status;
  }
  const active = (await calls.ships()).filter((ship) => ship.status !== 'retired');
  const last = active.find((ship) => ship.id === status.lastShipId);
  const named = active.find((ship) => ship.name === wanted.name);
  if (!last && named && named.type !== wanted.type) {
    throw new ConnectPluginError(`A ship named ${wanted.name} of another type exists: rename or retire it, then connect again`);
  }
  const ship = last ?? named;

  let shipId: string;
  let secret: string;
  if (ship) {
    if (ship.status === 'crewed') {
      await calls.release(ship.id);
    }
    shipId = ship.id;
    secret = (await calls.startingPrompt(ship.id)).secret;
  } else {
    const commissioned = await calls.commission({ name: wanted.name, type: wanted.type, scopes: wanted.scopes, idempotencyKey: newKey() });
    shipId = commissioned.shipId;
    secret = commissioned.secret ?? (await calls.startingPrompt(commissioned.shipId)).secret;
  }
  await calls.connectAsPlugin(shipId);
  return calls.connect({ shipId, secret });
}
