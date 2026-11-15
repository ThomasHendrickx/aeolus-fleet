/**
 * The SQL that tells content types apart and reads a question's uuid from a
 * plain payload, built from the content types common owns. The types go in
 * as literals, not parameters, so a partial index's predicate built here
 * matches the query built here under a generic plan too. Columns are internal
 * SQL names, never request input.
 */
import { ANSWER_CONTENT_TYPE, CONVENTION_CONTENT_TYPES, QUESTION_CONTENT_TYPE, REPLACEMENT_CONTENT_TYPE } from '@aeolus-fleet/common';

import { Prisma } from './generated/client.js';

/** The content types whose payload names its own question uuid: a question and a replacement's new question. */
const ASKING_CONTENT_TYPES: readonly string[] = [QUESTION_CONTENT_TYPE, REPLACEMENT_CONTENT_TYPE];

function literalOf(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** A content type's essence in SQL, as essenceOf in common takes it. */
function essenceOf(column: string): string {
  return `lower(btrim(split_part(${column}, ';', 1)))`;
}

/** Whether the content type is a question's or a replacement's. */
export function askingContentTypeText(column: string): string {
  return `${essenceOf(column)} IN (${ASKING_CONTENT_TYPES.map(literalOf).join(', ')})`;
}

export function isAskingContentType(column: string): Prisma.Sql {
  return Prisma.raw(askingContentTypeText(column));
}

export function isAnswerContentType(column: string): Prisma.Sql {
  return Prisma.raw(`${essenceOf(column)} = ${literalOf(ANSWER_CONTENT_TYPE)}`);
}

/** Whether the content type is none of the conventions'. */
export function isNoConventionContentType(column: string): Prisma.Sql {
  return Prisma.raw(`${essenceOf(column)} NOT IN (${CONVENTION_CONTENT_TYPES.map(literalOf).join(', ')})`);
}

/** The uuid a question's or a replacement's plain payload names as its own. */
export function askedQuestionIdIn(payload: string): Prisma.Sql {
  return Prisma.raw(`substring(${payload} from '"id"\\s*:\\s*"([^"]*)"')`);
}

/** The uuid an answer's plain payload names. */
export function answeredQuestionIdIn(payload: string): Prisma.Sql {
  return Prisma.raw(`substring(${payload} from '"questionId"\\s*:\\s*"([^"]*)"')`);
}
