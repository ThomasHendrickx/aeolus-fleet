import { accountIdSchema, createIdGenerator, type FleetId, type ShipId, type VerifiedFact } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createRetireShip } from '../src/domain/registry/retire-ship.js';
import { createSetVerifiedFacts } from '../src/domain/registry/set-verified-facts.js';
import type { FactWriter } from '../src/domain/registry/verified-facts.js';
import type { AccountCaller, InstallationCaller, ShipCaller } from '../src/domain/shared/caller.js';
import { ok } from '../src/domain/shared/result.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller } from './support/core-fixtures.js';
import { createPostgresCore, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { withOperatorLogin } from './support/operator-login.js';

// Verified facts on a real Postgres (decision 0059): each writer's facts
// about a ship kept with the ship, set whole, with VerifiedFactsSet in the
// same transaction.

let core: PostgresCore;
let fleetId: FleetId;
let argo: ShipCaller;
let gateway: ShipCaller;
let crmId: ShipId;

const TLS_HOST: VerifiedFact = { checked: 'tlsHost', value: 'crm.acme.example' };
const OAUTH_SUBJECT: VerifiedFact = { checked: 'oauthSubject', issuer: 'https://login.acme.example', value: 'aeolus-gateway' };

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' })));
  fleetId = fleet.fleetId;
  argo = operatorCaller(fleet);
  const { shipId: gatewayId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'gateway', type: 'gateway', scopes: ['fleet:verify'] }));
  gateway = { fleetId, shipId: gatewayId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:verify'] };
  ({ shipId: crmId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'crm', type: 'mcp-server' })));
});

afterEach(async () => {
  await core.close();
});

async function factsOf(writer: FactWriter) {
  return unwrap(await createPrismaUnitOfWork(core.prisma).run(async (tx) => ok(await tx.verifiedFacts.find(fleetId, { shipId: crmId, writer }))));
}

async function eventsAboutCrm() {
  return (await core.prisma.event.findMany({ where: { fleetId, shipId: crmId, type: 'VerifiedFactsSet' }, orderBy: { seq: 'asc' } })).map(({ actorShipId, details }) => ({ actorShipId, details }));
}

describe('verified facts on Postgres', () => {
  it("keeps a ship writer's facts as written, issuer included, at the time of the call, with VerifiedFactsSet caused by it", async () => {
    unwrap(await core.useCases.setVerifiedFacts(gateway, { shipId: crmId, facts: [TLS_HOST, OAUTH_SUBJECT] }));

    await expect(factsOf({ kind: 'ship', shipId: gateway.shipId })).resolves.toEqual({
      fleetId,
      shipId: crmId,
      writer: { kind: 'ship', shipId: gateway.shipId },
      facts: [TLS_HOST, OAUTH_SUBJECT],
      at: core.clock.now(),
    });
    await expect(eventsAboutCrm()).resolves.toEqual([{ actorShipId: gateway.shipId, details: { facts: 2 } }]);
  });

  it("keeps an account's and the installation's facts each under their own writer", async () => {
    const mathilde = accountIdSchema.parse('acc-mathilde');
    const account: AccountCaller = { kind: 'account', accountId: mathilde, fleetId, scopes: ['fleet:verify'], groupValues: [], personShipId: null, throughShipId: null };
    const installation: InstallationCaller = { kind: 'installation', fleetId, scopes: ['fleet:verify'] };

    unwrap(await core.useCases.setVerifiedFacts(account, { shipId: crmId, facts: [TLS_HOST] }));
    unwrap(await core.useCases.setVerifiedFacts(installation, { shipId: crmId, facts: [OAUTH_SUBJECT] }));

    await expect(factsOf({ kind: 'account', accountId: mathilde })).resolves.toMatchObject({ writer: { kind: 'account', accountId: mathilde }, facts: [TLS_HOST] });
    await expect(factsOf({ kind: 'installation' })).resolves.toMatchObject({ writer: { kind: 'installation' }, facts: [OAUTH_SUBJECT] });
  });

  it("replaces the writer's facts whole, and withdraws them when it sets none, leaving another writer's", async () => {
    unwrap(await core.useCases.setVerifiedFacts(argo, { shipId: crmId, facts: [TLS_HOST] }));
    unwrap(await core.useCases.setVerifiedFacts(gateway, { shipId: crmId, facts: [TLS_HOST, OAUTH_SUBJECT] }));
    core.clock.advance(60_000);

    unwrap(await core.useCases.setVerifiedFacts(gateway, { shipId: crmId, facts: [OAUTH_SUBJECT] }));
    await expect(factsOf({ kind: 'ship', shipId: gateway.shipId })).resolves.toMatchObject({ facts: [OAUTH_SUBJECT], at: core.clock.now() });

    unwrap(await core.useCases.setVerifiedFacts(gateway, { shipId: crmId, facts: [] }));
    await expect(factsOf({ kind: 'ship', shipId: gateway.shipId })).resolves.toBeUndefined();
    await expect(factsOf({ kind: 'ship', shipId: argo.shipId })).resolves.toMatchObject({ facts: [TLS_HOST] });
    await expect(eventsAboutCrm()).resolves.toEqual([
      { actorShipId: argo.shipId, details: { facts: 1 } },
      { actorShipId: gateway.shipId, details: { facts: 2 } },
      { actorShipId: gateway.shipId, details: { facts: 1 } },
      { actorShipId: gateway.shipId, details: { facts: 0 } },
    ]);
  });

  it('takes two sets by one writer at once in turn: both stored one after the other, each with its event, neither refused', async () => {
    const [first, second] = await Promise.all([
      core.useCases.setVerifiedFacts(gateway, { shipId: crmId, facts: [TLS_HOST] }),
      core.useCases.setVerifiedFacts(gateway, { shipId: crmId, facts: [OAUTH_SUBJECT] }),
    ]);

    expect([first.isOk, second.isOk]).toEqual([true, true]);
    expect([[TLS_HOST], [OAUTH_SUBJECT]]).toContainEqual((await factsOf({ kind: 'ship', shipId: gateway.shipId }))?.facts);
    await expect(eventsAboutCrm()).resolves.toHaveLength(2);
  });
});

describe('verified facts in discovery on Postgres', () => {
  it("shows each writer's facts about a ship beside its statement, read from the store, oldest first, naming each writer", async () => {
    const mathilde = accountIdSchema.parse('acc-mathilde');
    unwrap(await core.useCases.setVerifiedFacts(gateway, { shipId: crmId, facts: [TLS_HOST] }));
    core.clock.advance(60_000);
    unwrap(await core.useCases.setVerifiedFacts({ kind: 'account', accountId: mathilde, fleetId, scopes: ['fleet:verify'], groupValues: [], personShipId: null, throughShipId: null }, { shipId: crmId, facts: [OAUTH_SUBJECT] }));

    const { ships } = unwrap(await core.useCases.discover(argo));

    expect(ships.find((ship) => ship.id === crmId)?.verified).toEqual([
      { ...TLS_HOST, by: { kind: 'ship', id: gateway.shipId, name: 'gateway' }, at: '2026-09-29T12:00:00.000Z' },
      { ...OAUTH_SUBJECT, by: { kind: 'account', id: mathilde }, at: '2026-09-29T12:01:00.000Z' },
    ]);
    expect(ships.find((ship) => ship.id === gateway.shipId)?.verified).toEqual([]);
  });
});

describe('verified facts and a retire on Postgres', () => {
  async function writersAbout(shipId: ShipId) {
    return core.prisma.verifiedFacts.findMany({ where: { fleetId, shipId }, select: { writerKind: true, writer: true } });
  }

  async function removals() {
    return (await core.prisma.event.findMany({ where: { fleetId, type: 'VerifiedFactsRemoved' }, orderBy: { seq: 'asc' } })).map(({ shipId, details }) => ({ shipId, details }));
  }

  it("removes every writer's facts about a retired ship, and a retired writer's about every ship, each with VerifiedFactsRemoved", async () => {
    const { shipId: scoutId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    unwrap(await core.useCases.setVerifiedFacts(gateway, { shipId: crmId, facts: [TLS_HOST] }));
    unwrap(await core.useCases.setVerifiedFacts(gateway, { shipId: scoutId, facts: [TLS_HOST] }));
    core.clock.advance(60_000);
    unwrap(await core.useCases.setVerifiedFacts(argo, { shipId: crmId, facts: [OAUTH_SUBJECT] }));

    unwrap(await core.useCases.retireShip(argo, { shipId: crmId }));
    unwrap(await core.useCases.retireShip(argo, { shipId: gateway.shipId }));

    await expect(writersAbout(crmId)).resolves.toEqual([]);
    await expect(writersAbout(scoutId)).resolves.toEqual([]);
    await expect(removals()).resolves.toEqual([
      { shipId: crmId, details: { writerKind: 'ship', writer: gateway.shipId, facts: 1, why: 'shipRetired' } },
      { shipId: crmId, details: { writerKind: 'ship', writer: argo.shipId, facts: 1, why: 'shipRetired' } },
      { shipId: scoutId, details: { writerKind: 'ship', writer: gateway.shipId, facts: 1, why: 'writerRetired' } },
    ]);
  });

  it("lets a writer's set that holds its writer first commit, then its retire removes what it set", async () => {
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      verifiedFacts: {
        ...tx.verifiedFacts,
        find: async (fleet, key) => {
          await hold();
          return tx.verifiedFacts.find(fleet, key);
        },
      },
    }));
    const setting = createSetVerifiedFacts({ uow, clock: core.clock, ids: createIdGenerator() })(gateway, { shipId: crmId, facts: [TLS_HOST] });
    await reached;

    const retiring = core.useCases.retireShip(argo, { shipId: gateway.shipId });

    await expect(setting).resolves.toMatchObject({ isOk: true });
    await expect(retiring).resolves.toMatchObject({ isOk: true });
    await expect(writersAbout(crmId)).resolves.toEqual([]);
    await expect(removals()).resolves.toEqual([{ shipId: crmId, details: { writerKind: 'ship', writer: gateway.shipId, facts: 1, why: 'writerRetired' } }]);
  });

  it("refuses a writer's set that comes while its retire holds the writer, storing nothing", async () => {
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      verifiedFacts: {
        ...tx.verifiedFacts,
        listBy: async (fleet, shipId) => {
          await hold();
          return tx.verifiedFacts.listBy(fleet, shipId);
        },
      },
    }));
    const retiring = createRetireShip({ uow, clock: core.clock, ids: createIdGenerator() })(argo, { shipId: gateway.shipId });
    await reached;

    const setting = core.useCases.setVerifiedFacts(gateway, { shipId: crmId, facts: [TLS_HOST] });

    await expect(retiring).resolves.toMatchObject({ isOk: true });
    await expect(setting).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_ALREADY_RETIRED' } });
    await expect(writersAbout(crmId)).resolves.toEqual([]);
  });
});

