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

describe('declaring scopes on Postgres', () => {
  const FORM = { scope: 'squadrons:form', description: 'Form a squadron by message' };

  /** A commissioned ship as the caller its crew token resolves to. */
  async function plugin(name: string) {
    const { shipId } = unwrap(await core.useCases.commissionShip(argo(), { idempotencyKey: newKey(), name, type: 'plugin' }));
    return { shipId, fleetId, kind: 'agent' as const, scopes: ['messages:send', 'messages:receive', 'scopes:declare'] };
  }

  it('keeps the namespace with its scopes and their descriptions in order, and writes ScopesDeclared in the same transaction', async () => {
    const squadrons = await plugin('squadrons');
    const scale = { scope: 'squadrons:scale', description: 'Add and remove members' };

    unwrap(await core.useCases.declareScopes(squadrons, { namespace: 'squadrons', scopes: [FORM, scale] }));

    await expect(core.useCases.listScopes(argo()).then((listed) => listed.at(-1))).resolves.toEqual({ namespace: 'squadrons', declaredBy: { id: squadrons.shipId, name: 'squadrons' }, scopes: [FORM, scale] });
    await expect(core.prisma.event.findMany({ where: { type: 'ScopesDeclared' }, select: { shipId: true, details: true } })).resolves.toEqual([{ shipId: squadrons.shipId, details: { namespace: 'squadrons', scopes: 2 } }]);
  });

  it('gives a namespace to one of two ships declaring it at once', async () => {
    const [first, second] = [await plugin('squadrons'), await plugin('rival')];

    const declared = await Promise.all([first, second].map((ship) => core.useCases.declareScopes(ship, { namespace: 'squadrons', scopes: [FORM] })));

    expect(declared.map((result) => (result.isOk ? 'declared' : result.error.kind)).toSorted()).toEqual(['NAMESPACE_TAKEN', 'declared']);
    await expect(core.useCases.listScopes(argo()).then((listed) => listed.slice(5).map(({ namespace }) => namespace))).resolves.toEqual(['squadrons']);
  });

  it('gives one ship one of two namespaces it declares at once', async () => {
    const squadrons = await plugin('squadrons');

    const declared = await Promise.all(['squadrons', 'fleets'].map((namespace) => core.useCases.declareScopes(squadrons, { namespace, scopes: [] })));

    expect(declared.map((result) => (result.isOk ? 'declared' : result.error.kind)).toSorted()).toEqual(['SECOND_NAMESPACE', 'declared']);
    await expect(core.useCases.listScopes(argo()).then((listed) => listed.slice(5))).resolves.toHaveLength(1);
  });

  it('refuses to remove a scope an active ship holds, and keeps the list it had', async () => {
    const squadrons = await plugin('squadrons');
    unwrap(await core.useCases.declareScopes(squadrons, { namespace: 'squadrons', scopes: [FORM] }));
    const { shipId } = await claimedScout();
    await core.prisma.ship.update({ where: { id: shipId }, data: { scopes: ['messages:send', 'messages:receive', 'squadrons:form'] } });

    await expect(core.useCases.declareScopes(squadrons, { namespace: 'squadrons', scopes: [] })).resolves.toMatchObject({ isOk: false, error: { kind: 'SCOPE_HELD' } });
    await expect(core.useCases.listScopes(argo()).then((listed) => listed.at(-1)?.scopes)).resolves.toEqual([FORM]);
  });

  it("go with their fleet when it is deleted", async () => {
    const squadrons = await plugin('squadrons');
    unwrap(await core.useCases.declareScopes(squadrons, { namespace: 'squadrons', scopes: [FORM] }));

    unwrap(await core.useCases.deleteFleet({ requestId: 'delete-home-fleet', fleetId }));

    await expect(core.prisma.scopeNamespace.count()).resolves.toBe(0);
  });
});
