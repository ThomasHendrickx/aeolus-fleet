import type { CommissionedShipKind, Scope, ShipKind, ShipStatus } from '@aeolus-fleet/common';

/**
 * Connecting a plugin from the console, squadrons (decision 0017), the
 * trierarch plugin (decision 0030) or the gateway (decision 0048): the web app's server commissions the
 * plugin's ship, kind plugin, whose commission is its connect (decision
 * 0050), or gives the one it had a new starting prompt, and hands its
 * secret to the plugin, server to server. An existing plugin ship is granted
 * the scopes its plugin lists that it lacks, as argo, so a ship commissioned
 * before its plugin listed a scope gets it from its next connect (#1118). The secret never leaves the one
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
 * each outside party approved, naming the owner picked; argo labels proxy
 * ships in the console (decisions 0044 to 0046, interop design I-5). It
 * declares its scope gateway:approve (0056) and writes what it checked about
 * each proxy ship as verified facts (0059). The gateway refuses to connect a
 * ship without every one of these.
 */
export const GATEWAY_SHIP: PluginShip = { name: 'gateway', type: 'gateway', scopes: ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'] };

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
  /** The fleet's ships; a ship out of the caller's read reach shows no kind and no scopes. */
  /** A ship's scopes; undefined when the fleet shows it without them, as out of the caller's read reach. */
  shipScopes(shipId: string): Promise<readonly string[] | undefined>;
  ships(): Promise<{ id: string; name: string; type: string; kind?: ShipKind; status: ShipStatus; scopes?: readonly string[] }[]>;
  /** Grants a ship scopes, writing ScopesChanged; answers every scope it holds now. */
  grantScopes(shipId: string, grant: readonly Scope[]): Promise<{ scopes: readonly string[] }>;
  commission(ship: { name: string; type: string; kind?: CommissionedShipKind; scopes: Scope[]; idempotencyKey: string }): Promise<{ shipId: string; secret: string | null }>;
  release(shipId: string): Promise<void>;
  startingPrompt(shipId: string): Promise<{ secret: string }>;
}

/** A refusal to show the operator as it is: it names what to do. */
export class ConnectPluginError extends Error {
  override name = 'ConnectPluginError';
}

/**
 * Connects a plugin, unless it is connected already. The ship is the one it
 * was last connected as while that is still active, else an active ship of
 * the plugin's name and type, kind plugin, else a new plugin ship with the
 * plugin's scopes, which reads every ship by its kind from its first call
 * (decision 0050). A crewed one is released first (its session is gone: the
 * plugin holds no token), and an existing one gets a new starting prompt, so
 * a connect that failed halfway is finished by the next one. An existing
 * one, and the one it is connected as already, is first granted every scope
 * the plugin lists that it lacks.
 */
export async function connectPlugin(calls: ConnectCalls, at: { ship: PluginShip; newKey: () => string }): Promise<PluginConnection> {
  const { ship: wanted, newKey } = at;
  const status = await calls.status();
  const ships = await calls.ships();
  if (status.state === 'connected') {
    const connected = ships.find((ship) => ship.id === status.ship?.shipId);
    if (connected) {
      await grantMissingScopes(calls, { ship: connected, wanted });
    }
    return status;
  }
  const active = ships.filter((ship) => ship.status !== 'retired');
  const last = active.find((ship) => ship.id === status.lastShipId);
  const named = active.find((ship) => ship.name === wanted.name);
  if (!last && named && named.type !== wanted.type) {
    throw new ConnectPluginError(`A ship named ${wanted.name} of another type exists: rename or retire it, then connect again`);
  }
  const ship = last ?? named;
  if (ship && ship.kind !== 'plugin') {
    throw new ConnectPluginError(`The ship ${ship.name} is not kind plugin: retire it, then connect again`);
  }

  let shipId: string;
  let secret: string;
  if (ship) {
    if (ship.status === 'crewed') {
      await calls.release(ship.id);
    }
    await grantMissingScopes(calls, { ship, wanted });
    shipId = ship.id;
    secret = (await calls.startingPrompt(ship.id)).secret;
  } else {
    const commissioned = await calls.commission({ name: wanted.name, type: wanted.type, kind: 'plugin', scopes: wanted.scopes, idempotencyKey: newKey() });
    shipId = commissioned.shipId;
    secret = commissioned.secret ?? (await calls.startingPrompt(commissioned.shipId)).secret;
  }
  return calls.connect({ shipId, secret });
}

/**
 * The scopes the plugin lists that its connected ship lacks, for Settings to
 * name and offer to grant with a connect (#1226): none while not connected,
 * and none when the fleet shows the ship without its scopes or does not
 * answer for it, claiming no lack it cannot see.
 */
export async function missingScopesOf(calls: Pick<ConnectCalls, 'shipScopes'>, at: { connection: PluginConnection; wanted: PluginShip }): Promise<Scope[]> {
  const { connection, wanted } = at;
  if (connection.state !== 'connected' || connection.ship === null) {
    return [];
  }
  // The connection gates the plugin's pages: a ship the fleet does not answer for is a lack it cannot see, not a failed read.
  const held = await calls.shipScopes(connection.ship.shipId).catch(() => undefined);
  return held === undefined ? [] : wanted.scopes.filter((scope) => !held.includes(scope));
}

async function grantMissingScopes(calls: ConnectCalls, at: { ship: { id: string; scopes?: readonly string[] }; wanted: PluginShip }): Promise<void> {
  const held = at.ship.scopes ?? [];
  const missing = at.wanted.scopes.filter((scope) => !held.includes(scope));
  if (missing.length > 0) {
    await calls.grantScopes(at.ship.id, missing);
  }
}
