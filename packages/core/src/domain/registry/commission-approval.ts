/** A bounded grant for commission, independent of the owner of the resulting ship (0045/0046). */
import type { CommissionApprovalId, FleetId, ShipId } from '@aeolus-fleet/common';

import type { Actor } from '../shared/events.js';

export interface CommissionApproval {
  readonly id: CommissionApprovalId;
  readonly fleetId: FleetId;
  readonly approver: Actor;
  readonly commissionerId: ShipId;
  readonly scopes: readonly string[];
  readonly subjectDigest: string;
  readonly createdAt: Date;
  readonly withdrawnAt: Date | null;
}

/** Approval and commission hold the same row until their transaction ends. */
export interface CommissionApprovalRepository {
  create(approval: CommissionApproval): Promise<void>;
  findForUpdate(fleetId: FleetId, id: CommissionApprovalId): Promise<CommissionApproval | undefined>;
  withdraw(input: { fleetId: FleetId; id: CommissionApprovalId; at: Date }): Promise<void>;
}
