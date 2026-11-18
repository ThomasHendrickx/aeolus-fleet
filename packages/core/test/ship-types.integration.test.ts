import { idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaFleetListing } from '../src/adapters/prisma/registry.js';
import { unwrap } from '../src/testing/result.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { withOperatorLogin } from './support/operator-login.js';

let core: PostgresCore;
let fleetId: FleetId;
let near: ShipId;

beforeAll(async () => {
  core = await createPostgresCore();
  fleetId = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))).fleetId;
  const otherFleet = idSchema('fleet').parse('flt_00000000000000000000000001');
  await core.prisma.fleet.create({ data: { id: otherFleet, name: 'other fleet', createdAt: core.clock.now() } });
  near = idSchema('ship').parse('shp_00000000000000000000000001');
  await core.prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes, retired_at) VALUES
      (${near}, ${fleetId}, 'near', 'reviewer', now(), 'agent', '{}', NULL),
      ('shp_00000000000000000000000002', ${fleetId}, 'far', 'keeper', now(), 'agent', '{}', NULL),
      ('shp_00000000000000000000000003', ${fleetId}, 'old', 'archivist', now(), 'agent', '{}', now()),
      ('shp_00000000000000000000000004', ${otherFleet}, 'other', 'foreign', now(), 'agent', '{}', NULL)`;
}, 120_000);

afterAll(async () => {
  await core.close();
});

describe("the fleet's ship types in Postgres", () => {
  it('includes retired types only when retired is asked', async () => {
    const listing = createPrismaFleetListing(core.prisma);
    const reach = { kind: 'every' } as const;

    const active = await listing.types(fleetId, { reach, status: ['awaitingCrew', 'crewed'] });
    const all = await listing.types(fleetId, { reach, status: ['awaitingCrew', 'crewed', 'retired'] });
    const retired = await listing.types(fleetId, { reach, status: ['retired'] });

    expect(active.map(({ type }) => type)).toEqual(['keeper', 'operator', 'reviewer']);
    expect(all.map(({ type }) => type)).toEqual(['archivist', 'keeper', 'operator', 'reviewer']);
    expect(retired.map(({ type }) => type)).toEqual(['archivist']);
  });

  it('answers only types of ships in read reach', async () => {
    const listing = createPrismaFleetListing(core.prisma);

    const types = await listing.types(fleetId, { reach: { kind: 'some', shipIds: new Set([near]), types: new Set() }, status: ['awaitingCrew', 'crewed'] });

    expect(types).toEqual([{ type: 'reviewer', ships: 1 }]);
  });

  it('never answers types from another fleet', async () => {
    const listing = createPrismaFleetListing(core.prisma);

    const types = await listing.types(fleetId, { reach: { kind: 'every' }, status: ['awaitingCrew', 'crewed', 'retired'] });

    expect(types.map(({ type }) => type)).toEqual(['archivist', 'keeper', 'operator', 'reviewer']);
  });
});
