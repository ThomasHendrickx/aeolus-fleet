import type { ShipStatus } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConnectSquadronsError, connectSquadrons, type ConnectCalls, type SquadronsConnection } from './connect-squadrons';

interface FleetShip {
  id: string;
  name: string;
  type: string;
  status: ShipStatus;
  secret: string | null;
}

/** A fleet and a squadrons process in memory, recording what connecting did. */
function fakes(start: { ships?: FleetShip[]; connection?: SquadronsConnection } = {}) {
  const state = {
    ships: start.ships ?? [],
    connection: start.connection ?? { state: 'not-connected', ship: null, lastShipId: null },
    done: new Array<string>(),
    handedOver: new Array<{ shipId: string; secret: string }>(),
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
      state.connection = { state: 'connected', ship: { shipId: ship.id, name: ship.name }, lastShipId: ship.id };
      return Promise.resolve(state.connection);
    },
    ships: () => Promise.resolve(state.ships.map(({ id, name, type, status }) => ({ id, name, type, status }))),
    commission: ({ name, type }) => {
      next += 1;
      const ship: FleetShip = { id: `shp_${String(next)}`, name, type, status: 'awaitingCrew', secret: `aeolus_sk_v1_${String(next)}` };
      state.ships.push(ship);
      state.done.push(`commission ${name}`);
      return Promise.resolve({ shipId: ship.id, crewLine: `/aeolus:crew https://fleet.example.com ${ship.id} ${String(ship.secret)}` });
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
      return Promise.resolve({ crewLine: `/aeolus:crew https://fleet.example.com ${shipId} ${ship.secret}` });
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
  it('commissions the management ship, squadrons of type squadrons, and hands its secret to squadrons', async () => {
    const { state, calls } = fakes();

    await expect(connectSquadrons(calls, newKey)).resolves.toMatchObject({ state: 'connected', ship: { name: 'squadrons' } });

    expect(state.done).toEqual(['commission squadrons']);
    expect(state.handedOver).toEqual([{ shipId: 'shp_1', secret: 'aeolus_sk_v1_1' }]);
  });

  it('does nothing while squadrons is connected', async () => {
    const connected: SquadronsConnection = { state: 'connected', ship: { shipId: 'shp_9', name: 'squadrons' }, lastShipId: 'shp_9' };
    const { state, calls } = fakes({ connection: connected });

    await expect(connectSquadrons(calls, newKey)).resolves.toEqual(connected);
    expect(state.done).toEqual([]);
  });

  it('releases the ship squadrons was last connected as, whose session is gone, and gives it a new starting prompt', async () => {
    const { state, calls } = fakes({
      ships: [{ id: 'shp_7', name: 'squadrons', type: 'squadrons', status: 'crewed', secret: null }],
      connection: { state: 'not-connected', ship: null, lastShipId: 'shp_7' },
    });

    await expect(connectSquadrons(calls, newKey)).resolves.toMatchObject({ state: 'connected', lastShipId: 'shp_7' });
    expect(state.done).toEqual(['release shp_7', 'new prompt shp_7']);
  });

  it('gives an active squadrons ship awaiting crew a new starting prompt: a connect that failed halfway is finished', async () => {
    const { state, calls } = fakes({ ships: [{ id: 'shp_3', name: 'squadrons', type: 'squadrons', status: 'awaitingCrew', secret: 'lost' }] });

    await expect(connectSquadrons(calls, newKey)).resolves.toMatchObject({ state: 'connected' });
    expect(state.done).toEqual(['new prompt shp_3']);
  });

  it('commissions a new one when the last one was retired', async () => {
    const { state, calls } = fakes({
      ships: [{ id: 'shp_7', name: 'squadrons', type: 'squadrons', status: 'retired', secret: null }],
      connection: { state: 'not-connected', ship: null, lastShipId: 'shp_7' },
    });

    await connectSquadrons(calls, newKey);

    expect(state.done).toEqual(['commission squadrons']);
  });

  it('is refused when a ship named squadrons has another type, and changes nothing', async () => {
    const { state, calls } = fakes({ ships: [{ id: 'shp_5', name: 'squadrons', type: 'reviewer', status: 'awaitingCrew', secret: null }] });

    await expect(connectSquadrons(calls, newKey)).rejects.toThrow(ConnectSquadronsError);
    expect(state.done).toEqual([]);
  });

  it('answers the connection only, never the secret', async () => {
    const { calls } = fakes();

    const answered = await connectSquadrons(calls, newKey);

    expect(JSON.stringify(answered)).not.toContain('aeolus_sk_v1');
  });
});
