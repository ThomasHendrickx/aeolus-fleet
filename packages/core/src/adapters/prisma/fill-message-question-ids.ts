/** Fills the question uuids of a bounded set of plain payloads, also before sealing removes them. */
import type { FleetId, MessageId } from '@aeolus-fleet/common';

import { answeredQuestionIdIn, askedQuestionIdIn, isAnswerContentType, isAskingContentType } from './content-type-sql.js';
import { Prisma } from './generated/client.js';

export function fillMessageQuestionIdsStatement({ fleetId, ids }: { fleetId: FleetId; ids: readonly MessageId[] }): Prisma.Sql {
  return Prisma.sql`
    UPDATE messages SET
      asked_question_id = COALESCE(asked_question_id, CASE WHEN ${isAskingContentType('content_type')} THEN ${askedQuestionIdIn('payload')} END),
      answered_question_id = COALESCE(answered_question_id, CASE WHEN ${isAnswerContentType('content_type')} THEN ${answeredQuestionIdIn('payload')} END)
    WHERE fleet_id = ${fleetId} AND id = ANY(${ids}::text[]) AND payload IS NOT NULL
      AND ((asked_question_id IS NULL AND ${isAskingContentType('content_type')})
        OR (answered_question_id IS NULL AND ${isAnswerContentType('content_type')}))`;
}
