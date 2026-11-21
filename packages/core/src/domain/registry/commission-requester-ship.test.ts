/** Approved #1990 scenarios: owner choice never supplies scope authority. */
import { beforeEach, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import { createApproveCommission } from './approve-commission.js';
import { createWithdrawCommissionApproval } from './withdraw-commission-approval.js';

let core = createInMemoryCore();
let registry = registryUseCases(core);
let argo: ShipCaller;
let commissioner: ShipCaller;
let requester: ShipCaller;
const request = { name: 'helper', type: 'reviewer', idempotencyKey: 'helper', ownership: 'requester' as const };

beforeEach(async () => {
  core = createInMemoryCore();
  argo = operatorCaller(await initialiseFleet(core));
  registry = registryUseCases(core);
  commissioner = await shipWithScopes({ registry, argo }, { name: 'commissioner', type: 'agent', scopes: ['fleet:commission', 'fleet:on-behalf'] });
  requester = await shipWithScopes({ registry, argo }, { name: 'requester', type: 'agent', scopes: ['fleet:read'] });
});

it.each(['person', 'agent', 'app'] as const)('the requesting %s owns the new ship with askingShip evidence', async (kind) => {
  // Given an active eligible requester.
  const { shipId: ownerOf } = unwrap(await registry.commissionShip(argo, { name: kind, type: kind, kind, idempotencyKey: kind }));

  // When its commissioner explicitly selects the requester.
  const first = unwrap(await registry.commissionShip(commissioner, { ...request, ownerOf }));

  // Then owner and event agree, and only the first answer carries credentials.
  expect(core.state.ships.find((ship) => ship.id === first.shipId)?.owner).toBe(ownerOf);
  expect(core.state.events.filter((event) => event.shipId === first.shipId && event.type === 'OwnerSet').map((event) => event.details)).toEqual([{ ownerShipId: ownerOf, how: 'askingShip', askingShipId: ownerOf }]);
  expect(first.secret).toEqual(expect.any(String));
  expect(first.startingPrompt).toEqual({ issuedAt: core.clock.now(), isClaimed: false });
});

it.each(['omitted', 'explicit'] as const)('inherited mode %s retains the old hash and both default spellings replay it', async (mode) => {
  // Given a commission stored under the legacy inherited hash shape.
  const input = { name: 'helper', type: 'reviewer', idempotencyKey: 'helper', ownerOf: requester.shipId };
  const first = unwrap(await registry.commissionShip(commissioner, { ...input, ...(mode === 'explicit' ? { ownership: 'requester-owner' as const } : {}) }));
  const before = structuredClone(core.state);

  // When retried with both spellings of the inherited default.
  const omitted = unwrap(await registry.commissionShip(commissioner, input));
  const explicit = unwrap(await registry.commissionShip(commissioner, { ...input, ownership: 'requester-owner' }));

  // Then neither consumes a second key or changes any facts.
  expect(omitted).toEqual({ ...first, secret: null });
  expect(explicit).toEqual(omitted);
  expect(core.state).toEqual(before);
  expect(core.state.ships.find((ship) => ship.id === first.shipId)?.owner).toBe(argo.shipId);
  expect(core.state.events.find((event) => event.type === 'OwnerSet' && event.shipId === first.shipId)?.details).toEqual({ ownerShipId: argo.shipId, askingShipId: requester.shipId, how: 'askingShipOwner' });
});

it.each(['requester', 'requester-owner'] as const)('changing %s mode under the same key refuses without writes', async (ownership) => {
  // Given an existing commission in one mode.
  const input = { ...request, ownerOf: requester.shipId, ownership };
  unwrap(await registry.commissionShip(commissioner, input));
  const before = structuredClone(core.state);

  // When the same key selects the other mode.
  const result = await registry.commissionShip(commissioner, { ...input, ownership: ownership === 'requester' ? 'requester-owner' : 'requester' });

  // Then the request cannot be repurposed.
  expect(result).toMatchObject({ isOk: false, error: { kind: 'IDEMPOTENCY_KEY_REUSED' } });
  expect(core.state).toEqual(before);
});

it('a requester replay preserves a later owner change and returns no secret', async () => {
  // Given the commissioned ship has since moved to another owner.
  const input = { ...request, ownerOf: requester.shipId };
  const first = unwrap(await registry.commissionShip(commissioner, input));
  unwrap(await registry.setOwner(argo, { shipId: first.shipId, ownerShipId: argo.shipId }));
  const before = structuredClone(core.state);

  // When the original commission is retried.
  const replay = unwrap(await registry.commissionShip(commissioner, input));

  // Then its owner and events remain untouched.
  expect(replay).toEqual({ ...first, secret: null });
  expect(core.state).toEqual(before);
});

it.each(['requester', 'requester-owner'] as const)('live requester scopes supply authority in %s mode', async (ownership) => {
  // Given a requester that holds fleet:read but whose owner argo holds everything.
  const input = { ...request, ownerOf: requester.shipId, ownership, scopes: ['fleet:read'] };

  // When commissioning an authorised subset, then trying the owner's fleet:manage.
  const first = unwrap(await registry.commissionShip(commissioner, input));
  const before = structuredClone(core.state);
  const refused = await registry.commissionShip(commissioner, { ...input, name: 'other', idempotencyKey: 'other', scopes: ['fleet:manage'] });

  // Then the requester is the recorded scope source and refusal stores nothing.
  expect(core.state.ships.find((ship) => ship.id === first.shipId)?.scopes).toEqual(['messages:send', 'messages:receive', 'fleet:read']);
  expect(core.state.events.find((event) => event.shipId === first.shipId && event.type === 'ShipCommissioned')?.details).toMatchObject({ scopesFrom: requester.shipId });
  expect(refused).toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_HELD' } });
  expect(core.state).toEqual(before);
});

it.each(['fleet:read', 'fleet:on-behalf', 'fleet:commission'] as const)('revoked live %s refuses without writes or key consumption', async (scope) => {
  // Given the live authority has been revoked despite the stale caller object.
  const shipId = scope === 'fleet:read' ? requester.shipId : commissioner.shipId;
  unwrap(await registry.grantScopes(argo, { shipId, grant: [], revoke: [scope] }));
  const before = structuredClone(core.state);
  const input = { ...request, ownerOf: requester.shipId, scopes: ['fleet:read'] };

  // When commissioning in requester mode.
  const refused = await registry.commissionShip(commissioner, input);

  // Then restoring authority can reuse that same unconsumed key.
  expect(refused).toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_HELD' } });
  expect(core.state).toEqual(before);
  unwrap(await registry.grantScopes(argo, { shipId, grant: [scope], revoke: [] }));
  expect(unwrap(await registry.commissionShip(commissioner, input)).secret).toEqual(expect.any(String));
});

it.each(['missing', 'retired', 'plugin'] as const)('a %s requester refuses without writes or key consumption', async (state) => {
  // Given a missing, retired or ineligible requester.
  let ownerOf = requester.shipId;
  if (state === 'missing') ownerOf = core.ids('ship');
  if (state === 'retired') unwrap(await registry.retireShip(argo, { shipId: ownerOf }));
  if (state === 'plugin') ({ shipId: ownerOf } = unwrap(await registry.commissionShip(argo, { name: 'plugin', type: 'plugin', kind: 'plugin', idempotencyKey: 'plugin' })));
  const before = structuredClone(core.state);

  // When selecting it as the owner.
  const refused = await registry.commissionShip(commissioner, { ...request, ownerOf });

  // Then no facts or key are stored.
  expect(refused).toMatchObject({ isOk: false, error: { kind: state === 'missing' ? 'SHIP_NOT_FOUND' : state === 'retired' ? 'SHIP_ALREADY_RETIRED' : 'INVALID_OWNER' } });
  expect(core.state).toEqual(before);
  expect(unwrap(await registry.commissionShip(commissioner, { ...request, ownerOf: argo.shipId })).secret).toEqual(expect.any(String));
});

it.each(['requester', 'requester-owner'] as const)('approval authority and withdrawal remain independent of %s ownership', async (ownership) => {
  // Given a recorded approval grants what the requester no longer holds.
  const { approvalId } = unwrap(await createApproveCommission({ uow: core.uow, clock: core.clock, ids: core.ids })(argo, { commissionerId: commissioner.shipId, subjectDigest: 'approved-template', scopes: ['fleet:manage'] }));
  const input = { ...request, ownerOf: requester.shipId, ownership, scopes: ['fleet:manage'], approval: { approvalId, subjectDigest: 'approved-template' } };
  const first = unwrap(await registry.commissionShip(commissioner, input));
  unwrap(await createWithdrawCommissionApproval({ uow: core.uow, clock: core.clock, ids: core.ids })(argo, { approvalId }));
  const before = structuredClone(core.state);

  // When replaying the completed request and attempting a new one after withdrawal.
  const replay = unwrap(await registry.commissionShip(commissioner, input));
  const refused = await registry.commissionShip(commissioner, { ...input, name: 'other', idempotencyKey: 'other' });

  // Then approval stays the source, replay is safe and withdrawal prevents new writes.
  expect(core.state.events.find((event) => event.type === 'ShipCommissioned' && event.shipId === first.shipId)?.details).toMatchObject({ approvalId, subjectDigest: 'approved-template' });
  expect(core.state.events.find((event) => event.type === 'ShipCommissioned' && event.shipId === first.shipId)?.details).not.toHaveProperty('scopesFrom');
  expect(core.state.ships.find((ship) => ship.id === first.shipId)?.owner).toBe(ownership === 'requester' ? requester.shipId : argo.shipId);
  expect(replay).toEqual({ ...first, secret: null });
  expect(refused).toMatchObject({ isOk: false, error: { kind: 'COMMISSION_APPROVAL_WITHDRAWN' } });
  expect(core.state).toEqual(before);
});

it.each(['requester', 'requester-owner'] as const)('domain refuses %s without ownerOf or beside owner without writes', async (ownership) => {
  // Given an owner choice without its requester, or beside an explicit owner.
  const before = structuredClone(core.state);

  // When trusted domain callers bypass the public schema.
  const absent = await registry.commissionShip(commissioner, { ...request, ownership });
  const conflicting = await registry.commissionShip(commissioner, { ...request, kind: 'app', ownership, ownerOf: requester.shipId, owner: argo.shipId });

  // Then invalid assignments consume no state or key.
  expect(absent).toMatchObject({ isOk: false, error: { kind: 'INVALID_OWNER' } });
  expect(conflicting).toMatchObject({ isOk: false, error: { kind: 'INVALID_OWNER' } });
  expect(core.state).toEqual(before);
});
