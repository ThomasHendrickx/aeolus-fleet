import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  addAgentShip,
  initialiseFleet,
  operatorCaller,
  registryUseCases,
  secretOf,
  withInstallationSettings,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import { createCommissionShip } from './commission-ship.js';
import type { Ship } from './ship.js';
import { newKey } from '../../testing/keys.js';

let core: InMemoryCore;
let fleetId: FleetId;
let argoId: ShipId;
let argo: ShipCaller;
let commissionShip: ReturnType<typeof registryUseCases>['commissionShip'];

beforeEach(async () => {
  core = createInMemoryCore('2026-09-29T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
  ({ commissionShip } = registryUseCases(core));
  core.state.events.length = 0;
});

function shipsNamed(name: string): Ship[] {
  return core.state.ships.filter((ship) => ship.name === name);
}

describe('commissioning a ship', () => {
  it('creates an agent ship with the scopes messages:send and messages:receive, awaiting crew', async () => {
    const { shipId } = unwrap(
      await commissionShip(argo, { name: 'scout', type: 'reviewer', note: 'reviews pull requests', idempotencyKey: 'commission-scout' }),
    );

    expect(shipsNamed('scout')).toEqual([
      {
        id: shipId,
        fleetId,
        name: 'scout',
        type: 'reviewer',
        kind: 'agent',
        scopes: ['messages:send', 'messages:receive'],
        note: 'reviews pull requests',
        createdAt: new Date('2026-09-29T12:00:00.000Z'),
        retiredAt: null,
        // The hash itself is the repeat tests' concern; here, that it is kept with the key.
        commission: { by: argoId, idempotencyKey: 'commission-scout', requestHash: shipsNamed('scout')[0]?.commission?.requestHash ?? 'none' },
        owner: argoId,
      },
    ]);
    expect(core.state.leases.filter((lease) => lease.shipId === shipId)).toEqual([]);
  });

  it('stores no note when none is given', async () => {
    unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    expect(shipsNamed('scout')[0]?.note).toBeNull();
  });

  it('issues the first starting prompt: a new secret for the ship', async () => {
    const commissioned = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    expect(commissioned.secret).toMatch(/^aeolus_sk_v1_./);
  });

  it('stores the secret only as its hash, valid and not yet claimed', async () => {
    const commissioned = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const { shipId } = commissioned;
    const secret = secretOf(commissioned.secret);

    expect(core.state.credentials.filter((credential) => credential.shipId === shipId)).toEqual([
      expect.objectContaining({
        fleetId,
        secretHash: core.hasher.hash(secret),
        issuedAt: core.clock.now(),
        claimedAt: null,
        invalidatedAt: null,
      }),
    ]);
    expect(JSON.stringify(core.state)).not.toContain(`"${secret}"`);
  });

  it('writes ShipCommissioned, OwnerSet and StartingPromptIssued, caused by the commissioning ship', async () => {
    const { shipId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const credential = core.state.credentials.find((held) => held.shipId === shipId);

    expect(core.state.events).toEqual([
      expect.objectContaining({
        fleetId,
        type: 'ShipCommissioned',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: argoId },
        shipId,
        details: { name: 'scout', type: 'reviewer', kind: 'agent', scopes: 'messages:send messages:receive' },
      }),
      expect.objectContaining({ type: 'OwnerSet', actor: { kind: 'ship', shipId: argoId }, shipId, details: { ownerShipId: argoId, how: 'argoByDefault' } }),
      expect.objectContaining({
        fleetId,
        type: 'StartingPromptIssued',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: argoId },
        shipId,
        details: { credentialId: credential?.id },
      }),
    ]);
  });
});

describe('the scopes of a new ship', () => {
  function scopesOf(name: string) {
    return shipsNamed(name)[0]?.scopes;
  }

  it('adds fleet:read to the scopes every agent ship has', async () => {
    unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'watcher', type: 'squadron', scopes: ['fleet:read'] }));

    expect(scopesOf('watcher')).toEqual(['messages:send', 'messages:receive', 'fleet:read']);
  });

  it('adds fleet:read and fleet:manage, in their fixed order, each once', async () => {
    unwrap(
      await commissionShip(argo, { idempotencyKey: newKey(),
        name: 'manager',
        type: 'squadron',
        scopes: ['fleet:manage', 'fleet:read', 'fleet:manage'],
      }),
    );

    expect(scopesOf('manager')).toEqual(['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage']);
  });

  it('adds crew:assign and crew:run, after the fleet scopes (decision 0029)', async () => {
    unwrap(
      await commissionShip(argo, { idempotencyKey: newKey(), name: 'mac-mini', type: 'trierarch', scopes: ['crew:run', 'crew:assign', 'fleet:read'] }),
    );

    expect(scopesOf('mac-mini')).toEqual(['messages:send', 'messages:receive', 'fleet:read', 'crew:assign', 'crew:run']);
  });

  it('writes the scopes in ShipCommissioned', async () => {
    const { shipId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'manager', type: 'squadron', scopes: ['fleet:manage'] }));

    expect(core.state.events.find((event) => event.type === 'ShipCommissioned' && event.shipId === shipId)?.details).toMatchObject({
      scopes: 'messages:send messages:receive fleet:manage',
    });
  });

});

describe('what a commission may grant (decision 0046)', () => {
  const FORM = { scope: 'squadrons:form', description: 'Form a squadron by message' };

  function scopesOf(name: string) {
    return shipsNamed(name)[0]?.scopes;
  }

  async function shipCommissionedByArgo(name: string, scopes: string[]): Promise<ShipCaller> {
    const { shipId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name, type: 'squadron', scopes }));
    return { fleetId, shipId, kind: 'agent', scopes: [] };
  }

  it('lets a ship commission a ship with core scopes its own ship holds', async () => {
    const manager = await shipCommissionedByArgo('manager', ['fleet:read', 'fleet:manage']);

    unwrap(await commissionShip(manager, { idempotencyKey: newKey(), name: 'deputy', type: 'squadron', scopes: ['fleet:manage'] }));

    expect(scopesOf('deputy')).toEqual(['messages:send', 'messages:receive', 'fleet:manage']);
  });

  it('refuses a core scope the commissioner does not hold, naming it, and stores nothing', async () => {
    const manager = await shipCommissionedByArgo('manager', ['fleet:manage']);
    core.state.events.length = 0;

    const refused = await commissionShip(manager, { idempotencyKey: newKey(), name: 'deputy', type: 'squadron', scopes: ['fleet:manage', 'crew:run'] });

    expect(refused).toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_HELD', message: 'Your ship does not hold crew:run, so it cannot grant it' } });
    expect(shipsNamed('deputy')).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it('reads what the commissioner holds from the fleet, not from its call', async () => {
    const manager = await shipCommissionedByArgo('manager', ['fleet:manage']);

    const refused = await commissionShip({ ...manager, scopes: ['fleet:manage', 'fleet:read'] }, { idempotencyKey: newKey(), name: 'deputy', type: 'squadron', scopes: ['fleet:read'] });

    expect(refused).toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_HELD' } });
  });

  it('lets argo grant any core scope', async () => {
    unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'herald', type: 'squadron', scopes: ['scopes:grant', 'messages:force'] }));

    expect(scopesOf('herald')).toEqual(['messages:send', 'messages:receive', 'messages:force', 'scopes:grant']);
  });

  it('lets the declarer grant a scope of its own namespace, after the core scopes', async () => {
    const squadrons = await shipCommissionedByArgo('squadrons', ['fleet:manage', 'scopes:declare']);
    unwrap(await registryUseCases(core).declareScopes(squadrons, { namespace: 'squadrons', scopes: [FORM] }));

    unwrap(await commissionShip(squadrons, { idempotencyKey: newKey(), name: 'former', type: 'reviewer', scopes: ['squadrons:form', 'fleet:manage'] }));

    expect(scopesOf('former')).toEqual(['messages:send', 'messages:receive', 'fleet:manage', 'squadrons:form']);
  });

  it('lets argo grant a declared plugin scope', async () => {
    const squadrons = await shipCommissionedByArgo('squadrons', ['scopes:declare']);
    unwrap(await registryUseCases(core).declareScopes(squadrons, { namespace: 'squadrons', scopes: [FORM] }));

    unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'former', type: 'reviewer', scopes: ['squadrons:form'] }));

    expect(scopesOf('former')).toEqual(['messages:send', 'messages:receive', 'squadrons:form']);
  });

  it('refuses a plugin scope from a ship that did not declare its namespace, naming the declarer, and stores nothing', async () => {
    const squadrons = await shipCommissionedByArgo('squadrons', ['scopes:declare']);
    unwrap(await registryUseCases(core).declareScopes(squadrons, { namespace: 'squadrons', scopes: [FORM] }));
    const manager = await shipCommissionedByArgo('manager', ['fleet:manage']);

    const refused = await commissionShip(manager, { idempotencyKey: newKey(), name: 'former', type: 'reviewer', scopes: ['squadrons:form'] });

    expect(refused).toMatchObject({
      isOk: false,
      error: { kind: 'PLUGIN_SCOPE_NOT_YOURS', message: 'Only argo and squadrons, which declared squadrons, grant squadrons:form' },
    });
    expect(shipsNamed('former')).toEqual([]);
  });

  it('refuses a plugin scope no plugin declared, even from argo, and stores nothing', async () => {
    const refused = await commissionShip(argo, { idempotencyKey: newKey(), name: 'former', type: 'reviewer', scopes: ['squadrons:form'] });

    expect(refused).toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_DECLARED' } });
    expect(shipsNamed('former')).toEqual([]);
  });

  it('refuses a malformed scope', async () => {
    const refused = await commissionShip(argo, { idempotencyKey: newKey(), name: 'former', type: 'reviewer', scopes: ['Squadrons:form'] });

    expect(refused).toMatchObject({ isOk: false, error: { kind: 'INVALID_SCOPE' } });
  });

  it('takes sending and receiving, which every ship holds, once', async () => {
    const manager = await shipCommissionedByArgo('manager', ['fleet:manage']);

    unwrap(await commissionShip(manager, { idempotencyKey: newKey(), name: 'deputy', type: 'squadron', scopes: ['messages:send'] }));

    expect(scopesOf('deputy')).toEqual(['messages:send', 'messages:receive']);
  });
});

describe('the kind of a new ship', () => {
  function manager(): ShipCaller {
    return { ...argo, shipId: shipsNamed('manager')[0]?.id ?? argo.shipId, kind: 'agent' };
  }

  beforeEach(async () => {
    unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'manager', type: 'squadron', scopes: ['fleet:manage'] }));
  });

  it('is an agent when the commission states none', async () => {
    unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    expect(shipsNamed('scout')[0]?.kind).toBe('agent');
  });

  it.each(['person', 'app'] as const)('lets argo commission a %s ship, awaiting crew with its starting prompt and the scopes every ship has', async (kind) => {
    const commissioned = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind }));

    expect(shipsNamed('thomas')[0]).toMatchObject({ kind, scopes: ['messages:send', 'messages:receive'] });
    expect(commissioned.secret).toMatch(/^aeolus_sk_v1_./);
    expect(core.state.events.find((event) => event.type === 'ShipCommissioned' && event.shipId === commissioned.shipId)?.details).toMatchObject({ kind });
  });

  it.each(['person', 'app'] as const)('refuses any other ship a %s ship, storing nothing', async (kind) => {
    const refused = await commissionShip(manager(), { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind });

    expect(refused).toMatchObject({ isOk: false, error: { kind: 'KIND_COMMISSIONED_BY_ARGO_ONLY' } });
    expect(shipsNamed('thomas')).toEqual([]);
  });

  it('lets a ship with fleet:manage commission an agent ship by its kind', async () => {
    unwrap(await commissionShip(manager(), { idempotencyKey: newKey(), name: 'deputy', type: 'squadron', kind: 'agent' }));

    expect(shipsNamed('deputy')[0]?.kind).toBe('agent');
  });

  it('refuses the same key for another kind', async () => {
    const thomas = { idempotencyKey: 'commission-thomas', name: 'thomas', type: 'person' };
    unwrap(await commissionShip(argo, { ...thomas, kind: 'person' }));

    await expect(commissionShip(argo, { ...thomas, kind: 'app' })).resolves.toMatchObject({ isOk: false, error: { kind: 'IDEMPOTENCY_KEY_REUSED' } });
  });
});

describe('the owner of a new ship (decision 0045)', () => {
  async function commissioned(caller: ShipCaller, name: string): Promise<ShipId> {
    return unwrap(await commissionShip(caller, { idempotencyKey: newKey(), name, type: 'squadron', scopes: ['fleet:manage'] })).shipId;
  }

  function ownerSetOf(shipId: ShipId) {
    return core.state.events.filter((event) => event.type === 'OwnerSet' && event.shipId === shipId).map((event) => event.details);
  }

  function asAgent(shipId: ShipId): ShipCaller {
    return { ...argo, shipId, kind: 'agent' };
  }

  it('is argo by default when argo commissions it, with OwnerSet', async () => {
    const shipId = await commissioned(argo, 'scout');

    expect(core.state.ships.find((ship) => ship.id === shipId)?.owner).toBe(argoId);
    expect(ownerSetOf(shipId)).toEqual([{ ownerShipId: argoId, how: 'argoByDefault' }]);
  });

  it("is the commissioner's owner, inherited, with OwnerSet", async () => {
    const thomas = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' })).shipId;
    const manager = await commissioned(argo, 'manager');
    const held = core.state.ships.find((ship) => ship.id === manager);
    if (held) {
      held.owner = thomas;
    }

    const shipId = await commissioned(asAgent(manager), 'deputy');

    expect(core.state.ships.find((ship) => ship.id === shipId)?.owner).toBe(thomas);
    expect(ownerSetOf(shipId)).toEqual([{ ownerShipId: thomas, how: 'inherited' }]);
  });

  it('is argo, inherited, when the commissioner is argo\'s', async () => {
    const manager = await commissioned(argo, 'manager');

    const shipId = await commissioned(asAgent(manager), 'deputy');

    expect(core.state.ships.find((ship) => ship.id === shipId)?.owner).toBe(argoId);
    expect(ownerSetOf(shipId)).toEqual([{ ownerShipId: argoId, how: 'inherited' }]);
  });

  it('writes OwnerSet once: a repeat of the commission sets nothing again', async () => {
    const scout = { idempotencyKey: 'commission-scout', name: 'scout', type: 'reviewer' };
    const { shipId } = unwrap(await commissionShip(argo, scout));

    unwrap(await commissionShip(argo, scout));

    expect(ownerSetOf(shipId)).toHaveLength(1);
  });
});

describe('an owner named on behalf of the asking ship (decisions 0045, 0017)', () => {
  let thomas: ShipId;
  let lead: ShipId;

  beforeEach(async () => {
    thomas = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' })).shipId;
    lead = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'tech-lead', type: 'lead' })).shipId;
    const held = core.state.ships.find((ship) => ship.id === lead);
    if (held) {
      held.owner = thomas;
    }
    core.state.events.length = 0;
  });

  /** A plugin's ship: it holds fleet:on-behalf, which argo granted it (decision 0045). */
  async function aPluginShip(): Promise<ShipCaller> {
    const { shipId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'squadrons', type: 'squadrons', scopes: ['fleet:commission', 'fleet:on-behalf'] }));
    core.state.events.length = 0;
    return { fleetId, shipId, kind: 'agent', scopes: [] };
  }

  function ownerSetOf(shipId: ShipId) {
    return core.state.events.filter((event) => event.type === 'OwnerSet' && event.shipId === shipId).map((event) => event.details);
  }

  it("is the asking ship's owner when a ship holding fleet:on-behalf names it, with OwnerSet saying how", async () => {
    const squadrons = await aPluginShip();

    const { shipId } = unwrap(await commissionShip(squadrons, { idempotencyKey: newKey(), name: 'login-flow', type: 'flagship', ownerOf: lead }));

    expect(core.state.ships.find((ship) => ship.id === shipId)?.owner).toBe(thomas);
    expect(ownerSetOf(shipId)).toEqual([{ ownerShipId: thomas, how: 'askingShipOwner', askingShipId: lead }]);
  });

  it("is argo when the asking ship is argo, which has no owner of its own", async () => {
    const squadrons = await aPluginShip();

    const { shipId } = unwrap(await commissionShip(squadrons, { idempotencyKey: newKey(), name: 'login-flow', type: 'flagship', ownerOf: argoId }));

    expect(ownerSetOf(shipId)).toEqual([{ ownerShipId: argoId, how: 'askingShipOwner', askingShipId: argoId }]);
  });

  it('is refused from a ship without fleet:on-behalf, even one that declared a namespace, and nothing is stored', async () => {
    const declarer = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'declarer', type: 'plugin', scopes: ['fleet:commission', 'scopes:declare'] })).shipId;
    const caller: ShipCaller = { fleetId, shipId: declarer, kind: 'agent', scopes: [] };
    unwrap(await registryUseCases(core).declareScopes(caller, { namespace: 'reviews', scopes: [{ scope: 'reviews:ask', description: 'Ask for a review' }] }));
    core.state.events.length = 0;

    const refused = await commissionShip(caller, { idempotencyKey: newKey(), name: 'deputy', type: 'lead', ownerOf: lead });

    expect(refused).toEqual({
      isOk: false,
      error: { kind: 'SCOPE_NOT_HELD', message: 'Naming the ship that asked for this one needs the fleet:on-behalf scope: commission without ownerOf' },
    });
    expect(shipsNamed('deputy')).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it('reads fleet:on-behalf from the fleet, not from the call', async () => {
    const manager = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'manager', type: 'lead', scopes: ['fleet:commission'] })).shipId;

    const refused = await commissionShip({ fleetId, shipId: manager, kind: 'agent', scopes: ['fleet:commission', 'fleet:on-behalf'] }, { idempotencyKey: newKey(), name: 'deputy', type: 'lead', ownerOf: lead });

    expect(refused).toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_HELD' } });
  });

  it('is refused for an asking ship the fleet does not have, and nothing is stored', async () => {
    const squadrons = await aPluginShip();
    const unknown: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0000';

    const refused = await commissionShip(squadrons, { idempotencyKey: newKey(), name: 'login-flow', type: 'flagship', ownerOf: unknown });

    expect(refused).toMatchObject({ isOk: false, error: { kind: 'SHIP_NOT_FOUND' } });
    expect(shipsNamed('login-flow')).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it('refuses the same key for another asking ship', async () => {
    const squadrons = await aPluginShip();
    const flagship = { idempotencyKey: 'commission-login-flow', name: 'login-flow', type: 'flagship' };
    unwrap(await commissionShip(squadrons, { ...flagship, ownerOf: lead }));

    await expect(commissionShip(squadrons, { ...flagship, ownerOf: argoId })).resolves.toMatchObject({ isOk: false, error: { kind: 'IDEMPOTENCY_KEY_REUSED' } });
  });
});

describe('an app ship commissioned by the gateway, with the owner argo picked (decisions 0044, 0045)', () => {
  let thomas: ShipId;

  beforeEach(async () => {
    thomas = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' })).shipId;
    core.state.events.length = 0;
  });

  /** The gateway's ship: argo granted it fleet:commission and fleet:on-behalf. */
  async function theGateway(scopes: string[] = ['fleet:commission', 'fleet:on-behalf']): Promise<ShipCaller> {
    const { shipId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'gateway', type: 'gateway', scopes }));
    core.state.events.length = 0;
    return { fleetId, shipId, kind: 'agent', scopes: [] };
  }

  function ownerSetOf(shipId: ShipId) {
    return core.state.events.filter((event) => event.type === 'OwnerSet' && event.shipId === shipId).map((event) => event.details);
  }

  it('commissions an app ship owned by the person argo picked, with OwnerSet saying it was named', async () => {
    const gateway = await theGateway();

    const { shipId } = unwrap(await commissionShip(gateway, { idempotencyKey: newKey(), name: 'crm', type: 'crm', kind: 'app', owner: thomas }));

    expect(core.state.ships.find((ship) => ship.id === shipId)).toMatchObject({ kind: 'app', owner: thomas, scopes: ['messages:send', 'messages:receive'] });
    expect(ownerSetOf(shipId)).toEqual([{ ownerShipId: thomas, how: 'named' }]);
  });

  it('takes argo as the owner it names', async () => {
    const gateway = await theGateway();

    const { shipId } = unwrap(await commissionShip(gateway, { idempotencyKey: newKey(), name: 'crm', type: 'crm', kind: 'app', owner: argoId }));

    expect(ownerSetOf(shipId)).toEqual([{ ownerShipId: argoId, how: 'named' }]);
  });

  it("gives an app ship with no owner named the gateway's own owner, argo, inherited", async () => {
    const gateway = await theGateway();

    const { shipId } = unwrap(await commissionShip(gateway, { idempotencyKey: newKey(), name: 'crm', type: 'crm', kind: 'app' }));

    expect(ownerSetOf(shipId)).toEqual([{ ownerShipId: argoId, how: 'inherited' }]);
  });

  it('refuses an app ship from a ship with fleet:commission but without fleet:on-behalf, storing nothing', async () => {
    const commissioner = await theGateway(['fleet:commission']);

    const refused = await commissionShip(commissioner, { idempotencyKey: newKey(), name: 'crm', type: 'crm', kind: 'app' });

    expect(refused).toMatchObject({ isOk: false, error: { kind: 'KIND_COMMISSIONED_BY_ARGO_ONLY' } });
    expect(shipsNamed('crm')).toEqual([]);
  });

  it('refuses a person ship from the gateway: only argo commissions a person ship', async () => {
    const gateway = await theGateway();

    const refused = await commissionShip(gateway, { idempotencyKey: newKey(), name: 'charlotte', type: 'person', kind: 'person', owner: thomas });

    expect(refused).toMatchObject({ isOk: false, error: { kind: 'KIND_COMMISSIONED_BY_ARGO_ONLY' } });
    expect(shipsNamed('charlotte')).toEqual([]);
  });

  it('refuses an owner named for an agent ship: only an app ship gets the owner argo picked', async () => {
    const gateway = await theGateway();

    const refused = await commissionShip(gateway, { idempotencyKey: newKey(), name: 'deputy', type: 'lead', owner: thomas });

    expect(refused).toMatchObject({ isOk: false, error: { kind: 'INVALID_OWNER' } });
    expect(shipsNamed('deputy')).toEqual([]);
  });

  it('refuses an owner named without fleet:on-behalf', async () => {
    const commissioner = await theGateway(['fleet:commission']);

    const refused = await commissionShip(commissioner, { idempotencyKey: newKey(), name: 'deputy', type: 'lead', owner: thomas });

    expect(refused).toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_HELD' } });
  });

  it('refuses an owner and an asking ship named together', async () => {
    const gateway = await theGateway();

    const refused = await commissionShip(gateway, { idempotencyKey: newKey(), name: 'crm', type: 'crm', kind: 'app', owner: thomas, ownerOf: argoId });

    expect(refused).toMatchObject({ isOk: false, error: { kind: 'INVALID_OWNER' } });
  });

  it.each([
    ['an agent ship', async (): Promise<ShipId> => unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })).shipId],
    ['a retired person ship', async (): Promise<ShipId> => {
      const shipId = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'leaver', type: 'person', kind: 'person' })).shipId;
      unwrap(await registryUseCases(core).retireShip(argo, { shipId }));
      return shipId;
    }],
    ['a ship the fleet does not have', (): Promise<ShipId> => Promise.resolve(core.ids('ship'))],
  ])('refuses %s as the owner, storing nothing', async (_label, ownerOf) => {
    const owner = await ownerOf();
    const gateway = await theGateway();

    const refused = await commissionShip(gateway, { idempotencyKey: newKey(), name: 'crm', type: 'crm', kind: 'app', owner });

    expect(refused).toMatchObject({ isOk: false, error: { kind: 'INVALID_OWNER' } });
    expect(shipsNamed('crm')).toEqual([]);
  });

  it('refuses the same key for another owner', async () => {
    const gateway = await theGateway();
    const crm = { idempotencyKey: 'commission-crm', name: 'crm', type: 'crm', kind: 'app' } as const;
    unwrap(await commissionShip(gateway, { ...crm, owner: thomas }));

    await expect(commissionShip(gateway, { ...crm, owner: argoId })).resolves.toMatchObject({ isOk: false, error: { kind: 'IDEMPOTENCY_KEY_REUSED' } });
  });
});

describe('the name of a new ship', () => {
  it('is refused while an active ship holds it, and nothing changes', async () => {
    unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const before = structuredClone(core.state);

    const second = await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'lookout' });

    expect(second).toEqual({
      isOk: false,
      error: { kind: 'SHIP_NAME_TAKEN', message: 'An active ship is already named scout' },
    });
    expect(core.state).toEqual(before);
  });

  it('can be the name of a retired ship', async () => {
    const retired = addAgentShip(core, { fleetId, name: 'scout', retiredAt: core.clock.now() });

    const { shipId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    expect(shipsNamed('scout').map((ship) => [ship.id, ship.retiredAt])).toEqual([
      [retired.shipId, core.clock.now()],
      [shipId, null],
    ]);
  });

  it('can be taken in another fleet', async () => {
    addAgentShip(core, { fleetId: core.ids('fleet'), name: 'scout' });

    await expect(commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })).resolves.toMatchObject({ isOk: true });
  });

  it('can never be argo, and nothing changes', async () => {
    const before = structuredClone(core.state);

    await expect(commissionShip(argo, { idempotencyKey: newKey(), name: 'argo', type: 'reviewer' })).resolves.toEqual({
      isOk: false,
      error: { kind: 'SHIP_NAME_RESERVED', message: 'The name argo is reserved for the operator ship' },
    });
    expect(core.state).toEqual(before);
  });

  it.each([
    ['uppercase', 'Scout'],
    ['empty', ''],
    ['over 48 characters', 'a'.repeat(49)],
  ])('is refused when %s', async (_label, name) => {
    await expect(commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'INVALID_SHIP_NAME' },
    });
    expect(core.state.ships).toHaveLength(1);
  });
});

describe('the type and note of a new ship', () => {
  it('refuses a type that is not a handle', async () => {
    await expect(commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'Code Reviewer' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'INVALID_SHIP_TYPE' },
    });
    expect(core.state.ships).toHaveLength(1);
  });

  it('refuses a note over 500 characters', async () => {
    const tooLong = { name: 'scout', type: 'reviewer', note: 'a'.repeat(501), idempotencyKey: newKey() };

    await expect(commissionShip(argo, tooLong)).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'INVALID_SHIP_NOTE' },
    });
    expect(core.state.ships).toHaveLength(1);
  });
});

describe('a failed commission', () => {
  it('leaves nothing behind when a write in the transaction fails', async () => {
    const before = structuredClone(core.state);
    const commission = createCommissionShip({
      uow: {
        run: (work) =>
          core.uow.run((tx) =>
            work({ ...tx, events: { append: () => Promise.reject(new Error('event log unavailable')) } }),
          ),
      },
      clock: core.clock,
      ids: core.ids,
      secrets: { hasher: core.hasher, random: core.random },
    });

    await expect(commission(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })).rejects.toThrow('event log unavailable');
    expect(core.state).toEqual(before);
  });
});

describe('a commission that comes again', () => {
  const scout = { name: 'scout', type: 'reviewer', note: 'reviews pull requests', idempotencyKey: 'commission-scout' };

  it('answers the original ship id and its starting prompt state, with no secret', async () => {
    const { shipId } = unwrap(await commissionShip(argo, scout));
    core.clock.advance(60_000);

    await expect(commissionShip(argo, scout)).resolves.toEqual({
      isOk: true,
      value: { shipId, secret: null, startingPrompt: { issuedAt: new Date('2026-09-29T12:00:00.000Z'), isClaimed: false } },
    });
  });

  it('commissions no second ship, issues no second secret and writes no event', async () => {
    unwrap(await commissionShip(argo, scout));
    const before = structuredClone(core.state);

    unwrap(await commissionShip(argo, scout));

    expect(core.state).toEqual(before);
  });

  it('says the starting prompt is claimed once a session claimed it', async () => {
    const commissioned = unwrap(await commissionShip(argo, scout));
    const { shipId } = commissioned;
    unwrap(await registryUseCases(core).claimShip({ shipId, secret: secretOf(commissioned.secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));

    const repeat = unwrap(await commissionShip(argo, scout));

    expect(repeat.startingPrompt?.isClaimed).toBe(true);
  });

  it('takes the fleet scopes in another order as the same request', async () => {
    unwrap(await commissionShip(argo, { ...scout, scopes: ['fleet:read', 'fleet:manage'] }));

    await expect(commissionShip(argo, { ...scout, scopes: ['fleet:manage', 'fleet:read'] })).resolves.toMatchObject({ isOk: true, value: { secret: null } });
  });

  it.each([
    ['another name', { name: 'lookout' }],
    ['another type', { type: 'lookout' }],
    ['another note', { note: 'reviews issues' }],
    ['other fleet scopes', { scopes: ['fleet:read'] as const }],
  ])('refuses the same key with %s, and nothing changes', async (_label, change) => {
    unwrap(await commissionShip(argo, scout));
    const before = structuredClone(core.state);

    await expect(commissionShip(argo, { ...scout, ...change })).resolves.toMatchObject({ isOk: false, error: { kind: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(core.state).toEqual(before);
  });

  it("keeps each commissioning ship's keys apart: another ship's same key commissions a new ship", async () => {
    unwrap(await commissionShip(argo, { name: 'manager', type: 'squadron', scopes: ['fleet:manage'], idempotencyKey: 'commission-manager' }));
    const manager = { ...argo, shipId: shipsNamed('manager')[0]?.id ?? argo.shipId, kind: 'agent' as const };
    unwrap(await commissionShip(argo, scout));

    const theirs = unwrap(await commissionShip(manager, { ...scout, name: 'deputy' }));

    expect(theirs.secret).not.toBeNull();
    expect(shipsNamed('deputy')).toHaveLength(1);
  });

  it.each([
    ['an empty key', ''],
    ['a key over 256 characters', 'k'.repeat(257)],
  ])('refuses %s', async (_label, idempotencyKey) => {
    await expect(commissionShip(argo, { ...scout, idempotencyKey })).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_IDEMPOTENCY_KEY' } });
  });
});

describe("commissioning at the fleet's ship limit", () => {
  it('takes ships up to the limit, argo included, then refuses the next and stores nothing', async () => {
    withInstallationSettings(core, { defaultShipLimit: 3 });
    unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' }));
    const before = structuredClone(core.state);

    await expect(commissionShip(argo, { idempotencyKey: newKey(), name: 'bosun', type: 'reviewer' })).resolves.toEqual({
      isOk: false,
      error: { kind: 'SHIP_LIMIT_REACHED', message: 'The fleet is at its limit of 3 ships, so it takes no new one.' },
    });
    expect(core.state).toEqual(before);
  });

  it('does not count retired ships', async () => {
    withInstallationSettings(core, { defaultShipLimit: 2 });
    addAgentShip(core, { fleetId, retiredAt: core.clock.now() });

    await expect(commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })).resolves.toMatchObject({ isOk: true });
  });

  it('follows a limit set for the fleet over the default, and no limit sets none', async () => {
    withInstallationSettings(core, { defaultShipLimit: 1 });
    core.state.fleetLimitSettings.push({ fleetId, ships: { kind: 'fleet', limit: null }, dailyMessages: { kind: 'default' } });

    await expect(commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })).resolves.toMatchObject({ isOk: true });
  });
});
