import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ShipCaller, Crew } from '../src/domain/shared/caller.js';
import { OPERATOR, operatorCaller, secretOf } from './support/core-fixtures.js';
import { newKey } from '../src/testing/keys.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';

// A statement on a real Postgres: stored with the lease and read back through
// common's schema, so every field a capability may state survives the trip.

let core: PostgresCore;
let argo: ShipCaller;

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
});

afterEach(async () => {
  await core.close();
});

async function crewed(name: string): Promise<Crew> {
  const { useCases } = core;
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: name }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return unwrap(await useCases.authenticate.byCrewToken(crewToken));
}

describe('a statement on Postgres', () => {
  it("shows in discovery with each capability's wait, deadline, repeatable mark and MCP tool annotations (interop 3.4, 5.2, 5.3)", async () => {
    const crm = await crewed('crm');
    const capability = {
      name: 'lookup_account',
      waitMs: 2000,
      deadlineMs: 60_000,
      repeatable: true,
      annotations: { readOnlyHint: true, idempotentHint: true },
    };
    unwrap(await core.useCases.setStatement(crm, { summary: 'The CRM.', capabilities: [capability] }));

    const { ships } = unwrap(await core.useCases.discover(argo));

    expect(ships.find((ship) => ship.name === 'crm')?.statement).toEqual({ by: 'crew', version: 1, summary: 'The CRM.', capabilities: [capability] });
  });
});
