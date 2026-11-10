import type { Scope } from '@aeolus-fleet/common';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
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

const APPROVAL_SCOPES: Scope[] = ['scopes:grant', 'fleet:commission', 'fleet:on-behalf', 'fleet:read'];

it.each(['scopes:grant', 'fleet:commission', 'fleet:on-behalf'])('refuses approval without %s', async (missing) => {
  const commissioner = await shipWithScopes({ registry, argo }, { type: 'agent', name: 'squadrons', scopes: [] });
  const approver = await shipWithScopes({ registry, argo }, { type: 'agent', name: 'approver', scopes: APPROVAL_SCOPES.filter((scope) => scope !== missing) });
  const before = structuredClone(core.state);

  const result = await createApproveCommission({ uow: core.uow, clock: core.clock, ids: core.ids })(approver, { commissionerId: commissioner.shipId, scopes: ['fleet:read'], subjectDigest: 'build' });

  expect(result).toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_HELD' } });
  expect(core.state).toEqual(before);
});

it('refuses approval of scopes the approver cannot grant', async () => {
  const commissioner = await shipWithScopes({ registry, argo }, { type: 'agent', name: 'squadrons', scopes: [] });
  const approver = await shipWithScopes({ registry, argo }, { type: 'agent', name: 'approver', scopes: ['scopes:grant', 'fleet:commission', 'fleet:on-behalf'] });

  const result = await createApproveCommission({ uow: core.uow, clock: core.clock, ids: core.ids })(approver, { commissionerId: commissioner.shipId, scopes: ['fleet:read'], subjectDigest: 'build' });

  expect(result).toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_HELD' } });
  expect(core.state.commissionApprovals).toEqual([]);
});

it('refuses approval outside manage reach and keeps only the refusal', async () => {
  const commissioner = await shipWithScopes({ registry, argo }, { type: 'agent', name: 'squadrons', scopes: [] });
  const approver = await shipWithScopes({ registry, argo }, { type: 'agent', name: 'approver', scopes: ['scopes:grant', 'fleet:commission', 'fleet:on-behalf', 'fleet:read'] });
  unwrap(await registry.saveNetworkRulesDraft(argo, { rules: [] }));
  unwrap(await registry.applyNetworkRules(argo, { version: 0 }));

  const result = await createApproveCommission({ uow: core.uow, clock: core.clock, ids: core.ids })(approver, { commissionerId: commissioner.shipId, scopes: ['fleet:read'], subjectDigest: 'build' });

  expect(result).toMatchObject({ isOk: false, error: { kind: 'NOT_REACHABLE' } });
  expect(core.state.commissionApprovals).toEqual([]);
  expect(core.state.reachRefusals).toHaveLength(1);
});
