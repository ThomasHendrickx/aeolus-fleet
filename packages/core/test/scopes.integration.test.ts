import { SCOPES, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OPERATOR, secretOf } from './support/core-fixtures.js';
import { newKey } from './support/keys.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';

// Scopes on a real Postgres (decision 0046): a ship holds core scopes and
// plugin scopes, each <namespace>:<action>.

let core: PostgresCore;
let fleetId: FleetId;
let argoId: ShipId;

beforeEach(async () => {
  core = await createPostgresCore();
  ({ fleetId, operatorShipId: argoId } = unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
});

afterEach(async () => {
  await core.close();
});

const argo = () => ({ shipId: argoId, fleetId, kind: 'operator' as const, scopes: [...SCOPES] });

/** A commissioned ship a session claimed: its id and crew token. */
async function claimedScout(): Promise<{ shipId: ShipId; crewToken: string }> {
  const commissioned = unwrap(await core.useCases.commissionShip(argo(), { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId: commissioned.shipId, secret: secretOf(commissioned.secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  return { shipId: commissioned.shipId, crewToken };
}

describe("a ship's scopes on Postgres", () => {
  it("hold a plugin's scope beside the core ones", async () => {
    const { shipId } = await claimedScout();

    await expect(core.prisma.ship.update({ where: { id: shipId }, data: { scopes: ['messages:send', 'messages:receive', 'squadrons:form'] } })).resolves.toMatchObject({
      scopes: ['messages:send', 'messages:receive', 'squadrons:form'],
    });
  });

  it.each([
    ['a malformed scope', 'Squadrons:form'],
    ['a scope with no action', 'squadrons'],
    ['an unknown scope of a core namespace', 'fleet:write'],
  ])('refuse %s', async (_what, scope) => {
    const { shipId } = await claimedScout();

    await expect(core.prisma.ship.update({ where: { id: shipId }, data: { scopes: ['messages:send', scope] } })).rejects.toThrow(/ships_scopes_known/);
  });

  it("reach the crew's caller, a plugin's scope included, so it is checked at the next call", async () => {
    const { shipId, crewToken } = await claimedScout();
    await core.prisma.ship.update({ where: { id: shipId }, data: { scopes: ['messages:send', 'messages:receive', 'squadrons:form'] } });

    await expect(core.useCases.authenticate.byCrewToken(crewToken)).resolves.toMatchObject({ isOk: true, value: { shipId, scopes: ['messages:send', 'messages:receive', 'squadrons:form'] } });
  });
});
