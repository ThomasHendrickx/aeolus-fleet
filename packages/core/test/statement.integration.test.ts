import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ShipCaller, Crew } from '../src/domain/shared/caller.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { newKey } from '../src/testing/keys.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { withOperatorLogin } from './support/operator-login.js';

// A statement on a real Postgres: stored with the lease and read back through
// common's schema, so every field a capability may state survives the trip.

let core: PostgresCore;
let argo: ShipCaller;

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
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
  it('keeps discovery the same size as statements grow and reads current detail only on request', async () => {
    // Given a reachable ship with a small statement.
    const crm = await crewed('crm');
    unwrap(await core.useCases.setStatement(crm, { summary: 'The CRM.', capabilities: [] }));
    const before = unwrap(await core.useCases.discover(argo));
    console.info('discover before bytes', Buffer.byteLength(JSON.stringify(before)));
    // When its capabilities grow to a large statement.
    const capabilities = Array.from({ length: 47 }, (_, index) => ({ name: `tool_${index}`, inputSchema: { type: 'object', description: 'x'.repeat(4000) } }));
    unwrap(await core.useCases.setStatement(crm, { summary: 'The CRM.', capabilities }));
    const after = unwrap(await core.useCases.discover(argo));
    console.info('discover large bytes', Buffer.byteLength(JSON.stringify(after)));
    // Then only the version changes in discovery, and lookup returns complete current detail.
    expect(after.ships.find((ship) => ship.id === crm.shipId)?.statement).toEqual({ by: 'crew', version: 2, summary: 'The CRM.' });
    expect(Buffer.byteLength(JSON.stringify(after))).toBe(Buffer.byteLength(JSON.stringify(before)));
    const detail = unwrap(await core.useCases.lookup(argo, { id: crm.shipId, includeStatement: true }));
    expect(detail?.statement).toEqual({ by: 'crew', version: 2, summary: 'The CRM.', capabilities });
  });

  it("looks up the full statement with each capability's wait, deadline, repeatable mark and MCP tool annotations (interop 3.4, 5.2, 5.3)", async () => {
    const crm = await crewed('crm');
    const capability = {
      name: 'lookup_account',
      waitMs: 2000,
      deadlineMs: 60_000,
      repeatable: true,
      annotations: { readOnlyHint: true, idempotentHint: true },
    };
    unwrap(await core.useCases.setStatement(crm, { summary: 'The CRM.', capabilities: [capability] }));

    const ship = unwrap(await core.useCases.lookup(argo, { id: crm.shipId, includeStatement: true }));

    expect(ship?.statement).toEqual({ by: 'crew', version: 1, summary: 'The CRM.', capabilities: [capability] });
  });
});
