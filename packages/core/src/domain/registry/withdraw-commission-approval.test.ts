import { expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import { createApproveCommission } from './approve-commission.js';
import { createWithdrawCommissionApproval } from './withdraw-commission-approval.js';

it('withdraws the approval once with an event in the same transaction', async () => {
  const core = createInMemoryCore();
  const argo = operatorCaller(await initialiseFleet(core));
  const registry = registryUseCases(core);
  const commissioner = await shipWithScopes({ registry, argo }, { name: 'squadrons', type: 'squadrons', scopes: ['fleet:commission', 'fleet:on-behalf'] });
  const deps = { uow: core.uow, clock: core.clock, ids: core.ids };
  const { approvalId } = unwrap(await createApproveCommission(deps)(argo, { commissionerId: commissioner.shipId, scopes: ['fleet:read'], subjectDigest: 'build' }));

  unwrap(await createWithdrawCommissionApproval(deps)(argo, { approvalId }));
  unwrap(await createWithdrawCommissionApproval(deps)(argo, { approvalId }));

  expect(core.state.commissionApprovals[0]?.withdrawnAt).toEqual(core.clock.now());
  expect(core.state.events.filter((event) => event.type === 'CommissionApprovalWithdrawn')).toEqual([expect.objectContaining({ actor: { kind: 'ship', shipId: argo.shipId }, details: { approvalId }, shipId: commissioner.shipId })]);
});

it('lets the original approver withdraw after losing grant scopes while it retains manage reach', async () => {
  const core = createInMemoryCore();
  const argo = operatorCaller(await initialiseFleet(core));
  const registry = registryUseCases(core);
  const commissioner = await shipWithScopes({ registry, argo }, { name: 'squadrons', type: 'squadrons', scopes: ['fleet:commission', 'fleet:on-behalf'] });
  const approver = await shipWithScopes({ registry, argo }, { name: 'approver', type: 'approver', scopes: ['scopes:grant', 'fleet:commission', 'fleet:on-behalf', 'fleet:read'] });
  const deps = { uow: core.uow, clock: core.clock, ids: core.ids };
  const { approvalId } = unwrap(await createApproveCommission(deps)(approver, { commissionerId: commissioner.shipId, scopes: ['fleet:read'], subjectDigest: 'build' }));
  unwrap(await registry.grantScopes(argo, { shipId: approver.shipId, grant: [], revoke: ['scopes:grant', 'fleet:commission', 'fleet:on-behalf', 'fleet:read'] }));

  const result = await createWithdrawCommissionApproval(deps)(approver, { approvalId });

  expect(result.isOk).toBe(true);
  expect(core.state.commissionApprovals[0]?.withdrawnAt).toEqual(core.clock.now());
});

it('refuses withdrawal outside manage reach even by the original approver', async () => {
  const core = createInMemoryCore();
  const argo = operatorCaller(await initialiseFleet(core));
  const registry = registryUseCases(core);
  const commissioner = await shipWithScopes({ registry, argo }, { name: 'squadrons', type: 'squadrons', scopes: ['fleet:commission', 'fleet:on-behalf'] });
  const approver = await shipWithScopes({ registry, argo }, { name: 'approver', type: 'approver', scopes: ['scopes:grant', 'fleet:commission', 'fleet:on-behalf', 'fleet:read'] });
  const deps = { uow: core.uow, clock: core.clock, ids: core.ids };
  const { approvalId } = unwrap(await createApproveCommission(deps)(approver, { commissionerId: commissioner.shipId, scopes: ['fleet:read'], subjectDigest: 'build' }));
  unwrap(await registry.saveNetworkRulesDraft(argo, { rules: [] }));
  unwrap(await registry.applyNetworkRules(argo, { version: 0 }));

  const result = await createWithdrawCommissionApproval(deps)(approver, { approvalId });

  expect(result).toMatchObject({ isOk: false, error: { kind: 'NOT_REACHABLE' } });
  expect(core.state.commissionApprovals[0]?.withdrawnAt).toBeNull();
});

it('requires another actor to hold approval rights and the approved scopes', async () => {
  const core = createInMemoryCore();
  const argo = operatorCaller(await initialiseFleet(core));
  const registry = registryUseCases(core);
  const commissioner = await shipWithScopes({ registry, argo }, { name: 'squadrons', type: 'squadrons', scopes: ['fleet:commission', 'fleet:on-behalf'] });
  const other = await shipWithScopes({ registry, argo }, { name: 'other', type: 'other', scopes: ['scopes:grant', 'fleet:commission', 'fleet:on-behalf'] });
  const deps = { uow: core.uow, clock: core.clock, ids: core.ids };
  const { approvalId } = unwrap(await createApproveCommission(deps)(argo, { commissionerId: commissioner.shipId, scopes: ['fleet:read'], subjectDigest: 'build' }));

  const result = await createWithdrawCommissionApproval(deps)(other, { approvalId });

  expect(result).toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_HELD' } });
  expect(core.state.commissionApprovals[0]?.withdrawnAt).toBeNull();
});
