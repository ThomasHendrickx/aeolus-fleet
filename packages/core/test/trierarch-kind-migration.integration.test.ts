import type { ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { migrateDatabase } from '../src/adapters/prisma/migrate.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { aCrewSettings } from './support/crew-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

/** The approved in-place upgrade, proven against the actual release migration and durable relationships. */
let core: PostgresCore;
let argo: ShipCaller;
let plugin: ShipCaller;

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'home' })));
  const { shipId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: 'plugin', name: 'trierarch-plugin', type: 'trierarch-plugin', kind: 'plugin', scopes: ['fleet:commission', 'fleet:on-behalf', 'crew:run', 'crew:assign', 'labels:define', 'labels:assign'] }));
  plugin = { fleetId: argo.fleetId, shipId, kind: 'plugin', scopes: ['messages:send', 'messages:receive', 'fleet:commission', 'fleet:on-behalf', 'crew:run', 'crew:assign', 'labels:define', 'labels:assign'] };
});

afterEach(async () => { await core.close(); });

async function computer(name: string, kind: 'agent' | 'app', type = 'trierarch') {
  return unwrap(await core.useCases.commissionShip(plugin, { idempotencyKey: name, name, type, kind, scopes: ['crew:run'] }));
}

async function relationships() {
  return Promise.all([
    core.prisma.lease.findMany({ orderBy: { id: 'asc' } }),
    core.prisma.credential.findMany({ orderBy: { id: 'asc' } }),
    core.prisma.message.findMany({ orderBy: { id: 'asc' } }),
    core.prisma.delivery.findMany({ orderBy: { id: 'asc' } }),
    core.prisma.crewRequest.findMany({ orderBy: { shipId: 'asc' } }),
    core.prisma.shipLabel.findMany({ orderBy: [{ shipId: 'asc' }, { valueId: 'asc' }] }),
    core.prisma.event.findMany({ orderBy: { id: 'asc' } }),
  ]);
}

it('migrates agent and app computers proven by commissioning or owned labels, preserving ids, inboxes, leases and crew requests', async () => {
  // Given old agent and app computers, an ordinary same-type ship, and the distinct plugin.
  const agent = await computer('mac-studio', 'agent');
  const app = await computer('mac-mini', 'app');
  const labelled = await computer('labelled-computer', 'agent', 'computer');
  const helper = await computer('plugin-helper', 'agent', 'helper');
  const lookalike = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: 'lookalike', name: 'lookalike', type: 'trierarch' }));
  const label = unwrap(await core.useCases.defineLabel(plugin, { key: 'trierarch', values: ['machine', 'plugin'] }));
  const machineValue = label.values.find((value) => value.value === 'machine');
  const pluginValue = label.values.find((value) => value.value === 'plugin');
  expect(machineValue).toBeDefined();
  expect(pluginValue).toBeDefined();
  if (machineValue === undefined || pluginValue === undefined) return;
  for (const shipId of [agent.shipId, labelled.shipId]) {
    unwrap(await core.useCases.assignLabel(plugin, { shipId, valueId: machineValue.id }));
  }
  unwrap(await core.useCases.assignLabel(plugin, { shipId: plugin.shipId, valueId: pluginValue.id }));
  unwrap(await core.useCases.requestCrew(argo, { shipId: agent.shipId, settings: aCrewSettings() }));
  unwrap(await core.useCases.claimShip({ shipId: agent.shipId, secret: secretOf(agent.secret), location: { kind: 'SERVER' } }));
  unwrap(await core.useCases.sendMessage(argo, { selector: { kind: 'ship', shipId: agent.shipId }, contentType: 'text/plain', payload: 'Keep this inbox', idempotencyKey: 'inbox' }));
  unwrap(await core.useCases.requestCrew(argo, { shipId: helper.shipId, settings: aCrewSettings() }));
  unwrap(await core.useCases.assignCrew(plugin, { shipId: helper.shipId, trierarchShipId: agent.shipId }));
  const otherArgo = operatorCaller(unwrap(await core.useCases.createFleet({ requestId: 'another-fleet', name: 'another fleet', operatorEmail: 'another@example.com' })));
  const impostorId = unwrap(await core.useCases.commissionShip(otherArgo, { idempotencyKey: 'impostor', name: 'another-plugin', type: 'another-plugin', kind: 'plugin', scopes: ['fleet:commission', 'labels:define', 'labels:assign'] })).shipId;
  const impostor: ShipCaller = { fleetId: otherArgo.fleetId, shipId: impostorId, kind: 'plugin', scopes: ['fleet:commission', 'labels:define', 'labels:assign'] };
  const unrelated = unwrap(await core.useCases.commissionShip(impostor, { idempotencyKey: 'unrelated', name: 'unrelated', type: 'trierarch' }));
  const unrelatedLabel = unwrap(await core.useCases.defineLabel(impostor, { key: 'trierarch', values: ['machine'] }));
  const unrelatedValue = unrelatedLabel.values[0];
  expect(unrelatedValue).toBeDefined();
  if (unrelatedValue === undefined) return;
  unwrap(await core.useCases.assignLabel(impostor, { shipId: unrelated.shipId, valueId: unrelatedValue.id }));
  const shipsBefore = await core.prisma.ship.findMany({ orderBy: { id: 'asc' } });
  const relationshipsBefore = await relationships();

  // When release applies its data migration to a populated database, and starts again.
  await core.prisma.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = '20261115180100_trierarch_kind_backfill'`;
  await migrateDatabase(core.databaseUrl);
  await migrateDatabase(core.databaseUrl);

  // Then only the proven computers change kind; every other field and relationship stays byte-for-byte.
  const changed = new Set<ShipId>([agent.shipId, app.shipId, labelled.shipId]);
  await expect(core.prisma.ship.findMany({ orderBy: { id: 'asc' } })).resolves.toEqual(shipsBefore.map((ship) => ({ ...ship, kind: [...changed].some((id) => id === ship.id) ? 'trierarch' : ship.kind })));
  await expect(relationships()).resolves.toEqual(relationshipsBefore);
  await expect(core.prisma.ship.findUnique({ where: { id: lookalike.shipId } })).resolves.toMatchObject({ kind: 'agent' });
});
