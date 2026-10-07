import { CLEAR_REQUESTS_PER_TRIERARCH_MAX } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Caller } from '../src/domain/shared/caller.js';
import { OPERATOR, operatorCaller } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// Clear requests on a real Postgres (decision 0032): one per trierarch, ship
// and repository, read by fleet:read and by their trierarch, confirmed by it,
// gone with its retire, and never more than the limit, even at once.

let core: PostgresCore;
let argo: Caller;
let trierarch: Caller;
let scoutId: Caller['shipId'];

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const { shipId: trierarchId } = unwrap(
    await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'mac-mini', type: 'trierarch', fleetScopes: ['crew:run'] }),
  );
  trierarch = { fleetId: argo.fleetId, shipId: trierarchId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:run'] };
  ({ shipId: scoutId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  core.clock.advance(60_000);
});

afterEach(async () => {
  await core.close();
});

function clearOf(repository: string) {
  return core.useCases.requestWorktreeClear(argo, { trierarchShipId: trierarch.shipId, shipId: scoutId, repository });
}

describe('a clear request on Postgres', () => {
  it('is stored once per trierarch, ship and repository, with WorktreeClearRequested once, and read by fleet:read and by its trierarch', async () => {
    unwrap(await clearOf('aeolus-fleet'));
    unwrap(await clearOf('aeolus-fleet'));

    const pending = { trierarchShipId: trierarch.shipId, shipId: scoutId, repository: 'aeolus-fleet', requestedBy: argo.shipId, requestedAt: core.clock.now() };
    await expect(core.useCases.readClearRequests(argo)).resolves.toEqual([pending]);
    await expect(core.useCases.readClearRequests(trierarch)).resolves.toEqual([pending]);
    await expect(core.prisma.event.findMany({ where: { type: 'WorktreeClearRequested' }, select: { shipId: true, details: true } })).resolves.toEqual([
      { shipId: trierarch.shipId, details: { worktreeShipId: scoutId, repository: 'aeolus-fleet' } },
    ]);
  });

  it('goes once its trierarch confirms, with WorktreeCleared and the outcome', async () => {
    unwrap(await clearOf('aeolus-fleet'));

    unwrap(await core.useCases.confirmWorktreeCleared(trierarch, { shipId: scoutId, repository: 'aeolus-fleet', outcome: 'removed' }));

    await expect(core.useCases.readClearRequests(argo)).resolves.toEqual([]);
    await expect(core.prisma.event.findMany({ where: { type: 'WorktreeCleared' }, select: { shipId: true, details: true } })).resolves.toEqual([
      { shipId: trierarch.shipId, details: { worktreeShipId: scoutId, repository: 'aeolus-fleet', outcome: 'removed' } },
    ]);
  });

  it('goes with its trierarch retired, with WorktreeClearRemoved', async () => {
    unwrap(await clearOf('aeolus-fleet'));

    unwrap(await core.useCases.retireShip(argo, { shipId: trierarch.shipId }));

    await expect(core.useCases.readClearRequests(argo)).resolves.toEqual([]);
    await expect(core.prisma.event.count({ where: { type: 'WorktreeClearRemoved', shipId: trierarch.shipId } })).resolves.toBe(1);
  });

  it('never passes the limit, even with two requests at once for the last place', async () => {
    for (let index = 0; index < CLEAR_REQUESTS_PER_TRIERARCH_MAX - 1; index += 1) {
      unwrap(await clearOf(`repository-${String(index)}`));
    }

    const answers = await Promise.all([clearOf('one'), clearOf('two')]);

    expect(answers.map((answer) => (answer.isOk ? 'ok' : answer.error.kind)).sort()).toEqual(['CLEAR_REQUEST_LIMIT_REACHED', 'ok']);
    await expect(core.prisma.worktreeClearRequest.count({ where: { trierarchShipId: trierarch.shipId } })).resolves.toBe(CLEAR_REQUESTS_PER_TRIERARCH_MAX);
  });
});
