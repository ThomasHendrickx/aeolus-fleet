import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createReadReachOf } from '../src/domain/registry/read-reach.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import type { Caller } from '../src/domain/shared/caller.js';
import { OPERATOR, operatorCaller, secretOf } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// Plugins argo connected on a real Postgres (decision 0034): a connected
// plugin's ship reads every ship whatever the rules, until a release or a
// retire of the ship ends it, each with its event in the same transaction.

let core: PostgresCore;
let fleetId: FleetId;
let argo: Caller;
let plugin: Caller;
let pluginId: ShipId;

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  fleetId = fleet.fleetId;
  argo = operatorCaller(fleet);
  const commissioned = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'squadrons', type: 'squadrons', scopes: ['fleet:read'] }));
  pluginId = commissioned.shipId;
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId: pluginId, secret: secretOf(commissioned.secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  plugin = unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
  // A networking plugin whose rules give the plugin's ship nothing to read.
  const networking = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'networking', type: 'networking', scopes: ['fleet:network'] }));
  const { crewToken: networkingToken } = unwrap(await core.useCases.claimShip({ shipId: networking.shipId, secret: secretOf(networking.secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  const networkingCaller = unwrap(await core.useCases.authenticate.byCrewToken(networkingToken));
  unwrap(await core.useCases.registerNetworkPlugin(networkingCaller, { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 300 }));
  unwrap(await core.useCases.setBuiltInRule(networkingCaller, { rule: 'open', verb: 'read', isOn: false }));
});

afterEach(async () => {
  await core.close();
});

async function readsOf(caller: Caller) {
  return (await createReadReachOf({ uow: createPrismaUnitOfWork(core.prisma), clock: core.clock })(caller)).kind;
}

async function eventsAbout(type: string) {
  return (await core.prisma.event.findMany({ where: { fleetId, shipId: pluginId, type }, orderBy: { seq: 'asc' } })).map(({ actorShipId, details }) => ({ actorShipId, details }));
}

describe('a connected plugin on Postgres', () => {
  it('reads every ship once argo connected it, with PluginConnected caused by argo', async () => {
    await expect(readsOf(plugin)).resolves.toBe('some');

    unwrap(await core.useCases.connectPlugin(argo, { shipId: pluginId }));

    await expect(readsOf(plugin)).resolves.toBe('every');
    await expect(eventsAbout('PluginConnected')).resolves.toEqual([{ actorShipId: argo.shipId, details: {} }]);
  });

  it('reads by the rules again once argo releases its ship, with PluginDisconnected', async () => {
    unwrap(await core.useCases.connectPlugin(argo, { shipId: pluginId }));

    unwrap(await core.useCases.releaseShip(argo, { shipId: pluginId }));

    await expect(core.prisma.pluginConnection.count()).resolves.toBe(0);
    await expect(eventsAbout('PluginDisconnected')).resolves.toEqual([{ actorShipId: argo.shipId, details: { why: 'released' } }]);
  });

  it('ends with the retire of its ship, with PluginDisconnected', async () => {
    unwrap(await core.useCases.connectPlugin(argo, { shipId: pluginId }));

    unwrap(await core.useCases.retireShip(argo, { shipId: pluginId }));

    await expect(core.prisma.pluginConnection.count()).resolves.toBe(0);
    await expect(eventsAbout('PluginDisconnected')).resolves.toEqual([{ actorShipId: argo.shipId, details: { why: 'retired' } }]);
  });

  it('goes with its fleet when the fleet is deleted', async () => {
    unwrap(await core.useCases.connectPlugin(argo, { shipId: pluginId }));

    unwrap(await core.useCases.deleteFleet({ requestId: 'delete-home-fleet', fleetId }));

    await expect(core.prisma.pluginConnection.count()).resolves.toBe(0);
  });
});
