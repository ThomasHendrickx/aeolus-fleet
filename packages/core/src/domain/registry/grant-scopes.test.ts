import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleetWithViewer, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { Caller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: Caller;
let squadrons: Caller;
let scout: Caller;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-18T09:00:00.000Z');
  argo = operatorCaller(await initialiseFleet(core));
  registry = registryUseCases(core);
  squadrons = await shipWithScopes({ registry, argo }, { name: 'squadrons', type: 'squadrons', scopes: ['fleet:read'] });
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  unwrap(
    await registry.declareScopes(squadrons, {
      namespace: 'squadrons',
      scopes: [
        { scope: 'squadrons:form', description: 'Form a squadron' },
        { scope: 'squadrons:scale', description: 'Add and remove members' },
      ],
    }),
  );
  core.state.events.length = 0;
});

const scopesOf = (shipId: ShipId) => core.state.ships.find((ship) => ship.id === shipId)?.scopes;

/** A ship with scopes:grant beside the scopes given, as the caller its crew token resolves to. */
async function granter(scopes: Caller['scopes']): Promise<Caller> {
  const ship = await shipWithScopes({ registry, argo }, { name: 'granter', type: 'operator-assistant', scopes: [] });
  return { ...ship, scopes: [...ship.scopes, 'scopes:grant', ...scopes] };
}

describe('granting scopes on a live ship (decision 0046)', () => {
  it('lets argo grant core and plugin scopes, which the ship then holds beside its own', async () => {
    unwrap(await registry.grantScopes(argo, { shipId: scout.shipId, grant: ['fleet:read', 'squadrons:form'], revoke: [] }));

    expect(scopesOf(scout.shipId)).toEqual(['messages:send', 'messages:receive', 'fleet:read', 'squadrons:form']);
  });

  it('writes ScopesChanged on the ship, caused by the granter, naming what it added and removed', async () => {
    unwrap(await registry.grantScopes(argo, { shipId: scout.shipId, grant: ['fleet:read', 'squadrons:form'], revoke: [] }));
    unwrap(await registry.grantScopes(argo, { shipId: scout.shipId, grant: ['labels:define'], revoke: ['fleet:read'] }));

    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'ScopesChanged', occurredAt: core.clock.now(), actor: { kind: 'ship', shipId: argo.shipId }, shipId: scout.shipId, details: { added: 'fleet:read squadrons:form', removed: '' } }),
      expect.objectContaining({ type: 'ScopesChanged', shipId: scout.shipId, details: { added: 'labels:define', removed: 'fleet:read' } }),
    ]);
    expect(scopesOf(scout.shipId)).toEqual(['messages:send', 'messages:receive', 'squadrons:form', 'labels:define']);
  });

  it('changes nothing and writes no event when the ship holds what is granted and not what is revoked', async () => {
    unwrap(await registry.grantScopes(argo, { shipId: scout.shipId, grant: ['messages:send'], revoke: ['fleet:manage'] }));

    expect(scopesOf(scout.shipId)).toEqual(['messages:send', 'messages:receive']);
    expect(core.state.events).toEqual([]);
  });

  it('lets a ship grant and revoke a core scope it holds', async () => {
    const assistant = await granter(['fleet:read']);

    unwrap(await registry.grantScopes(assistant, { shipId: scout.shipId, grant: ['fleet:read'], revoke: [] }));
    unwrap(await registry.grantScopes(assistant, { shipId: scout.shipId, grant: [], revoke: ['fleet:read'] }));

    expect(scopesOf(scout.shipId)).toEqual(['messages:send', 'messages:receive']);
  });

  it.each([
    ['grant', { grant: ['fleet:manage'], revoke: [] }],
    ['revoke', { grant: [], revoke: ['fleet:manage'] }],
  ])('refuses to %s a core scope the granter lacks, naming it, and changes nothing', async (_what, change) => {
    const assistant = await granter(['fleet:read']);
    unwrap(await registry.grantScopes(argo, { shipId: scout.shipId, grant: ['fleet:manage'], revoke: [] }));
    core.state.events.length = 0;

    expect(refusalOf(await registry.grantScopes(assistant, { shipId: scout.shipId, ...change }))).toMatchObject({ kind: 'SCOPE_NOT_HELD', message: 'Your ship does not hold fleet:manage, so it cannot grant it' });
    expect(scopesOf(scout.shipId)).toEqual(['messages:send', 'messages:receive', 'fleet:manage']);
    expect(core.state.events).toEqual([]);
  });

  it("lets the declarer grant and revoke its own namespace's scopes", async () => {
    const declarer = { ...squadrons, scopes: [...squadrons.scopes, 'scopes:grant'] };

    unwrap(await registry.grantScopes(declarer, { shipId: scout.shipId, grant: ['squadrons:form', 'squadrons:scale'], revoke: [] }));
    unwrap(await registry.grantScopes(declarer, { shipId: scout.shipId, grant: [], revoke: ['squadrons:scale'] }));

    expect(scopesOf(scout.shipId)).toEqual(['messages:send', 'messages:receive', 'squadrons:form']);
  });

  it("refuses a plugin's scope to any granter but argo and its declarer, even one that holds it", async () => {
    const assistant = await granter(['squadrons:form']);

    expect(refusalOf(await registry.grantScopes(assistant, { shipId: scout.shipId, grant: ['squadrons:form'], revoke: [] }))).toMatchObject({
      kind: 'PLUGIN_SCOPE_NOT_YOURS',
      message: 'Only argo and squadrons, which declared squadrons, grant squadrons:form',
    });
    expect(scopesOf(scout.shipId)).toEqual(['messages:send', 'messages:receive']);
  });

  it.each([
    ['of a namespace no ship declared', 'builds:run'],
    ['its namespace does not declare', 'squadrons:disband'],
  ])('refuses a scope %s', async (_what, scope) => {
    expect(refusalOf(await registry.grantScopes(argo, { shipId: scout.shipId, grant: [scope], revoke: [] }))).toMatchObject({ kind: 'SCOPE_NOT_DECLARED' });
    expect(scopesOf(scout.shipId)).toEqual(['messages:send', 'messages:receive']);
  });

  it.each([
    ['a malformed scope', { grant: ['Fleet:read'], revoke: [] }],
    ['an unknown core scope', { grant: ['fleet:write'], revoke: [] }],
    ['a scope both granted and revoked', { grant: ['fleet:read'], revoke: ['fleet:read'] }],
  ])('refuses %s', async (_what, change) => {
    expect(refusalOf(await registry.grantScopes(argo, { shipId: scout.shipId, ...change }))).toMatchObject({ kind: 'INVALID_SCOPE' });
  });

  it.each(['messages:send', 'messages:receive'])('refuses to revoke %s, which every agent, person and app ship holds', async (scope) => {
    expect(refusalOf(await registry.grantScopes(argo, { shipId: scout.shipId, grant: [], revoke: [scope] }))).toMatchObject({ kind: 'BASE_SCOPE' });
    expect(scopesOf(scout.shipId)).toEqual(['messages:send', 'messages:receive']);
  });

  it("refuses to change argo's scopes, as argo holds every one", async () => {
    expect(refusalOf(await registry.grantScopes(argo, { shipId: argo.shipId, grant: [], revoke: ['fleet:manage'] }))).toMatchObject({ kind: 'SHIP_SCOPES_FIXED' });
  });

  it("refuses to change the viewer's scopes", async () => {
    const fleet = await hostedFleetWithViewer(core);
    const hostedArgo: Caller = { ...argo, fleetId: fleet.fleetId, shipId: fleet.operatorShipId };

    expect(refusalOf(await registry.grantScopes(hostedArgo, { shipId: fleet.viewerShipId, grant: ['fleet:manage'], revoke: [] }))).toMatchObject({ kind: 'SHIP_SCOPES_FIXED' });
  });

  it("refuses to change the granter's own ship's scopes", async () => {
    const assistant = await granter(['fleet:read']);

    expect(refusalOf(await registry.grantScopes(assistant, { shipId: assistant.shipId, grant: [], revoke: ['fleet:read'] }))).toMatchObject({ kind: 'OWN_SHIP_SCOPES' });
  });

  it('refuses a retired ship, and a ship the fleet does not have', async () => {
    unwrap(await registry.retireShip(argo, { shipId: scout.shipId }));

    expect(refusalOf(await registry.grantScopes(argo, { shipId: scout.shipId, grant: ['fleet:read'], revoke: [] }))).toMatchObject({ kind: 'SHIP_ALREADY_RETIRED' });
    expect(refusalOf(await registry.grantScopes(argo, { shipId: 'shp_01m56kz0000000000000000000', grant: ['fleet:read'], revoke: [] }))).toMatchObject({ kind: 'SHIP_NOT_FOUND' });
  });
});
