import { commissionShipInputSchema, discoverOutputSchema, fleetListInputSchema } from '@aeolus-fleet/common';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { fleetListingStatement } from '../src/adapters/prisma/registry.js';
import { assertIndexedPlan } from './support/assert-indexed-plan.js';
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
  expect(listed.ships.map((ship) => ({ id: ship.id, kind: 'kind' in ship ? ship.kind : undefined, type: ship.type }))).toEqual([{ id: shipId, kind: 'trierarch', type: 'computer' }]);
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

it('keeps a trierarch report in the existing Report sort and indexed fleet listing', async () => {
  // Given a computer and an agent whose existing lease reports sort in that order.
  for (const input of [
    { idempotencyKey: 'computer', name: 'mac-studio', type: 'trierarch', kind: 'trierarch', note: 'A computer crewing ships' },
    { idempotencyKey: 'agent', name: 'builder', type: 'builder', kind: 'agent', note: 'Z building the fleet' },
  ] as const) {
    const { note, ...ship } = input;
    const commissioned = unwrap(await core.useCases.commissionShip(argo, ship));
    const { crewToken } = unwrap(await core.useCases.claimShip({ shipId: commissioned.shipId, secret: secretOf(commissioned.secret), location: { kind: 'SERVER' } }));
    unwrap(await core.useCases.report(unwrap(await core.useCases.authenticate.byCrewToken(crewToken)), { state: 'working', note }));
  }

  // When the existing API sorts by the reports that survived the kind change.
  const sort = { column: 'report', direction: 'ascending' } as const;
  const listed = await core.useCases.listFleet(argo, { sort });

  // Then the computer report is not treated as empty and the hot read keeps indexed history access.
  expect(listed.ships.map((ship) => ship.name)).toEqual(['mac-studio', 'builder', 'argo']);
  await assertIndexedPlan(core.prisma, fleetListingStatement(argo.fleetId, { limit: 20, filter: { status: ['crewed', 'awaitingCrew'] }, sort, reach: { kind: 'every' } }));
});

it('finds a kind-trierarch ship of another type, but not an agent of type trierarch', async () => {
  // Given a computer with a free type and an unrelated same-type agent.
  const computer = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: 'computer', name: 'mac-studio', type: 'computer', kind: 'trierarch' }));
  unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: 'lookalike', name: 'lookalike', type: 'trierarch', kind: 'agent' }));
  const filter = { kind: ['trierarch'] } as const;

  // When fleet.list selects by the existing kind filter.
  const listed = await core.useCases.listFleet(argo, filter);

  // Then it finds the computer, excludes the agent, and keeps indexed access.
  expect(listed.ships.map((ship) => ship.id)).toEqual([computer.shipId]);
  await assertIndexedPlan(core.prisma, fleetListingStatement(argo.fleetId, { limit: 20, filter, reach: { kind: 'every' } }));
});
