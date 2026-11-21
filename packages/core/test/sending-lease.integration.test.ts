/** Immutable sending evidence survives upgrade, replacement crews and a server restart. */
import { afterEach, beforeEach, expect, it } from 'vitest';

import { migrateDatabase } from '../src/adapters/prisma/migrate.js';
import { createPrismaMessageRepository } from '../src/adapters/prisma/messaging.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import { unwrap } from '../src/testing/result.js';
import { createUseCases } from '../src/wiring.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

let core: PostgresCore;
let argo: ShipCaller;
let sender: Crew;

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'home' })));
  const commissioned = unwrap(await core.useCases.commissionShip(argo, { name: 'sender', type: 'reviewer', idempotencyKey: 'sender' }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId: commissioned.shipId, secret: secretOf(commissioned.secret), location: { kind: 'SERVER' } }));
  sender = unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
});

afterEach(async () => { await core.close(); });

function request() {
  return { selector: { kind: 'ship', shipId: argo.shipId }, payload: 'Confirmed', model: 'gpt-6.1-sol', idempotencyKey: 'confirmation' } as const;
}

it('stores the lease and accepted event atomically and preserves the original on retry after re-crew and restart', async () => {
  // Given a committed send under the first authenticated lease.
  const { messageId } = unwrap(await core.useCases.sendMessage(sender, request()));
  const original = await core.prisma.message.findUniqueOrThrow({ where: { id: messageId } });
  expect(original).toMatchObject({ senderLeaseId: sender.leaseId });
  const events = await core.prisma.event.findMany({ where: { messageId, type: 'MessageAccepted' } });
  expect(events).toHaveLength(1);
  expect(events[0]?.details).toMatchObject({ senderLeaseId: sender.leaseId });
  unwrap(await core.useCases.releaseShip(argo, { shipId: sender.shipId }));
  const prompt = unwrap(await core.useCases.getStartingPrompt(argo, { shipId: sender.shipId }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId: sender.shipId, secret: secretOf(prompt.secret), location: { kind: 'SERVER' } }));
  const replacement = unwrap(await core.useCases.authenticate.byCrewToken(crewToken));

  // When a new server handles the replacement crew's duplicate, and then a fresh key.
  const restarted = createUseCases({ prisma: core.prisma, clock: core.clock });
  expect(unwrap(await restarted.sendMessage(replacement, request()))).toEqual({ messageId });
  const fresh = unwrap(await restarted.sendMessage(replacement, { ...request(), idempotencyKey: 'new-confirmation' }));

  // Then the first envelope and event remain unchanged; only the new message names the replacement.
  await expect(core.prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toEqual(original);
  await expect(core.prisma.event.findMany({ where: { messageId, type: 'MessageAccepted' } })).resolves.toEqual(events);
  await expect(createPrismaMessageRepository(core.prisma).find(argo.fleetId, fresh.messageId)).resolves.toMatchObject({ senderLeaseId: replacement.leaseId });
});

it('deploys the additive migration on existing messages and owners, leaves old evidence null and deploys again safely', async () => {
  // Given the pre-migration table with messages, an open lease and an ended lease.
  unwrap(await core.useCases.sendMessage(sender, request()));
  unwrap(await core.useCases.releaseShip(argo, { shipId: sender.shipId }));
  const person = unwrap(await core.useCases.commissionShip(argo, { name: 'person', type: 'person', idempotencyKey: 'person' }));
  // A pre-existing person self-root and its child, alongside argo-owned ships.
  await core.prisma.ship.update({ where: { id: person.shipId }, data: { kind: 'person', ownerShipId: person.shipId } });
  unwrap(await core.useCases.setOwner(argo, { shipId: sender.shipId, ownerShipId: person.shipId }));
  const prompt = unwrap(await core.useCases.getStartingPrompt(argo, { shipId: sender.shipId }));
  unwrap(await core.useCases.claimShip({ shipId: sender.shipId, secret: secretOf(prompt.secret), location: { kind: 'SERVER' } }));
  const owners = await core.prisma.ship.findMany({ orderBy: { id: 'asc' } });
  const deliveries = await core.prisma.delivery.findMany({ orderBy: { id: 'asc' } });
  const leases = await core.prisma.lease.findMany({ orderBy: { id: 'asc' } });
  const events = await core.prisma.event.findMany({ orderBy: { id: 'asc' } });
  await core.prisma.$executeRaw`ALTER TABLE messages DROP COLUMN sender_lease_id`;
  await core.prisma.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = '20261121120000_message_sender_lease'`;
  const before = await core.prisma.$queryRaw`SELECT to_jsonb(m) AS message FROM messages m ORDER BY id`;

  // When normal deployment applies the new migration, including a second startup.
  await migrateDatabase(core.databaseUrl);
  await migrateDatabase(core.databaseUrl);

  // Then no old provenance is inferred and every prior fact is preserved.
  const after = await core.prisma.$queryRaw`SELECT to_jsonb(m) - 'sender_lease_id' AS message FROM messages m ORDER BY id`;
  expect(after).toEqual(before);
  expect(before).toHaveLength(1);
  await expect(core.prisma.message.findMany()).resolves.toEqual([expect.objectContaining({ senderLeaseId: null })]);
  await expect(core.prisma.ship.findMany({ orderBy: { id: 'asc' } })).resolves.toEqual(owners);
  await expect(core.prisma.delivery.findMany({ orderBy: { id: 'asc' } })).resolves.toEqual(deliveries);
  await expect(core.prisma.lease.findMany({ orderBy: { id: 'asc' } })).resolves.toEqual(leases);
  await expect(core.prisma.event.findMany({ orderBy: { id: 'asc' } })).resolves.toEqual(events);
});
