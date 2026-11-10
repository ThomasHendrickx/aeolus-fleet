import { createIdGenerator, SCOPES, type CommissionApprovalId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { cryptoRandomTokens, sha256Hasher } from '../src/adapters/crypto/secrets.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { createUseCases } from '../src/wiring.js';
import { createCommissionShip } from '../src/domain/registry/commission-ship.js';
import { createWithdrawCommissionApproval } from '../src/domain/registry/withdraw-commission-approval.js';
import { createApproveCommission } from '../src/domain/registry/approve-commission.js';
import { unwrap } from '../src/testing/result.js';
import { createPostgresCore, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { withOperatorLogin } from './support/operator-login.js';

let core: PostgresCore;
let argo: ShipCaller;
let commissioner: ShipCaller;
let ownerOf: ShipId;
const SUBJECT = 'built-hash-v1';

beforeEach(async () => {
  core = await createPostgresCore();
  const { fleetId, operatorShipId } = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home' })));
  argo = { fleetId, shipId: operatorShipId, kind: 'operator', scopes: SCOPES };
  const { shipId } = unwrap(await core.useCases.commissionShip(argo, { name: 'squadrons', type: 'squadrons', scopes: ['fleet:commission', 'fleet:on-behalf'], idempotencyKey: 'squadrons' }));
  commissioner = { fleetId, shipId, kind: 'agent', scopes: ['fleet:commission', 'fleet:on-behalf'] };
  ownerOf = unwrap(await core.useCases.commissionShip(argo, { name: 'requester', type: 'person', kind: 'person', idempotencyKey: 'requester' })).shipId;
});
afterEach(async () => { await core.close(); });

async function approved() {
  return unwrap(await core.useCases.approveCommission(argo, { commissionerId: commissioner.shipId, scopes: ['fleet:read'], subjectDigest: SUBJECT }));
}
function request(approvalId: CommissionApprovalId) {
  return { name: 'baker', type: 'baker', scopes: ['fleet:read'], ownerOf, approval: { approvalId, subjectDigest: SUBJECT }, idempotencyKey: 'baker' };
}

it('keeps approval and its event across restart and commissions with requester ownership', async () => {
  const { approvalId } = await approved();

  const restarted = createUseCases({ prisma: core.prisma, clock: core.clock });
  const { shipId } = unwrap(await restarted.commissionShip(commissioner, request(approvalId)));

  await expect(core.prisma.ship.findUnique({ where: { id: shipId } })).resolves.toMatchObject({ ownerShipId: ownerOf, scopes: ['messages:send', 'messages:receive', 'fleet:read'] });
  await expect(core.prisma.event.findMany({ where: { fleetId: argo.fleetId, type: 'CommissionApproved' } })).resolves.toHaveLength(1);
  await expect(core.prisma.event.findFirst({ where: { shipId, type: 'ShipCommissioned' } })).resolves.toMatchObject({ details: { approvalId, subjectDigest: SUBJECT } });
});

it('orders withdrawal before a racing commission so no new ship is commissioned', async () => {
  const { approvalId } = await approved();
  const held = heldUnitOfWork(core.prisma, (tx, hold) => ({ ...tx, commissionApprovals: { ...tx.commissionApprovals, withdraw: async (...args) => { await tx.commissionApprovals.withdraw(...args); await hold(); } } }));
  const withdraw = createWithdrawCommissionApproval({ uow: held.uow, clock: core.clock, ids: createIdGenerator() });

  const withdrawing = withdraw(argo, { approvalId });
  await held.reached;
  const commissioning = core.useCases.commissionShip(commissioner, request(approvalId));
  unwrap(await withdrawing);

  await expect(commissioning).resolves.toMatchObject({ isOk: false, error: { kind: 'COMMISSION_APPROVAL_WITHDRAWN' } });
  await expect(core.prisma.ship.count({ where: { fleetId: argo.fleetId, name: 'baker' } })).resolves.toBe(0);
});

it('orders a racing commission before withdrawal and keeps its completed retry', async () => {
  const { approvalId } = await approved();
  const held = heldUnitOfWork(core.prisma, (tx, hold) => ({ ...tx, commissionApprovals: { ...tx.commissionApprovals, findForUpdate: async (...args) => { const approval = await tx.commissionApprovals.findForUpdate(...args); await hold(); return approval; } } }));
  const commission = createCommissionShip({ uow: held.uow, clock: core.clock, ids: createIdGenerator(), secrets: { hasher: sha256Hasher, random: cryptoRandomTokens } });

  const commissioning = commission(commissioner, request(approvalId));
  await held.reached;
  const withdrawing = core.useCases.withdrawCommissionApproval(argo, { approvalId });
  const original = unwrap(await commissioning);
  unwrap(await withdrawing);

  await expect(core.useCases.commissionShip(commissioner, request(approvalId))).resolves.toMatchObject({ isOk: true, value: { shipId: original.shipId, secret: null } });
  await expect(core.prisma.ship.count({ where: { fleetId: argo.fleetId, name: 'baker' } })).resolves.toBe(1);
});

it('rolls back approval when its event cannot be recorded', async () => {
  const held = heldUnitOfWork(core.prisma, (tx) => ({ ...tx, events: { ...tx.events, append: () => Promise.reject(new Error('event failed')) } }));
  const approve = createApproveCommission({ uow: held.uow, clock: core.clock, ids: createIdGenerator() });

  await expect(approve(argo, { commissionerId: commissioner.shipId, scopes: ['fleet:read'], subjectDigest: SUBJECT })).rejects.toThrow('event failed');

  await expect(core.prisma.commissionApproval.count({ where: { fleetId: argo.fleetId } })).resolves.toBe(0);
  await expect(core.prisma.event.count({ where: { fleetId: argo.fleetId, type: 'CommissionApproved' } })).resolves.toBe(0);
});

it('rolls back withdrawal and its event when recording the event fails', async () => {
  const { approvalId } = await approved();
  const held = heldUnitOfWork(core.prisma, (tx) => ({ ...tx, events: { ...tx.events, append: () => Promise.reject(new Error('event failed')) } }));
  const withdraw = createWithdrawCommissionApproval({ uow: held.uow, clock: core.clock, ids: createIdGenerator() });

  await expect(withdraw(argo, { approvalId })).rejects.toThrow('event failed');

  await expect(core.prisma.commissionApproval.findUnique({ where: { id: approvalId } })).resolves.toMatchObject({ withdrawnAt: null });
  await expect(core.prisma.event.count({ where: { fleetId: argo.fleetId, type: 'CommissionApprovalWithdrawn' } })).resolves.toBe(0);
});

it('rolls back an approved commission without a ship, credential or commission event', async () => {
  const { approvalId } = await approved();
  const before = { ships: await core.prisma.ship.count(), credentials: await core.prisma.credential.count(), events: await core.prisma.event.count() };
  const held = heldUnitOfWork(core.prisma, (tx) => ({ ...tx, events: { ...tx.events, append: () => Promise.reject(new Error('event failed')) } }));
  const commission = createCommissionShip({ uow: held.uow, clock: core.clock, ids: createIdGenerator(), secrets: { hasher: sha256Hasher, random: cryptoRandomTokens } });

  await expect(commission(commissioner, request(approvalId))).rejects.toThrow('event failed');

  expect({ ships: await core.prisma.ship.count(), credentials: await core.prisma.credential.count(), events: await core.prisma.event.count() }).toEqual(before);
});
