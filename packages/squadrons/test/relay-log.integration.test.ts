import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaRelayLog } from '../src/adapters/prisma/relay-log.js';
import { createSquadronsDatabase } from './support/database.js';

// The relays flagships sent on to their forming ships, kept in Postgres so the
// forming ship's answer reaches the member after a restart too (decision 0017).

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const TESTER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0002';
const RELAY_MESSAGE: MessageId = 'msg_01m3tbfspe96yf1rnr4ank0100';
const MEMBER_MESSAGE: MessageId = 'msg_01m3tbfspe96yf1rnr4ank0001';
const relay = { fleetId: FLEET, squadronId: 'team-a1b2c3', relayMessageId: RELAY_MESSAGE, memberShipId: TESTER, memberMessageId: MEMBER_MESSAGE };

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = createPrismaClient(await createSquadronsDatabase());
});

afterEach(async () => {
  await prisma.$disconnect();
});

describe('the relays flagships sent on', () => {
  it('finds a relay by the message the flagship sent, once recorded', async () => {
    await createPrismaRelayLog(prisma).record(relay);

    await expect(createPrismaRelayLog(prisma).find(FLEET, RELAY_MESSAGE)).resolves.toEqual(relay);
  });

  it("finds none of another fleet's", async () => {
    await createPrismaRelayLog(prisma).record(relay);

    await expect(createPrismaRelayLog(prisma).find(OTHER_FLEET, RELAY_MESSAGE)).resolves.toBeUndefined();
  });

  it('changes nothing when one is recorded again', async () => {
    const relays = createPrismaRelayLog(prisma);
    await relays.record(relay);

    await relays.record(relay);

    await expect(relays.find(FLEET, RELAY_MESSAGE)).resolves.toEqual(relay);
  });
});
