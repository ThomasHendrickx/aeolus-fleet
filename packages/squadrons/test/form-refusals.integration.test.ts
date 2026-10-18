import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFormRefusals } from '../src/adapters/prisma/form-refusals.js';
import { createSquadronsDatabase } from '../src/testing/database.js';

// The form requests squadrons refused, kept in Postgres so a repeat of a key
// gets its first answer again, after a restart too (decision 0017).

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const TECH_LEAD: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9t00';
const OTHER_LEAD: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9t01';
const AT = new Date('2026-10-18T09:00:00.000Z');

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = createPrismaClient(await createSquadronsDatabase());
});

afterEach(async () => {
  await prisma.$disconnect();
});

describe('the form requests squadrons refused', () => {
  it('finds a refusal by its forming ship and key, once kept', async () => {
    await createPrismaFormRefusals(prisma, { now: () => AT }).keep({ fleetId: FLEET, formingShipId: TECH_LEAD, key: 'form-1', code: 'NEEDS_SCOPE', message: 'Needs squadrons:form' });

    await expect(createPrismaFormRefusals(prisma, { now: () => AT }).find(FLEET, { formingShipId: TECH_LEAD, key: 'form-1' })).resolves.toEqual({
      formingShipId: TECH_LEAD,
      key: 'form-1',
      code: 'NEEDS_SCOPE',
      message: 'Needs squadrons:form',
    });
  });

  it("finds none of another key, another ship's or another fleet's", async () => {
    const refusals = createPrismaFormRefusals(prisma, { now: () => AT });
    await refusals.keep({ fleetId: FLEET, formingShipId: TECH_LEAD, key: 'form-1', code: 'NEEDS_SCOPE', message: 'Needs squadrons:form' });

    await expect(
      Promise.all([
        refusals.find(FLEET, { formingShipId: TECH_LEAD, key: 'form-2' }),
        refusals.find(FLEET, { formingShipId: OTHER_LEAD, key: 'form-1' }),
        refusals.find(OTHER_FLEET, { formingShipId: TECH_LEAD, key: 'form-1' }),
      ]),
    ).resolves.toEqual([undefined, undefined, undefined]);
  });

  it('keeps the first refusal when one of the same key is kept again', async () => {
    const refusals = createPrismaFormRefusals(prisma, { now: () => AT });
    await refusals.keep({ fleetId: FLEET, formingShipId: TECH_LEAD, key: 'form-1', code: 'NEEDS_SCOPE', message: 'first' });

    await refusals.keep({ fleetId: FLEET, formingShipId: TECH_LEAD, key: 'form-1', code: 'FORMING_FAILED', message: 'second' });

    await expect(refusals.find(FLEET, { formingShipId: TECH_LEAD, key: 'form-1' })).resolves.toMatchObject({ code: 'NEEDS_SCOPE', message: 'first' });
  });
});
