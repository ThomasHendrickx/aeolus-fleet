import { describe, expect, it } from 'vitest';

import { aFleetAnswering, BUSY } from '../../../test/support/fake-fleet.js';
import { createRestFleetDoor } from './rest-fleet-door.js';

const MESSAGE_ID = 'msg_01m3tbfspe96yf1rnr4ank9h1d';
const SHIP_ID = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
const FLEET_ID = 'flt_01m3tbfspe96yf1rnr4ank9h1c';

const whoami = { status: 200, body: { shipId: SHIP_ID, fleetId: FLEET_ID, name: 'squadrons', type: 'squadrons' } };

describe('the fleet door over REST while the fleet is busy (#546)', () => {
  it('sends again by itself with the same idempotency key while the fleet is busy', async () => {
    await aFleetAnswering([BUSY, BUSY, { status: 200, body: { messageId: MESSAGE_ID } }], async (fleetUrl, asked) => {
      const sent = await createRestFleetDoor(fleetUrl, { busyWaitsMs: [1, 1, 1, 1] }).send('aeolus_ct_v1_x', {
        selector: { kind: 'ship', name: 'scout' },
        payload: 'your role',
        contentType: 'text/plain',
        idempotencyKey: 'role-1',
      });

      expect(sent).toMatchObject({ isOk: true, value: { messageId: MESSAGE_ID } });
      expect(asked.map(({ url, body }) => [url, body])).toEqual(Array.from({ length: 3 }, () => ['/api/v1/ship/send', asked[0]?.body]));
      expect(JSON.parse(asked[0]?.body ?? '')).toMatchObject({ idempotencyKey: 'role-1' });
    });
  });

  it('waits longer before each next call while the fleet stays busy', async () => {
    await aFleetAnswering([BUSY, BUSY, whoami], async (fleetUrl, asked) => {
      await createRestFleetDoor(fleetUrl, { busyWaitsMs: [100, 300], random: () => 1 }).whoami('aeolus_ct_v1_x');

      const [first = 0, second = 0, third = 0] = asked.map(({ at }) => at);
      expect(second - first).toBeGreaterThanOrEqual(90);
      expect(third - second).toBeGreaterThanOrEqual(290);
    });
  });

  it('draws each wait between half and all of it, so callers refused together do not call again together (#610)', async () => {
    await aFleetAnswering([BUSY, BUSY, whoami], async (fleetUrl) => {
      const draws = [0, 1];
      const waited: number[] = [];
      await createRestFleetDoor(fleetUrl, { busyWaitsMs: [400, 400], random: () => draws.shift() ?? 0, wait: (waitMs) => {
        waited.push(waitMs);
        return Promise.resolve();
      } }).whoami('aeolus_ct_v1_x');

      expect(waited).toEqual([200, 400]);
    });
  });

  it('answers the busy refusal once every wait is spent, calling once more than it waits', async () => {
    await aFleetAnswering([BUSY], async (fleetUrl, asked) => {
      const answered = await createRestFleetDoor(fleetUrl, { busyWaitsMs: [1, 1, 1] }).whoami('aeolus_ct_v1_x');

      expect(answered).toMatchObject({ isOk: false, error: BUSY.body });
      expect(asked).toHaveLength(4);
    });
  });

  it('calls once, without waiting, on any other refusal', async () => {
    await aFleetAnswering([{ status: 401, body: { code: 'LEASE_ENDED', message: 'This ship was released' } }], async (fleetUrl, asked) => {
      await createRestFleetDoor(fleetUrl, { busyWaitsMs: [1] }).whoami('aeolus_ct_v1_x');

      expect(asked).toHaveLength(1);
    });
  });

  it('makes a busy retire once, without waiting: a bulk operation that ran past its time is not made again (#734)', async () => {
    await aFleetAnswering([BUSY, { status: 200, body: {} }], async (fleetUrl, asked) => {
      const waited: number[] = [];
      const retired = await createRestFleetDoor(fleetUrl, { busyWaitsMs: [1, 1, 1, 1], wait: (waitMs) => {
        waited.push(waitMs);
        return Promise.resolve();
      } }).retire('aeolus_ct_v1_x', { shipId: SHIP_ID });

      expect(retired).toMatchObject({ isOk: false, error: BUSY.body });
      expect(asked.map(({ url }) => url)).toEqual(['/api/v1/fleet/retire']);
      expect(waited).toEqual([]);
    });
  });

  it('ends a receive at once when it is stopped while it waits to call again', async () => {
    await aFleetAnswering([BUSY], async (fleetUrl, asked) => {
      const stopping = new AbortController();
      const ended = createRestFleetDoor(fleetUrl, { busyWaitsMs: [60_000] })
        .receive('aeolus_ct_v1_x', { signal: stopping.signal })
        .catch((error: unknown) => error);
      await expect.poll(() => asked.length).toBe(1);
      stopping.abort();

      await expect(ended).resolves.toMatchObject({ name: 'AbortError' });
      expect(asked).toHaveLength(1);
    });
  });
});
