import type { ShipCaller } from '../shared/caller.js';
import { createApproveCommission } from './approve-commission.js';
import { createWithdrawCommissionApproval } from './withdraw-commission-approval.js';
import { beforeEach, expect, it } from 'vitest';
import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';

let core = createInMemoryCore();
let registry = registryUseCases(core);
let argo: ShipCaller;
let commissioner: ShipCaller;
let requester: ShipCaller;
const SUBJECT = 'baker-built-hash-v1';
const request = { name: 'baker', type: 'baker', idempotencyKey: 'baker-request', scopes: ['fleet:read'] };

beforeEach(async () => {
  core = createInMemoryCore();
  argo = operatorCaller(await initialiseFleet(core));
  registry = registryUseCases(core);
  commissioner = await shipWithScopes({ registry, argo }, { type: 'agent', name: 'squadrons', scopes: ['fleet:commission', 'fleet:on-behalf'] });
  const { shipId } = unwrap(await registry.commissionShip(argo, { name: 'becky', type: 'person', kind: 'person', idempotencyKey: 'becky' }));
  requester = { shipId, fleetId: argo.fleetId, kind: 'person', scopes: ['messages:send', 'messages:receive'] };
});

async function approved() {
  return unwrap(await createApproveCommission({ uow: core.uow, clock: core.clock, ids: core.ids })(argo, { commissionerId: commissioner.shipId, subjectDigest: SUBJECT, scopes: ['fleet:read'] }));
}
function withdraw() { return createWithdrawCommissionApproval({ uow: core.uow, clock: core.clock, ids: core.ids }); }

it('commissions approved scopes independently of requester ownership and records their source', async () => {
  const { approvalId } = await approved();

  const { shipId } = unwrap(await registry.commissionShip(commissioner, { ...request, ownerOf: requester.shipId, approval: { approvalId, subjectDigest: SUBJECT } }));

  expect(core.state.ships.find((ship) => ship.id === shipId)).toMatchObject({ owner: requester.shipId, scopes: ['messages:send', 'messages:receive', 'fleet:read'] });
  expect(core.state.events.find((event) => event.shipId === shipId && event.type === 'ShipCommissioned')?.details).toMatchObject({ approvalId, subjectDigest: SUBJECT });
  expect(core.state.events.find((event) => event.shipId === shipId && event.type === 'ShipCommissioned')?.details).not.toHaveProperty('scopesFrom');
});

it.each([
  ['another build', 'build'],
  ['a moved version tag or changed base', 'rebuilt'],
])('refuses %s under an existing approval', async (_name, subjectDigest) => {
  const { approvalId } = await approved();
  const before = structuredClone(core.state);

  const result = await registry.commissionShip(commissioner, { ...request, ownerOf: requester.shipId, approval: { approvalId, subjectDigest } });

  expect(result).toMatchObject({ isOk: false, error: { kind: 'COMMISSION_APPROVAL_MISMATCH' } });
  expect(core.state).toEqual(before);
});

it('refuses requested scopes outside the approved subset', async () => {
  const { approvalId } = await approved();

  const result = await registry.commissionShip(commissioner, { ...request, scopes: ['fleet:manage'], ownerOf: requester.shipId, approval: { approvalId, subjectDigest: SUBJECT } });

  expect(result).toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_HELD' } });
  expect(core.state.ships.some((ship) => ship.name === 'baker')).toBe(false);
});

it('allows a subset and reuse of the same approval', async () => {
  const { approvalId } = await approved();
  const approval = { approvalId, subjectDigest: SUBJECT };

  unwrap(await registry.commissionShip(commissioner, { ...request, scopes: [], ownerOf: requester.shipId, approval }));
  unwrap(await registry.commissionShip(commissioner, { ...request, name: 'baker-two', idempotencyKey: 'two', ownerOf: requester.shipId, approval }));

  expect(core.state.ships.filter((ship) => ship.type === 'baker')).toHaveLength(2);
});

it('refuses a different commissioner even if it holds the approved scopes', async () => {
  const { approvalId } = await approved();

  const result = await registry.commissionShip(argo, { ...request, ownerOf: requester.shipId, approval: { approvalId, subjectDigest: SUBJECT } });

  expect(result).toMatchObject({ isOk: false, error: { kind: 'COMMISSION_APPROVAL_MISMATCH' } });
});

it('refuses an approval from a different fleet', async () => {
  const { approvalId } = await approved();
  const otherFleet = core.ids('fleet');

  const result = await registry.commissionShip({ ...commissioner, fleetId: otherFleet }, { ...request, approval: { approvalId, subjectDigest: SUBJECT } });

  expect(result.isOk).toBe(false);
  expect(core.state.ships.some((ship) => ship.name === 'baker')).toBe(false);
});

it.each(['commissioner', 'requester'])('refuses a retired %s', async (retired) => {
  const { approvalId } = await approved();
  const shipId = retired === 'commissioner' ? commissioner.shipId : requester.shipId;
  unwrap(await registry.retireShip(argo, { shipId }));

  const result = await registry.commissionShip(commissioner, { ...request, ownerOf: requester.shipId, approval: { approvalId, subjectDigest: SUBJECT } });

  expect(result).toMatchObject({ isOk: false, error: { kind: 'SHIP_ALREADY_RETIRED' } });
});

it.each(['fleet:commission', 'fleet:on-behalf'])('checks the commissioner live authority for %s', async (scope) => {
  const { approvalId } = await approved();
  unwrap(await registry.grantScopes(argo, { shipId: commissioner.shipId, grant: [], revoke: [scope] }));

  const result = await registry.commissionShip(commissioner, { ...request, ownerOf: requester.shipId, approval: { approvalId, subjectDigest: SUBJECT } });

  expect(result).toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_HELD' } });
});

it('keeps approval after its approver loses grant authority', async () => {
  const approver = await shipWithScopes({ registry, argo }, { type: 'agent', name: 'approver', scopes: ['scopes:grant', 'fleet:commission', 'fleet:on-behalf', 'fleet:read'] });
  const { approvalId } = unwrap(await createApproveCommission({ uow: core.uow, clock: core.clock, ids: core.ids })(approver, { commissionerId: commissioner.shipId, scopes: ['fleet:read'], subjectDigest: SUBJECT }));
  unwrap(await registry.grantScopes(argo, { shipId: approver.shipId, grant: [], revoke: ['fleet:read', 'scopes:grant'] }));

  const result = await registry.commissionShip(commissioner, { ...request, ownerOf: requester.shipId, approval: { approvalId, subjectDigest: SUBJECT } });

  expect(result.isOk).toBe(true);
});

it('withdrawal stops new commissions and preserves completed retries and ships', async () => {
  const { approvalId } = await approved();
  const input = { ...request, ownerOf: requester.shipId, approval: { approvalId, subjectDigest: SUBJECT } };
  const first = unwrap(await registry.commissionShip(commissioner, input));

  unwrap(await withdraw()(argo, { approvalId }));
  const again = unwrap(await registry.commissionShip(commissioner, input));
  const refused = await registry.commissionShip(commissioner, { ...input, name: 'baker-two', idempotencyKey: 'two' });

  expect(again).toMatchObject({ shipId: first.shipId, secret: null });
  expect(refused).toMatchObject({ isOk: false, error: { kind: 'COMMISSION_APPROVAL_WITHDRAWN' } });
  expect(core.state.ships.find((ship) => ship.id === first.shipId)).toMatchObject({ retiredAt: null, scopes: ['messages:send', 'messages:receive', 'fleet:read'] });
});
