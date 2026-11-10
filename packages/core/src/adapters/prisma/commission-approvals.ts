/** Fleet-scoped approvals. Commission and withdrawal both hold the approval row FOR UPDATE. */
import { commissionApprovalRecordSchema } from '@aeolus-fleet/common';

import type { CommissionApprovalRepository } from '../../domain/registry/commission-approval.js';
import type { Db } from './client.js';

export function createPrismaCommissionApprovalRepository(db: Db): CommissionApprovalRepository {
  return {
    create: async (approval) => {
      await db.commissionApproval.create({ data: { ...approval, approver: { ...approval.approver }, scopes: [...approval.scopes] } });
    },
    findForUpdate: async (fleetId, id) => {
      const [row] = await db.$queryRaw<unknown[]>`
        SELECT id, fleet_id AS "fleetId", approver, commissioner_id AS "commissionerId", scopes,
               subject_digest AS "subjectDigest", created_at AS "createdAt", withdrawn_at AS "withdrawnAt"
        FROM commission_approvals WHERE fleet_id = ${fleetId} AND id = ${id} FOR UPDATE`;
      return row === undefined ? undefined : commissionApprovalRecordSchema.parse(row);
    },
    withdraw: async ({ fleetId, id, at }) => {
      await db.commissionApproval.update({ where: { fleetId_id: { fleetId, id } }, data: { withdrawnAt: at } });
    },
  };
}
