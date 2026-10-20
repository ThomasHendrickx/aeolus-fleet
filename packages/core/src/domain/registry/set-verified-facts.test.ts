import { accountIdSchema, type ShipId, type VerifiedFact } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, everyShipMay, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { AccountCaller, InstallationCaller, ShipCaller } from '../shared/caller.js';

/**
 * Verified facts (decision 0059): the gateway, a ship holding fleet:verify,
 * writes what it checked about the proxy ship crm. Another writer's facts
 * stand apart from the gateway's.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: ShipCaller;
let gateway: ShipCaller;
let crmId: ShipId;

const TLS_HOST: VerifiedFact = { checked: 'tlsHost', value: 'crm.acme.example' };
const OAUTH_SUBJECT: VerifiedFact = { checked: 'oauthSubject', issuer: 'https://login.acme.example', value: 'aeolus-gateway' };

beforeEach(async () => {
  core = createInMemoryCore('2026-10-20T10:12:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  const { shipId: gatewayId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'gateway', type: 'gateway', scopes: ['fleet:verify'] }));
  gateway = { fleetId: fleet.fleetId, shipId: gatewayId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:verify'] };
  ({ shipId: crmId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'crm', type: 'mcp-server' })));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

function factsAbout(shipId: ShipId) {
  return core.state.verifiedFacts.filter((written) => written.shipId === shipId).map(({ writer, facts, at }) => ({ writer, facts, at }));
}

describe('writing verified facts about a ship (decision 0059)', () => {
  it("stores the writer's facts about the ship as written, naming the writer, at the time of the call", async () => {
    await expect(registry.setVerifiedFacts(gateway, { shipId: crmId, facts: [TLS_HOST, OAUTH_SUBJECT] })).resolves.toEqual({ isOk: true, value: undefined });

    expect(factsAbout(crmId)).toEqual([{ writer: { kind: 'ship', shipId: gateway.shipId }, facts: [TLS_HOST, OAUTH_SUBJECT], at: core.clock.now() }]);
  });

  it('writes VerifiedFactsSet on the ship written about, caused by the writer, with how many facts and never their values', async () => {
    unwrap(await registry.setVerifiedFacts(gateway, { shipId: crmId, facts: [TLS_HOST, OAUTH_SUBJECT] }));

    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'VerifiedFactsSet', occurredAt: core.clock.now(), actor: { kind: 'ship', shipId: gateway.shipId }, shipId: crmId, details: { facts: 2 } }),
    ]);
  });

  it("replaces the writer's facts whole, each at the time of the new call", async () => {
    unwrap(await registry.setVerifiedFacts(gateway, { shipId: crmId, facts: [TLS_HOST, OAUTH_SUBJECT] }));
    core.clock.advance(60_000);

    unwrap(await registry.setVerifiedFacts(gateway, { shipId: crmId, facts: [OAUTH_SUBJECT] }));

    expect(factsAbout(crmId)).toEqual([{ writer: { kind: 'ship', shipId: gateway.shipId }, facts: [OAUTH_SUBJECT], at: core.clock.now() }]);
  });

  it('changes nothing and writes no event when the writer sets the same facts again', async () => {
    unwrap(await registry.setVerifiedFacts(gateway, { shipId: crmId, facts: [TLS_HOST] }));
    const writtenAt = core.clock.now();
    core.clock.advance(60_000);
    core.state.events.length = 0;

    unwrap(await registry.setVerifiedFacts(gateway, { shipId: crmId, facts: [{ value: 'crm.acme.example', checked: 'tlsHost' }] }));

    expect(factsAbout(crmId)).toEqual([{ writer: { kind: 'ship', shipId: gateway.shipId }, facts: [TLS_HOST], at: writtenAt }]);
    expect(core.state.events).toEqual([]);
  });

  it("withdraws the writer's facts when it sets none, with VerifiedFactsSet holding none", async () => {
    unwrap(await registry.setVerifiedFacts(gateway, { shipId: crmId, facts: [TLS_HOST] }));
    core.state.events.length = 0;

    unwrap(await registry.setVerifiedFacts(gateway, { shipId: crmId, facts: [] }));

    expect(factsAbout(crmId)).toEqual([]);
    expect(core.state.events).toEqual([expect.objectContaining({ type: 'VerifiedFactsSet', shipId: crmId, details: { facts: 0 } })]);
  });

  it('changes nothing and writes no event when a writer with no facts about the ship sets none', async () => {
    unwrap(await registry.setVerifiedFacts(gateway, { shipId: crmId, facts: [] }));

    expect(factsAbout(crmId)).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it("leaves another writer's facts about the ship as they are", async () => {
    unwrap(await registry.setVerifiedFacts(argo, { shipId: crmId, facts: [TLS_HOST] }));

    unwrap(await registry.setVerifiedFacts(gateway, { shipId: crmId, facts: [OAUTH_SUBJECT] }));
    unwrap(await registry.setVerifiedFacts(gateway, { shipId: crmId, facts: [] }));

    expect(factsAbout(crmId)).toEqual([{ writer: { kind: 'ship', shipId: argo.shipId }, facts: [TLS_HOST], at: core.clock.now() }]);
  });

  it('lets an account holding fleet:verify write, named by its id only', async () => {
    const mathilde = accountIdSchema.parse('acc-mathilde');
    const account: AccountCaller = { kind: 'account', accountId: mathilde, fleetId: argo.fleetId, scopes: ['fleet:verify'], groupValues: [], personShipId: null, throughShipId: gateway.shipId };

    unwrap(await registry.setVerifiedFacts(account, { shipId: crmId, facts: [TLS_HOST] }));

    expect(factsAbout(crmId).map(({ writer }) => writer)).toEqual([{ kind: 'account', accountId: mathilde }]);
    expect(core.state.events.map(({ actor }) => actor)).toEqual([{ kind: 'account', accountId: mathilde, throughShipId: gateway.shipId }]);
  });

  it('lets the installation holding fleet:verify write, named as the installation', async () => {
    const installation: InstallationCaller = { kind: 'installation', fleetId: argo.fleetId, scopes: ['fleet:verify'] };

    unwrap(await registry.setVerifiedFacts(installation, { shipId: crmId, facts: [TLS_HOST] }));

    expect(factsAbout(crmId).map(({ writer }) => writer)).toEqual([{ kind: 'installation' }]);
  });

  it('refuses a ship that does not exist', async () => {
    await expect(registry.setVerifiedFacts(gateway, { shipId: core.ids('ship'), facts: [TLS_HOST] })).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_NOT_FOUND' } });
  });

  it('refuses a retired ship, storing nothing', async () => {
    unwrap(await registry.retireShip(argo, { shipId: crmId }));
    core.state.events.length = 0;

    await expect(registry.setVerifiedFacts(gateway, { shipId: crmId, facts: [TLS_HOST] })).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_ALREADY_RETIRED' } });
    expect(factsAbout(crmId)).toEqual([]);
    expect(core.state.events).toEqual([]);
  });
});

describe("writing verified facts outside the actor's manage reach (decisions 0034, 0059)", () => {
  it('is refused as a manage the rules do not allow, recording the refusal and storing no fact', async () => {
    const fleet = await readReachScenario();
    await applyNetworkRules(fleet.registry, { by: fleet.networking, rules: [everyShipMay('send'), everyShipMay('read')] });
    fleet.core.state.reachRefusals.length = 0;
    fleet.core.state.events.length = 0;
    const checker: ShipCaller = { ...fleet.near, scopes: ['fleet:verify'] };

    await expect(fleet.registry.setVerifiedFacts(checker, { shipId: fleet.far.shipId, facts: [TLS_HOST] })).resolves.toEqual({
      isOk: false,
      error: { kind: 'NOT_REACHABLE', message: 'The network rules do not allow this manage' },
    });
    expect(fleet.core.state.verifiedFacts).toEqual([]);
    expect(fleet.core.state.events).toEqual([]);
    expect(fleet.core.state.reachRefusals.map(({ verb }) => verb)).toEqual(['manage']);
  });
});
