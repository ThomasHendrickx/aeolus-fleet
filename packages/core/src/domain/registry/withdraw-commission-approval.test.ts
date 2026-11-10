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
