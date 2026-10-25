import type { ShipKind, ShipStatus } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConnectPluginError, connectPlugin, GATEWAY_SHIP, missingScopesOf, SQUADRONS_SHIP, TRIERARCH_PLUGIN_SHIP, type ConnectCalls, type PluginConnection } from './connect-plugin';

interface FleetShip {
  id: string;
  name: string;
  type: string;
  kind: ShipKind;
  status: ShipStatus;
  secret: string | null;
  scopes: readonly string[];
}

/** A fleet and a squadrons process in memory, recording what connecting did. */
function fakes(start: { ships?: FleetShip[]; connection?: PluginConnection } = {}) {
  const state = {
    ships: start.ships ?? [],
    connection: start.connection ?? { isEnabled: true, state: 'not-connected', ship: null, lastShipId: null },
    done: new Array<string>(),
    handedOver: new Array<{ shipId: string; secret: string }>(),
    scopes: new Array<readonly string[]>(),
    /** Each commissioned ship's kind as the fleet takes it: agent when none is given. */
    kinds: new Array<ShipKind>(),
  };
  let next = 0;
  const calls: ConnectCalls = {
    status: () => Promise.resolve(state.connection),
    connect: (handOver) => {
      state.handedOver.push(handOver);
      const ship = state.ships.find((each) => each.id === handOver.shipId && each.secret === handOver.secret);
      if (!ship) {
        return Promise.reject(new Error('BAD_REQUEST'));
      }
      ship.status = 'crewed';
      state.connection = { isEnabled: true, state: 'connected', ship: { shipId: ship.id, name: ship.name }, lastShipId: ship.id };
      return Promise.resolve(state.connection);
    },
    shipScopes: (shipId) => Promise.resolve(state.ships.find((each) => each.id === shipId)?.scopes),
    ships: () => Promise.resolve(state.ships.map(({ id, name, type, kind, status, scopes }) => ({ id, name, type, kind, status, scopes }))),
    grantScopes: (shipId, grant) => {
      const ship = state.ships.find((each) => each.id === shipId);
      if (!ship) {
        return Promise.reject(new Error('NOT_FOUND'));
      }
      ship.scopes = [...ship.scopes, ...grant.filter((scope) => !ship.scopes.includes(scope))];
      state.done.push(`grant ${shipId} ${grant.join(' ')}`);
      return Promise.resolve({ scopes: ship.scopes });
    },
    commission: ({ name, type, scopes, kind }) => {
      state.scopes.push(scopes);
      state.kinds.push(kind ?? 'agent');
      next += 1;
      const ship: FleetShip = { id: `shp_${String(next)}`, name, type, kind: kind ?? 'agent', status: 'awaitingCrew', secret: `aeolus_sk_v1_${String(next)}`, scopes };
      state.ships.push(ship);
      state.done.push(`commission ${name}`);
      return Promise.resolve({ shipId: ship.id, secret: ship.secret });
    },
    release: (shipId) => {
      const ship = state.ships.find((each) => each.id === shipId);
      if (ship) {
        ship.status = 'awaitingCrew';
        ship.secret = null;
      }
      state.done.push(`release ${shipId}`);
      return Promise.resolve();
    },
    startingPrompt: (shipId) => {
      const ship = state.ships.find((each) => each.id === shipId);
      if (!ship) {
        return Promise.reject(new Error('NOT_FOUND'));
      }
      ship.secret = `aeolus_sk_v1_new-${shipId}`;
      state.done.push(`new prompt ${shipId}`);
      return Promise.resolve({ secret: ship.secret });
    },
  };
  return { state, calls };
}

let key = 0;
const newKey = () => {
  key += 1;
  return `connect-${String(key)}`;
};

beforeEach(() => {
  key = 0;
});

describe('connecting squadrons from the console', () => {
  it('commissions the management ship with the label scopes, so squadrons labels its squadrons and declares their reach (#573), and fleet:on-behalf, so it reads on behalf of a named ship', async () => {
    const { state, calls } = fakes();

    await connectPlugin(calls, { ship: SQUADRONS_SHIP, newKey });

    expect(state.scopes).toEqual([['fleet:read', 'fleet:commission', 'fleet:manage', 'labels:define', 'labels:assign', 'fleet:on-behalf', 'scopes:declare']]);
  });

  it('commissions the management ship, squadrons of type squadrons, and hands its secret to squadrons', async () => {
    const { state, calls } = fakes();

    await expect(connectPlugin(calls, { ship: SQUADRONS_SHIP, newKey })).resolves.toMatchObject({ isEnabled: true, state: 'connected', ship: { name: 'squadrons' } });

    expect(state.done).toEqual(['commission squadrons']);
    expect(state.handedOver).toEqual([{ shipId: 'shp_1', secret: 'aeolus_sk_v1_1' }]);
  });

  it('does nothing while squadrons is connected', async () => {
    const connected: PluginConnection = { isEnabled: true, state: 'connected', ship: { shipId: 'shp_9', name: 'squadrons' }, lastShipId: 'shp_9' };
    const { state, calls } = fakes({ connection: connected });

    await expect(connectPlugin(calls, { ship: SQUADRONS_SHIP, newKey })).resolves.toEqual(connected);
    expect(state.done).toEqual([]);
  });

  it('releases the ship squadrons was last connected as, whose session is gone, and gives it a new starting prompt', async () => {
    const { state, calls } = fakes({
      ships: [{ id: 'shp_7', name: 'squadrons', type: 'squadrons', kind: 'plugin', status: 'crewed', secret: null, scopes: SQUADRONS_SHIP.scopes }],
      connection: { isEnabled: true, state: 'not-connected', ship: null, lastShipId: 'shp_7' },
    });

    await expect(connectPlugin(calls, { ship: SQUADRONS_SHIP, newKey })).resolves.toMatchObject({ isEnabled: true, state: 'connected', lastShipId: 'shp_7' });
    expect(state.done).toEqual(['release shp_7', 'new prompt shp_7']);
  });

  it('gives an active squadrons ship awaiting crew a new starting prompt: a connect that failed halfway is finished', async () => {
    const { state, calls } = fakes({ ships: [{ id: 'shp_3', name: 'squadrons', type: 'squadrons', kind: 'plugin', status: 'awaitingCrew', secret: 'lost', scopes: SQUADRONS_SHIP.scopes }] });

    await expect(connectPlugin(calls, { ship: SQUADRONS_SHIP, newKey })).resolves.toMatchObject({ isEnabled: true, state: 'connected' });
    expect(state.done).toEqual(['new prompt shp_3']);
  });

  it('commissions a new one when the last one was retired', async () => {
    const { state, calls } = fakes({
      ships: [{ id: 'shp_7', name: 'squadrons', type: 'squadrons', kind: 'plugin', status: 'retired', secret: null, scopes: SQUADRONS_SHIP.scopes }],
      connection: { isEnabled: true, state: 'not-connected', ship: null, lastShipId: 'shp_7' },
    });

    await connectPlugin(calls, { ship: SQUADRONS_SHIP, newKey });

    expect(state.done).toEqual(['commission squadrons']);
  });

  it('is refused when the active squadrons ship is not kind plugin, naming what to do, and changes nothing (decision 0050)', async () => {
    const { state, calls } = fakes({ ships: [{ id: 'shp_5', name: 'squadrons', type: 'squadrons', kind: 'agent', status: 'awaitingCrew', secret: null, scopes: [] }] });

    await expect(connectPlugin(calls, { ship: SQUADRONS_SHIP, newKey })).rejects.toThrow('The ship squadrons is not kind plugin: retire it, then connect again');
    expect(state.done).toEqual([]);
  });

  it('is refused when a ship named squadrons has another type, and changes nothing', async () => {
    const { state, calls } = fakes({ ships: [{ id: 'shp_5', name: 'squadrons', type: 'reviewer', kind: 'agent', status: 'awaitingCrew', secret: null, scopes: [] }] });

    await expect(connectPlugin(calls, { ship: SQUADRONS_SHIP, newKey })).rejects.toThrow(ConnectPluginError);
    expect(state.done).toEqual([]);
  });

  it('answers the connection only, never the secret', async () => {
    const { calls } = fakes();

    const answered = await connectPlugin(calls, { ship: SQUADRONS_SHIP, newKey });

    expect(JSON.stringify(answered)).not.toContain('aeolus_sk_v1');
  });
});

describe('connecting the trierarch plugin from the console', () => {
  it('commissions trierarch-plugin of type trierarch-plugin, which reads the fleet, commissions machines with crew:run, which it holds, assigns crew requests, labels machines and declares its scopes', async () => {
    const { state, calls } = fakes();

    await expect(connectPlugin(calls, { ship: TRIERARCH_PLUGIN_SHIP, newKey })).resolves.toMatchObject({ state: 'connected', ship: { name: 'trierarch-plugin' } });

    expect(state.done).toEqual(['commission trierarch-plugin']);
    expect(state.scopes).toEqual([['fleet:read', 'fleet:commission', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'scopes:declare']]);
  });

  it('is refused when a ship named trierarch-plugin has another type', async () => {
    const { calls } = fakes({ ships: [{ id: 'shp_5', name: 'trierarch-plugin', type: 'reviewer', kind: 'agent', status: 'awaitingCrew', secret: null, scopes: [] }] });

    await expect(connectPlugin(calls, { ship: TRIERARCH_PLUGIN_SHIP, newKey })).rejects.toThrow('A ship named trierarch-plugin of another type exists');
  });
});

describe('connecting the gateway from the console', () => {
  it("commissions gateway with every scope the gateway's connect checks for: fleet:read, fleet:commission and fleet:on-behalf for app proxy ships with the owner argo picked, scopes:declare for gateway:approve, and fleet:verify for its verified facts (decisions 0044, 0045, 0056, 0059)", async () => {
    const { calls, state } = fakes();

    await expect(connectPlugin(calls, { ship: GATEWAY_SHIP, newKey })).resolves.toMatchObject({ state: 'connected', ship: { name: 'gateway' } });

    expect(state.done).toEqual(['commission gateway']);
    expect(state.scopes).toEqual([['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify']]);
  });

});

describe("a plugin's ship kind (decision 0050)", () => {
  it.each([
    ['squadrons', SQUADRONS_SHIP],
    ['the trierarch plugin', TRIERARCH_PLUGIN_SHIP],
    ['the gateway', GATEWAY_SHIP],
  ])('commissions %s as a plugin ship: its commission is its connect, and it reads every ship by its kind', async (_plugin, ship) => {
    const { calls, state } = fakes();

    await connectPlugin(calls, { ship, newKey });

    expect(state.kinds).toEqual(['plugin']);
  });
});

describe("an existing plugin ship holds every scope its plugin's ship lists (#1118)", () => {
  /** The trierarch plugin's ship as commissioned before it listed scopes:declare. */
  const BEFORE_SCOPES_DECLARE = ['fleet:read', 'fleet:commission', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign'];

  it('grants a reused trierarch-plugin ship the scopes it lacks before handing over its new starting prompt', async () => {
    const { state, calls } = fakes({ ships: [{ id: 'shp_3', name: 'trierarch-plugin', type: 'trierarch-plugin', kind: 'plugin', status: 'awaitingCrew', secret: 'lost', scopes: BEFORE_SCOPES_DECLARE }] });

    await expect(connectPlugin(calls, { ship: TRIERARCH_PLUGIN_SHIP, newKey })).resolves.toMatchObject({ state: 'connected' });

    expect(state.done).toEqual(['grant shp_3 scopes:declare', 'new prompt shp_3']);
  });

  it('grants the connected trierarch-plugin ship the scopes it lacks, and answers the connection as it stands', async () => {
    const connected: PluginConnection = { isEnabled: true, state: 'connected', ship: { shipId: 'shp_4', name: 'trierarch-plugin' }, lastShipId: 'shp_4' };
    const { state, calls } = fakes({
      ships: [{ id: 'shp_4', name: 'trierarch-plugin', type: 'trierarch-plugin', kind: 'plugin', status: 'crewed', secret: null, scopes: BEFORE_SCOPES_DECLARE }],
      connection: connected,
    });

    await expect(connectPlugin(calls, { ship: TRIERARCH_PLUGIN_SHIP, newKey })).resolves.toEqual(connected);

    expect(state.done).toEqual(['grant shp_4 scopes:declare']);
    expect(state.ships[0]?.scopes).toEqual(['fleet:read', 'fleet:commission', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'scopes:declare']);
  });

  it('grants nothing to a connected ship that holds every scope, and more', async () => {
    const connected: PluginConnection = { isEnabled: true, state: 'connected', ship: { shipId: 'shp_4', name: 'gateway' }, lastShipId: 'shp_4' };
    const { state, calls } = fakes({
      ships: [{ id: 'shp_4', name: 'gateway', type: 'gateway', kind: 'plugin', status: 'crewed', secret: null, scopes: ['messages:send', ...GATEWAY_SHIP.scopes] }],
      connection: connected,
    });

    await connectPlugin(calls, { ship: GATEWAY_SHIP, newKey });

    expect(state.done).toEqual([]);
  });

  it.each([
    ['squadrons', SQUADRONS_SHIP],
    ['the trierarch plugin', TRIERARCH_PLUGIN_SHIP],
    ['the gateway', GATEWAY_SHIP],
  ])('grants %s every scope it lists to a reused ship that holds none, and to its connected ship', async (_plugin, wanted) => {
    const reused = fakes({ ships: [{ id: 'shp_3', name: wanted.name, type: wanted.type, kind: 'plugin', status: 'crewed', secret: null, scopes: [] }] });
    await connectPlugin(reused.calls, { ship: wanted, newKey });
    expect(reused.state.ships[0]?.scopes).toEqual(wanted.scopes);

    const connected = fakes({
      ships: [{ id: 'shp_4', name: wanted.name, type: wanted.type, kind: 'plugin', status: 'crewed', secret: null, scopes: [] }],
      connection: { isEnabled: true, state: 'connected', ship: { shipId: 'shp_4', name: wanted.name }, lastShipId: 'shp_4' },
    });
    await connectPlugin(connected.calls, { ship: wanted, newKey });
    expect(connected.state.ships[0]?.scopes).toEqual(wanted.scopes);
  });
});

describe("a connected plugin's ship missing a scope its plugin lists, as Settings shows it (#1226)", () => {
  /** The trierarch plugin's ship as commissioned before it listed scopes:declare. */
  const BEFORE_SCOPES_DECLARE = ['fleet:read', 'fleet:commission', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign'];
  const connected: PluginConnection = { isEnabled: true, state: 'connected', ship: { shipId: 'shp_4', name: 'trierarch-plugin' }, lastShipId: 'shp_4' };
  const connectedShip = (scopes: readonly string[]): FleetShip => ({ id: 'shp_4', name: 'trierarch-plugin', type: 'trierarch-plugin', kind: 'plugin', status: 'crewed', secret: null, scopes });

  it('names the scopes the plugin lists that its connected ship lacks', async () => {
    const { calls } = fakes({ ships: [connectedShip(BEFORE_SCOPES_DECLARE)], connection: connected });

    await expect(missingScopesOf(calls, { connection: connected, wanted: TRIERARCH_PLUGIN_SHIP })).resolves.toEqual(['scopes:declare']);
  });

  it('names none once connecting again granted them', async () => {
    const { calls } = fakes({ ships: [connectedShip(BEFORE_SCOPES_DECLARE)], connection: connected });

    const connection = await connectPlugin(calls, { ship: TRIERARCH_PLUGIN_SHIP, newKey });

    await expect(missingScopesOf(calls, { connection, wanted: TRIERARCH_PLUGIN_SHIP })).resolves.toEqual([]);
  });

  it('names none for a connected ship that holds every scope, and more', async () => {
    const { calls } = fakes({ ships: [connectedShip(['messages:send', ...TRIERARCH_PLUGIN_SHIP.scopes])], connection: connected });

    await expect(missingScopesOf(calls, { connection: connected, wanted: TRIERARCH_PLUGIN_SHIP })).resolves.toEqual([]);
  });

  it('names none while the plugin is not connected, and reads no ship', async () => {
    const notConnected: PluginConnection = { isEnabled: true, state: 'not-connected', ship: null, lastShipId: 'shp_4' };
    const { calls } = fakes({ ships: [connectedShip([])], connection: notConnected });

    await expect(missingScopesOf(calls, { connection: notConnected, wanted: TRIERARCH_PLUGIN_SHIP })).resolves.toEqual([]);
  });

  it("names none when the fleet does not answer for the ship, so the connection still shows and the plugin's pages stay", async () => {
    const { calls } = fakes({ connection: connected });
    const failing = { shipScopes: () => Promise.reject(new Error('NOT_FOUND')) };

    await expect(missingScopesOf({ ...calls, ...failing }, { connection: connected, wanted: TRIERARCH_PLUGIN_SHIP })).resolves.toEqual([]);
  });

  it('names none when the fleet shows the ship without its scopes, as out of read reach: it claims no lack it cannot see', async () => {
    const { calls } = fakes({ connection: connected });

    await expect(missingScopesOf(calls, { connection: connected, wanted: TRIERARCH_PLUGIN_SHIP })).resolves.toEqual([]);
  });
});
