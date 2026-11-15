import { commissionShipInputSchema, discoverOutputSchema, fleetListInputSchema } from '@aeolus-fleet/common';
import { afterEach, beforeEach, expect, it } from 'vitest';

import type { ShipCaller } from '../src/domain/shared/caller.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

/** The approved trierarch-kind design: commission, discover and filter the same durable kind. */
let core: PostgresCore;
let argo: ShipCaller;

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'home' })));
});

afterEach(async () => { await core.close(); });

it('commissions a trierarch with its own kind and discovers and filters it without changing its free type', async () => {
  // Given the plugin commissions a computer and an unrelated agent uses the same type.
  const input = commissionShipInputSchema.parse({ idempotencyKey: 'computer', name: 'mac-studio', type: 'computer', kind: 'trierarch', scopes: ['crew:run'] });
  unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: 'lookalike', name: 'lookalike', type: 'trierarch' }));

  // When the computer is commissioned and the existing API kind filters and discovery read it.
  const { shipId } = unwrap(await core.useCases.commissionShip(argo, input));
  const listed = await core.useCases.listFleet(argo, fleetListInputSchema.parse({ shipKind: ['trierarch'] }));
  const discovered = discoverOutputSchema.parse(unwrap(await core.useCases.discover(argo)));

  // Then its kind is durable, its type stays free, and it is separate from agents.
  expect(listed.ships.map(({ id, kind, type }) => ({ id, kind, type }))).toEqual([{ id: shipId, kind: 'trierarch', type: 'computer' }]);
  expect(discovered.ships.find((ship) => ship.id === shipId)).toMatchObject({ kind: 'trierarch', type: 'computer' });
  await expect(core.prisma.ship.findUnique({ where: { id: shipId } })).resolves.toMatchObject({ kind: 'trierarch', type: 'computer', ownerShipId: argo.shipId });
});

it('lets a trierarch send without a model and refuses a stated model because only agents state one', async () => {
  // Given a crewed computer's trierarch ship.
  const input = commissionShipInputSchema.parse({ idempotencyKey: 'computer', name: 'mac-studio', type: 'trierarch', kind: 'trierarch' });
  const commissioned = unwrap(await core.useCases.commissionShip(argo, input));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId: commissioned.shipId, secret: secretOf(commissioned.secret), location: { kind: 'SERVER' } }));
  const crew = unwrap(await core.useCases.authenticate.byCrewToken(crewToken));

  // When it sends with and without a model.
  const unstated = await core.useCases.sendMessage(crew, { selector: { kind: 'ship', name: 'argo' }, payload: 'Crewing 4 ships', contentType: 'text/plain', idempotencyKey: 'unstated' });
  const stated = await core.useCases.sendMessage(crew, { selector: { kind: 'ship', name: 'argo' }, payload: 'Crewing 4 ships', contentType: 'text/plain', idempotencyKey: 'stated', model: 'gpt-6.1-sol' });

  // Then only the send without a model is accepted.
  expect(unstated.isOk).toBe(true);
  expect(stated).toMatchObject({ isOk: false, error: { message: 'A trierarch ship states no model: send without one' } });
});
