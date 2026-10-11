import { createServer } from 'node:http';

import { idSchema } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { createRestFleetDoor } from './rest-fleet-door.js';

/** The fleet's refusal while every pool connection is taken: nothing was stored (#542). */
const BUSY = { status: 503, body: { code: 'SERVICE_UNAVAILABLE', message: 'The fleet is busy; nothing was stored. Make the same call again (for send, with the same idempotency key).' } };

const SHIP_ID = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
const FLEET_ID = 'flt_01m3tbfspe96yf1rnr4ank9h1c';
const DELIVERY_ID = idSchema('delivery').parse('dlv_01m3tbfspe96yf1rnr4ank9h1e');

/** One call a fleet received: its path and body, and when it came. */
interface Asked {
  url: string;
  body: string;
  at: number;
}

/** A fleet that answers each call with the next of `answers`, the last one again once they run out, and records each call. */
async function aFleetAnswering(answers: readonly { status: number; body: unknown }[], run: (fleetUrl: string, asked: Asked[]) => Promise<void>): Promise<void> {
  const asked: Asked[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      asked.push({ url: request.url ?? '', body, at: Date.now() });
      const answer = answers[Math.min(asked.length, answers.length) - 1] ?? BUSY;
      response.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  try {
    await run(`http://127.0.0.1:${String(port)}`, asked);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

const whoami = { status: 200, body: { shipId: SHIP_ID, fleetId: FLEET_ID, name: 'networking-plugin', type: 'networking-plugin' } };

describe('the fleet door over REST while the fleet is busy (#610)', () => {
  it('acks again by itself with the same body while the fleet is busy', async () => {
    await aFleetAnswering([BUSY, BUSY, { status: 200, body: {} }], async (fleetUrl, asked) => {
      const acked = await createRestFleetDoor(fleetUrl, { busyWaitsMs: [1, 1, 1, 1] }).ack('aeolus_ct_v1_x', DELIVERY_ID);

      expect(acked).toMatchObject({ isOk: true });
      expect(asked.map(({ url, body }) => [url, body])).toEqual(Array.from({ length: 3 }, () => ['/api/v1/ship/ack', asked[0]?.body]));
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

  it('draws each wait between half and all of it, so callers refused together do not call again together', async () => {
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
