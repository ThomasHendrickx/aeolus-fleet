/** Bounded pages and their messages share one statement snapshot, even while retention deletes them. */
import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { Db } from './client.js';
import type { Prisma } from './generated/client.js';
import { toMessage } from './rows.js';

const joinedRow = z.looseObject({ storedMessageId: idSchema('message') });

/** Join after the indexed page limit, so only the bounded page loads payloads. */
export async function pageWithMessages(db: Db, page: { statement: Prisma.Sql; messageId: Prisma.Sql; order: Prisma.Sql }) {
  const rows = await db.$queryRaw<unknown[]>`
    SELECT page.*, m.id AS "storedMessageId",
      m.fleet_id AS "fleetId",
      m.sender_ship_id AS "senderShipId",
      m.sender_lease_id AS "senderLeaseId",
      m.selector_kind AS "selectorKind",
      m.selector_ship_id AS "selectorShipId",
      m.selector_type AS "selectorType",
      m.selector_value_ids AS "selectorValueIds",
      m.payload AS "payload",
      m.sealed_data_key_id AS "sealedDataKeyId",
      m.sealed_nonce AS "sealedNonce",
      m.sealed_ciphertext AS "sealedCiphertext",
      m.sealed_payload_bytes AS "sealedPayloadBytes",
      m.question_id AS "questionId",
      m.asked_question_id AS "askedQuestionId",
      m.answered_question_id AS "answeredQuestionId",
      m.content_type AS "contentType",
      m.model AS "model",
      m.idempotency_key AS "idempotencyKey",
      m.request_hash AS "requestHash",
      m.in_reply_to_message_id AS "inReplyToMessageId",
      m.resend_of_message_id AS "resendOfMessageId",
      m.meeting_id AS "meetingId",
      m.schedule_id AS "scheduleId",
      m.send_time AS "sendTime",
      m.created_at AS "createdAt"
    FROM (${page.statement}) AS page
    JOIN messages m ON m.fleet_id = page.fleet_id AND m.id = ${page.messageId}
    ORDER BY ${page.order}`;
  return rows.map((row) => {
    const columns = joinedRow.parse(row);
    return { row, message: toMessage({ ...columns, id: columns.storedMessageId }) };
  });
}
