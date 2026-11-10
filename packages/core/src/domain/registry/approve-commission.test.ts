import { beforeEach, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import { createApproveCommission } from './approve-commission.js';

let core = createInMemoryCore();
let registry = registryUseCases(core);
let argo: ReturnType<typeof operatorCaller>;

beforeEach(async () => {
  core = createInMemoryCore();
  argo = operatorCaller(await initialiseFleet(core));
  registry = registryUseCases(core);
});

it('records who approved exact scopes for a permitted commissioner and immutable subject', async () => {
  const { shipId } = unwrap(await registry.commissionShip(argo, { name: 'squadrons', type: 'squadrons', scopes: ['fleet:commission', 'fleet:on-behalf'], idempotencyKey: 'squadrons' }));

  const { approvalId } = unwrap(await createApproveCommission({ uow: core.uow, clock: core.clock, ids: core.ids })(argo, { commissionerId: shipId, scopes: ['fleet:read'], subjectDigest: 'built-baker-v1' }));

  expect(core.state.commissionApprovals).toEqual([{ id: approvalId, fleetId: argo.fleetId, approver: { kind: 'ship', shipId: argo.shipId }, commissionerId: shipId, scopes: ['fleet:read'], subjectDigest: 'built-baker-v1', createdAt: core.clock.now(), withdrawnAt: null }]);
  expect(core.state.events.at(-1)).toMatchObject({ type: 'CommissionApproved', actor: { kind: 'ship', shipId: argo.shipId }, shipId, details: { approvalId, subjectDigest: 'built-baker-v1', scopes: 'fleet:read' } });
});
