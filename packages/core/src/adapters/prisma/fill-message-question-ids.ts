/** Fills uuids from a bounded set of plain payloads, also before sealing removes them. */
import type { FleetId, MessageId } from '@aeolus-fleet/common';

import { Prisma } from './generated/client.js';

export function fillMessageQuestionIdsStatement({ fleetId, ids }: { fleetId: FleetId; ids: readonly MessageId[] }): Prisma.Sql {
  return Prisma.sql`
    UPDATE messages SET
      asked_question_id = COALESCE(asked_question_id, CASE WHEN lower(btrim(split_part(content_type, ';', 1))) IN ('application/vnd.aeolus.question+json', 'application/vnd.aeolus.question-replacement+json') THEN substring(payload from '"id"\\s*:\\s*"([^"]*)"') END),
      answered_question_id = COALESCE(answered_question_id, CASE WHEN lower(btrim(split_part(content_type, ';', 1))) = 'application/vnd.aeolus.answer+json' THEN substring(payload from '"questionId"\\s*:\\s*"([^"]*)"') END)
    WHERE fleet_id = ${fleetId} AND id = ANY(${ids}::text[]) AND payload IS NOT NULL
      AND ((asked_question_id IS NULL AND lower(btrim(split_part(content_type, ';', 1))) IN ('application/vnd.aeolus.question+json', 'application/vnd.aeolus.question-replacement+json'))
        OR (answered_question_id IS NULL AND lower(btrim(split_part(content_type, ';', 1))) = 'application/vnd.aeolus.answer+json'))`;
}
