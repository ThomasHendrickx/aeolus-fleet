/**
 * A subject's rule-match filter as a fixed predicate on candidate `s`
 * (design rule-matches.md, #1741). Per candidate it reads one index range of
 * its rule matches for the verb, at most 22 rows, and at most one probe of
 * its carried values on the subject's pair labels; every other input is a
 * parameter of bounded size. No selector is interpreted here: the bits come
 * from the domain. OFFSET 0 keeps each probe correlated to its candidate.
 */
import type { RuleMatchFilter } from '../../domain/registry/rule-matches.js';
import { Prisma } from './generated/client.js';
import { bitsOf, sourceText } from './rule-matches.js';

type Filtering = Extract<RuleMatchFilter, { isEvery: false }>;

export function ruleMatchPermissionSql(filter: RuleMatchFilter): Prisma.Sql {
  if (filter.isEvery) {
    return Prisma.sql`true`;
  }
  const branches: Prisma.Sql[] = [];
  if (filter.ownedBy !== null) {
    branches.push(Prisma.sql`s.owner_ship_id = ${filter.ownedBy}`);
  }
  if (filter.kinds.length > 0) {
    branches.push(Prisma.sql`s.kind::text = ANY(${[...filter.kinds]}::text[])`);
  }
  if (filter.self !== null) {
    branches.push(Prisma.sql`s.id = ${filter.self}`);
  }
  branches.push(matchedSql(filter));
  return Prisma.sql`COALESCE((${Prisma.join(branches, ' OR ')}), false)`;
}

/** Some stored match grants every actor, or meets a rule whose `from` holds for the subject with no unshared pair key. */
function matchedSql(filter: Filtering): Prisma.Sql {
  const sources = filter.sources.map(({ source }) => sourceText(source));
  const hasPairs = filter.pairEntries.length > 0;
  const shared = hasPairs ? Prisma.sql`(
      SELECT ARRAY(
        SELECT sl.label_id FROM ship_labels sl
        WHERE sl.fleet_id = s.fleet_id AND sl.ship_id = s.id AND sl.value_id = ANY(${[...filter.pairValues]}::text[])
      ) AS labels OFFSET 0
    ) shared CROSS JOIN` : Prisma.empty;
  const met = sources.length === 0 ? Prisma.sql`false` : Prisma.sql`(m.source = ANY(${sources}::text[])
      AND bit_count(m.to_rules
        & (${filter.sources.map(({ source, fromRules }) => bitsOf(fromRules, source))}::text[]::varbit[])[array_position(${sources}::text[], m.source)]
        ${hasPairs ? unsharedSql(filter) : Prisma.empty}) > 0)`;
  return Prisma.sql`EXISTS (
    SELECT 1 FROM ${shared} ship_rule_matches m
    WHERE m.fleet_id = s.fleet_id AND m.ship_id = s.id AND m.verb = ${filter.verb}
      AND (bit_count(m.to_rules_every_actor) > 0 OR ${met})
    OFFSET 0
  )`;
}

/** Clears the rules of the match's source that need a pair key the candidate does not share; `#` of a bit string with itself is its zero. */
function unsharedSql(filter: Filtering): Prisma.Sql {
  const { pairEntries } = filter;
  return Prisma.sql`& ~COALESCE((
          SELECT bit_or(entry.rules)
          FROM unnest(${pairEntries.map(({ source }) => sourceText(source))}::text[],
                      ${pairEntries.map(({ key }) => (key.kind === 'owner' ? 'owner' : key.labelId))}::text[],
                      ${pairEntries.map(({ source, rules }) => bitsOf(rules, source))}::text[]::varbit[]) AS entry(source, key, rules)
          WHERE entry.source = m.source
            AND NOT (CASE WHEN entry.key = 'owner' THEN COALESCE(s.owner_ship_id = ${filter.pairOwner}, false)
                          ELSE entry.key = ANY(shared.labels) END)
        ), m.to_rules # m.to_rules)`;
}
