import { accountIdSchema, SAME_LABEL_VALUE, type DeliveryId, type FleetId, type ShipId, type VerifiedFact } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  crewAboard,
  deliveryIdOf,
  initialiseFleet,
  messagingUseCases,
  operatorCaller,
  registryUseCases,
  secretOf,
} from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { carriedText, labelIdOf, valueIdOf } from '../../../test/support/label-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import type { AccountCaller, ShipCaller, Crew } from '../shared/caller.js';
import type { Selector } from '../shared/selector.js';
import { newKey } from '../../testing/keys.js';
import { createDeclareNetworkRules } from './declare-network-rules.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let scoutId: ShipId;
let scoutSecret: string;
let lookout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-01T14:00:00.000Z');
  const fleet = await initialiseFleet(core);
  fleetId = fleet.fleetId;
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  const scout = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  scoutId = scout.shipId;
  scoutSecret = secretOf(scout.secret);
  const { shipId: lookoutId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' }));
  lookout = crewAboard(core, { fleetId, shipId: lookoutId });
  core.clock.advance(60_000);
});

const toScout = (): Selector => ({ kind: 'ship', shipId: scoutId });
const toReviewers: Selector = { kind: 'type', type: 'reviewer' };

async function sendTo(selector: Selector): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await messaging.sendMessage(argo, { selector, payload: 'Review PR 48', idempotencyKey: `key-${core.ids('message')}` }),
  );
  return deliveryIdOf(core, messageId);
}

function delivery(deliveryId: DeliveryId) {
  return core.state.deliveries.find((held) => held.id === deliveryId);
}

function eventsOfType(type: string) {
  return core.state.events.filter((event) => event.type === type);
}

async function retireScout() {
  return registry.retireShip(argo, { shipId: scoutId });
}

describe('retiring a ship', () => {
  it('retires a ship awaiting crew for good: retired in the fleet, its secret stops working, ShipRetired by the caller', async () => {
    unwrap(await retireScout());

    expect((await registry.listFleet(argo)).find((ship) => ship.id === scoutId)).toMatchObject({ status: 'retired' });
    await expect(
      registry.claimShip({ shipId: scoutId, secret: scoutSecret, location: { kind: 'DEVICE' }, harness: 'claude-code' }),
    ).resolves.toMatchObject({ isOk: false });
    expect(eventsOfType('ShipRetired')).toMatchObject([
      { shipId: scoutId, actor: { kind: 'ship', shipId: argo.shipId }, details: { abandonedDeliveries: 0 } },
    ]);
  });

  it("ends a crewed ship's lease first: its crew token stops working", async () => {
    const scout = crewAboard(core, { fleetId, shipId: scoutId });

    unwrap(await retireScout());

    await expect(messaging.receiveDeliveries(scout, {})).resolves.toMatchObject({ isOk: false, error: { kind: 'LEASE_ENDED' } });
    expect(eventsOfType('LeaseRevoked')).toMatchObject([{ shipId: scoutId, details: { reason: 'retired' } }]);
  });

  it('abandons its direct deliveries, pending and in flight, one DeliveryAbandoned each, and ShipRetired counts them', async () => {
    const scout = crewAboard(core, { fleetId, shipId: scoutId });
    const inFlight = await sendTo(toScout());
    unwrap(await messaging.receiveDeliveries(scout, {}));
    const pending = await sendTo(toScout());

    unwrap(await retireScout());

    expect(delivery(inFlight)).toMatchObject({ state: 'abandoned', claimedByShipId: null });
    expect(delivery(pending)).toMatchObject({ state: 'abandoned' });
    expect(eventsOfType('DeliveryAbandoned').map((event) => event.deliveryId).sort()).toEqual([inFlight, pending].sort());
    expect(eventsOfType('ShipRetired')).toMatchObject([{ details: { abandonedDeliveries: 2 } }]);
  });

  it('never abandons a delivery to its type: one it held goes back to the queue for the other ships of the type', async () => {
    const scout = crewAboard(core, { fleetId, shipId: scoutId });
    const queued = await sendTo(toReviewers);
    unwrap(await messaging.receiveDeliveries(scout, {}));

    unwrap(await retireScout());

    expect(delivery(queued)).toMatchObject({ state: 'pending', claimedByShipId: null });
    expect(unwrap(await messaging.receiveDeliveries(lookout, {})).deliveries).toMatchObject([{ deliveryId: queued }]);
  });

  it('leaves an undeliverable direct delivery undeliverable, for Needs attention', async () => {
    const undeliverable = await sendTo(toScout());
    const held = delivery(undeliverable);
    if (held) {
      held.state = 'undeliverable';
    }

    unwrap(await retireScout());

    expect(delivery(undeliverable)).toMatchObject({ state: 'undeliverable' });
    expect(eventsOfType('DeliveryAbandoned')).toEqual([]);
  });

  it('is never addressed again: a send to it is refused', async () => {
    unwrap(await retireScout());

    await expect(
      messaging.sendMessage(argo, { selector: toScout(), payload: 'Still there?', idempotencyKey: 'after-retire' }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'UNRESOLVABLE_SELECTOR' } });
  });

  it('frees its name for a new ship', async () => {
    unwrap(await retireScout());

    await expect(registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })).resolves.toMatchObject({ isOk: true });
  });

  it('refuses argo, which is permanent', async () => {
    await expect(registry.retireShip(argo, { shipId: argo.shipId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'OPERATOR_SHIP_IS_PERMANENT' },
    });
  });

  it('refuses a ship retired already', async () => {
    unwrap(await retireScout());

    await expect(retireScout()).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_ALREADY_RETIRED' } });
  });

  it('knows no ship of another fleet', async () => {
    await expect(registry.retireShip({ ...argo, fleetId: core.ids('fleet') }, { shipId: scoutId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND' },
    });
  });

  it('leaves everything as it was when it refuses', async () => {
    const before = structuredClone(core.state);

    await registry.retireShip(argo, { shipId: argo.shipId });

    expect(core.state).toEqual(before);
  });
});

describe('an account retiring a ship (decision 0057)', () => {
  const THOMAS = accountIdSchema.parse('acc-thomas');
  const thomas = (): AccountCaller => ({ kind: 'account', accountId: THOMAS, fleetId, scopes: ['fleet:manage'], groupValues: [], personShipId: null, throughShipId: lookout.shipId });

  it('retires a ship in its manage reach, ShipRetired naming the account through the ship that presented it', async () => {
    unwrap(await registry.retireShip(thomas(), { shipId: scoutId }));

    expect((await registry.listFleet(argo)).find((ship) => ship.id === scoutId)).toMatchObject({ status: 'retired' });
    expect(eventsOfType('ShipRetired')).toMatchObject([{ shipId: scoutId, actor: { kind: 'account', accountId: THOMAS, throughShipId: lookout.shipId } }]);
  });
});

describe('the labels of a retired ship', () => {
  let plugin: ShipCaller;
  let pluginId: ShipId;
  let builderId: ShipId;
  let runnerId: ShipId;

  beforeEach(async () => {
    plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'trierarch-plugin', scopes: ['fleet:read', 'fleet:commission', 'labels:define', 'labels:assign'] });
    pluginId = plugin.shipId;
    ({ shipId: builderId } = unwrap(await registry.commissionShip(plugin, { idempotencyKey: newKey(), name: 'builder', type: 'implementer' })));
    ({ shipId: runnerId } = unwrap(await registry.commissionShip(plugin, { idempotencyKey: newKey(), name: 'runner', type: 'reviewer' })));
    unwrap(await registry.defineLabel(plugin, { key: 'os', values: ['macos', 'linux'] }));
    unwrap(await registry.defineLabel(plugin, { key: 'project', values: ['hemma'] }));
    unwrap(await registry.assignLabel(plugin, { shipId: builderId, valueId: valueIdOf(core, { key: 'os', value: 'macos' }) }));
    unwrap(await registry.assignLabel(plugin, { shipId: runnerId, valueId: valueIdOf(core, { key: 'os', value: 'linux' }) }));
    unwrap(await registry.assignLabel(plugin, { shipId: runnerId, valueId: valueIdOf(core, { key: 'project', value: 'hemma' }) }));
    core.clock.advance(60_000);
    core.state.events.length = 0;
  });

  function labelEvents() {
    return core.state.events.filter((event) => event.type.startsWith('Label')).map((event) => [event.type, event.shipId, event.details.key, event.details.value ?? null]);
  }

  it('go with it: the ship carries none, with one LabelUnassigned each, caused by the retirer', async () => {
    unwrap(await registry.retireShip(argo, { shipId: runnerId }));

    expect(carriedText(core, runnerId)).toEqual([]);
    expect(carriedText(core, builderId)).toEqual(['os=macos']);
    expect(eventsOfType('LabelUnassigned').map((event) => [event.actor, event.shipId, event.occurredAt, event.details.key, event.details.value])).toEqual([
      [{ kind: 'ship', shipId: argo.shipId }, runnerId, core.clock.now(), 'os', 'linux'],
      [{ kind: 'ship', shipId: argo.shipId }, runnerId, core.clock.now(), 'project', 'hemma'],
    ]);
  });

  it('it owns retire with it: every assignment of them goes, then each label, with LabelUnassigned and LabelRetired', async () => {
    const osId = labelIdOf(core, 'os');

    unwrap(await registry.retireShip(argo, { shipId: pluginId }));

    expect(core.state.labels).toEqual([]);
    expect(core.state.shipLabels).toEqual([]);
    expect(labelEvents()).toEqual([
      ['LabelUnassigned', builderId, 'os', 'macos'],
      ['LabelUnassigned', runnerId, 'os', 'linux'],
      ['LabelRetired', pluginId, 'os', null],
      ['LabelUnassigned', runnerId, 'project', 'hemma'],
      ['LabelRetired', pluginId, 'project', null],
    ]);
    expect(eventsOfType('LabelRetired')[0]?.details).toEqual({ labelId: osId, key: 'os' });
  });

  it('it owned can be defined again once it retired, by another ship', async () => {
    unwrap(await registry.retireShip(argo, { shipId: pluginId }));

    await expect(registry.defineLabel(argo, { key: 'os', values: ['windows'] })).resolves.toMatchObject({ isOk: true });
  });

  it('it owns stay while it is only released: its meaning retires with its owner, not its crew', async () => {
    const crew = crewAboard(core, { fleetId, shipId: pluginId });
    unwrap(await registry.releaseShip(argo, { shipId: crew.shipId }));

    expect(core.state.labels.map((label) => label.key)).toEqual(['os', 'project']);
    expect(core.state.shipLabels).toHaveLength(3);
    expect(labelEvents()).toEqual([]);
  });
});

describe('the clear requests of a retired trierarch (decision 0032)', () => {
  it('go with it, one WorktreeClearRemoved each on its ship, caused by the retirer; another trierarch keeps its own', async () => {
    const macMini = await shipWithScopes({ registry, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
    const macStudio = await shipWithScopes({ registry, argo }, { name: 'mac-studio', type: 'trierarch', scopes: ['crew:run'] });
    unwrap(await registry.requestWorktreeClear(argo, { trierarchShipId: macMini.shipId, shipId: scoutId, repository: 'aeolus-fleet' }));
    unwrap(await registry.requestWorktreeClear(argo, { trierarchShipId: macStudio.shipId, shipId: scoutId, repository: 'hemma' }));

    unwrap(await registry.retireShip(argo, { shipId: macMini.shipId }));

    expect(core.state.clearRequests.map(({ trierarchShipId }) => trierarchShipId)).toEqual([macStudio.shipId]);
    expect(eventsOfType('WorktreeClearRemoved')).toEqual([
      expect.objectContaining({ actor: { kind: 'ship', shipId: argo.shipId }, shipId: macMini.shipId, details: { worktreeShipId: scoutId, repository: 'aeolus-fleet' } }),
    ]);
  });
});

describe('a ship that declared network rules retired (decision 0037)', () => {
  let squadrons: ShipCaller;

  beforeEach(async () => {
    squadrons = await shipWithScopes({ registry, argo }, { name: 'squadrons', type: 'squadrons', scopes: ['labels:define', 'labels:assign'] });
    const { labelId } = unwrap(await registry.defineLabel(squadrons, { key: 'squadron', values: ['alpha'] }));
    const sameSquadron = { verb: 'send' as const, from: [{ labelId, value: SAME_LABEL_VALUE }], to: [{ labelId, value: SAME_LABEL_VALUE }] };
    unwrap(await createDeclareNetworkRules({ uow: core.uow, clock: core.clock, ids: core.ids })(squadrons, { rules: [sameSquadron] }));
    core.state.events.length = 0;
  });

  it('withdraws its declared rules at the next settings version, with NetworkRulesDeclared of none caused by the retirer', async () => {
    unwrap(await registry.retireShip(argo, { shipId: squadrons.shipId }));

    expect(core.state.declaredNetworkRules).toEqual([]);
    expect(core.state.networkSettings).toEqual([expect.objectContaining({ version: 2 })]);
    expect(eventsOfType('NetworkRulesDeclared')).toEqual([expect.objectContaining({ actor: { kind: 'ship', shipId: argo.shipId }, shipId: squadrons.shipId, details: { rules: 0, version: 2 } })]);
  });

  it('leaves the declared rules as they are when another ship retires', async () => {
    unwrap(await registry.retireShip(argo, { shipId: scoutId }));

    expect(core.state.declaredNetworkRules).toEqual([expect.objectContaining({ declarer: { kind: 'ship', shipId: squadrons.shipId } })]);
    expect(core.state.networkSettings).toEqual([expect.objectContaining({ version: 1 })]);
    expect(eventsOfType('NetworkRulesDeclared')).toEqual([]);
  });
});

describe('a retired owner (decision 0045)', () => {
  let thomasId: ShipId;

  beforeEach(async () => {
    ({ shipId: thomasId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' })));
    unwrap(await registry.setOwner(argo, { shipId: scoutId, ownerShipId: thomasId }));
    unwrap(await registry.setOwner(argo, { shipId: lookout.shipId, ownerShipId: thomasId }));
    core.state.events.length = 0;
  });

  function ownerOf(shipId: ShipId) {
    return core.state.ships.find((held) => held.id === shipId)?.owner;
  }

  it('hands each active ship it owned to argo, with OwnerChanged on each', async () => {
    unwrap(await registry.retireShip(argo, { shipId: thomasId }));

    expect([ownerOf(scoutId), ownerOf(lookout.shipId)]).toEqual([argo.shipId, argo.shipId]);
    expect(eventsOfType('OwnerChanged')).toEqual([
      expect.objectContaining({ actor: { kind: 'ship', shipId: argo.shipId }, shipId: scoutId, details: { fromShipId: thomasId, toShipId: argo.shipId, why: 'ownerRetired' } }),
      expect.objectContaining({ actor: { kind: 'ship', shipId: argo.shipId }, shipId: lookout.shipId, details: { fromShipId: thomasId, toShipId: argo.shipId, why: 'ownerRetired' } }),
    ]);
  });

  it('keeps a person ship that owns itself as its own owner once retired, as a retired ship keeps the owner it had', async () => {
    unwrap(await registry.retireShip(argo, { shipId: thomasId }));

    expect(ownerOf(thomasId)).toBe(thomasId);
    expect(eventsOfType('OwnerChanged').map((event) => event.shipId)).toEqual([scoutId, lookout.shipId]);
  });

  it('leaves a retired ship it owned as it was', async () => {
    unwrap(await retireScout());
    core.state.events.length = 0;

    unwrap(await registry.retireShip(argo, { shipId: thomasId }));

    expect(ownerOf(scoutId)).toBe(thomasId);
    expect(eventsOfType('OwnerChanged').map((event) => event.shipId)).toEqual([lookout.shipId]);
  });

  it('writes no OwnerChanged when the retired ship owns none', async () => {
    unwrap(await retireScout());

    expect(eventsOfType('OwnerChanged')).toEqual([]);
  });
});

describe("retiring a plugin namespace's declarer (decision 0046)", () => {
  const FORM = { scope: 'squadrons:form', description: 'Form a squadron' };
  const SCALE = { scope: 'squadrons:scale', description: 'Add and remove members' };

  /** squadrons declares its namespace, then argo grants its scopes: scout both, lookout one. */
  async function declaredAndGranted(): Promise<ShipCaller> {
    const squadrons = await shipWithScopes({ registry, argo }, { name: 'squadrons', type: 'squadrons', scopes: [] });
    unwrap(await registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: [FORM, SCALE] }));
    unwrap(await registry.grantScopes(argo, { shipId: scoutId, grant: ['fleet:read', 'squadrons:form', 'squadrons:scale'], revoke: [] }));
    unwrap(await registry.grantScopes(argo, { shipId: lookout.shipId, grant: ['squadrons:form'], revoke: [] }));
    core.state.events.length = 0;
    return squadrons;
  }

  const scopesOf = (shipId: ShipId) => core.state.ships.find((ship) => ship.id === shipId)?.scopes;

  it('frees the namespace and takes its scopes off every active ship, keeping their other scopes', async () => {
    const squadrons = await declaredAndGranted();

    unwrap(await registry.retireShip(argo, { shipId: squadrons.shipId }));

    expect(core.state.scopeNamespaces).toEqual([]);
    expect(scopesOf(scoutId)).toEqual(['messages:send', 'messages:receive', 'fleet:read']);
    expect(scopesOf(lookout.shipId)).toEqual(['messages:send', 'messages:receive']);
  });

  it('writes one ScopesChanged on each ship that lost scopes, caused by the retiring caller, naming what it lost', async () => {
    const squadrons = await declaredAndGranted();

    unwrap(await registry.retireShip(argo, { shipId: squadrons.shipId }));

    const changed = core.state.events.filter((event) => event.type === 'ScopesChanged');
    expect(changed.map(({ shipId, actor, details }) => ({ shipId, actor, details })).toSorted((first, second) => String(first.shipId).localeCompare(String(second.shipId)))).toEqual(
      [
        { shipId: scoutId, actor: { kind: 'ship', shipId: argo.shipId }, details: { added: '', removed: 'squadrons:form squadrons:scale' } },
        { shipId: lookout.shipId, actor: { kind: 'ship', shipId: argo.shipId }, details: { added: '', removed: 'squadrons:form' } },
      ].toSorted((first, second) => first.shipId.localeCompare(second.shipId)),
    );
  });

  it('lets another ship declare the namespace then', async () => {
    const squadrons = await declaredAndGranted();
    unwrap(await registry.retireShip(argo, { shipId: squadrons.shipId }));
    const successor = await shipWithScopes({ registry, argo }, { name: 'squadrons-two', type: 'squadrons', scopes: [] });

    await expect(registry.declareScopes(successor, { namespace: 'squadrons', scopes: [FORM] })).resolves.toMatchObject({ isOk: true });
  });

  it("leaves the namespace and its scopes when a ship that declared nothing retires", async () => {
    await declaredAndGranted();

    unwrap(await registry.retireShip(argo, { shipId: lookout.shipId }));

    expect(core.state.scopeNamespaces.map(({ namespace }) => namespace)).toEqual(['squadrons']);
    expect(scopesOf(scoutId)).toEqual(['messages:send', 'messages:receive', 'fleet:read', 'squadrons:form', 'squadrons:scale']);
    expect(core.state.events.filter((event) => event.type === 'ScopesChanged')).toEqual([]);
  });
});

describe('the verified facts of a retired ship (decision 0059)', () => {
  const TLS_HOST: VerifiedFact = { checked: 'tlsHost', value: 'scout.acme.example' };
  const OAUTH_SUBJECT: VerifiedFact = { checked: 'oauthSubject', issuer: 'https://login.acme.example', value: 'aeolus-gateway' };
  let gateway: ShipCaller;
  let mathilde: AccountCaller;

  beforeEach(async () => {
    const { shipId: gatewayId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'gateway', type: 'gateway', scopes: ['fleet:verify'] }));
    gateway = { fleetId, shipId: gatewayId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:verify'] };
    mathilde = { kind: 'account', accountId: accountIdSchema.parse('acc-mathilde'), fleetId, scopes: ['fleet:verify'], groupValues: [], personShipId: null, throughShipId: null };
  });

  function factsAbout(shipId: ShipId) {
    return core.state.verifiedFacts.filter((written) => written.shipId === shipId).map(({ writer }) => writer);
  }

  it('go with it: every writer\'s facts about it, one VerifiedFactsRemoved per writer, on the ship', async () => {
    unwrap(await registry.setVerifiedFacts(gateway, { shipId: scoutId, facts: [TLS_HOST, OAUTH_SUBJECT] }));
    unwrap(await registry.setVerifiedFacts(mathilde, { shipId: scoutId, facts: [TLS_HOST] }));
    core.state.events.length = 0;

    unwrap(await registry.retireShip(argo, { shipId: scoutId }));

    expect(factsAbout(scoutId)).toEqual([]);
    expect(eventsOfType('VerifiedFactsRemoved')).toEqual([
      expect.objectContaining({ shipId: scoutId, actor: { kind: 'ship', shipId: argo.shipId }, details: { writerKind: 'ship', writer: gateway.shipId, facts: 2, why: 'shipRetired' } }),
      expect.objectContaining({ shipId: scoutId, actor: { kind: 'ship', shipId: argo.shipId }, details: { writerKind: 'account', writer: 'acc-mathilde', facts: 1, why: 'shipRetired' } }),
    ]);
  });

  it('go when their writer retires: its facts about every ship, one VerifiedFactsRemoved on each ship written about', async () => {
    unwrap(await registry.setVerifiedFacts(gateway, { shipId: scoutId, facts: [TLS_HOST] }));
    unwrap(await registry.setVerifiedFacts(gateway, { shipId: lookout.shipId, facts: [OAUTH_SUBJECT] }));
    unwrap(await registry.setVerifiedFacts(mathilde, { shipId: scoutId, facts: [TLS_HOST] }));
    core.state.events.length = 0;

    unwrap(await registry.retireShip(argo, { shipId: gateway.shipId }));

    expect(factsAbout(scoutId)).toEqual([{ kind: 'account', accountId: 'acc-mathilde' }]);
    expect(factsAbout(lookout.shipId)).toEqual([]);
    expect(eventsOfType('VerifiedFactsRemoved').map(({ shipId, details }) => ({ shipId, details }))).toEqual([
      { shipId: scoutId, details: { writerKind: 'ship', writer: gateway.shipId, facts: 1, why: 'writerRetired' } },
      { shipId: lookout.shipId, details: { writerKind: 'ship', writer: gateway.shipId, facts: 1, why: 'writerRetired' } },
    ]);
  });

  it('removes the facts a ship wrote about itself once, as the ship retired', async () => {
    unwrap(await registry.setVerifiedFacts(gateway, { shipId: gateway.shipId, facts: [TLS_HOST] }));
    core.state.events.length = 0;

    unwrap(await registry.retireShip(argo, { shipId: gateway.shipId }));

    expect(factsAbout(gateway.shipId)).toEqual([]);
    expect(eventsOfType('VerifiedFactsRemoved').map(({ details }) => details.why)).toEqual(['shipRetired']);
  });

  it('writes no VerifiedFactsRemoved for a ship with no facts about it or by it', async () => {
    unwrap(await registry.retireShip(argo, { shipId: scoutId }));

    expect(eventsOfType('VerifiedFactsRemoved')).toEqual([]);
  });
});
