/**
 * Rule matches as rows (#1741): the source as text (`fleet`, `installation` or
 * the declarer's ship id) and rule places as fixed-width bits, the fleet's
 * own rules as many as it may hold, a declaration's as many as a declarer
 * may hold, so a call's bits and a row's always have one length.
 */
import { DECLARED_NETWORK_RULES_MAX, idSchema, NETWORK_RULES_MAX, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { RuleMatchRepository } from '../../domain/registry/ports.js';
import type { RuleMatch, RuleSource } from '../../domain/registry/rule-matches.js';
import type { Db } from './client.js';

export function sourceText(source: RuleSource): string {
  return source.kind === 'ship' ? source.shipId : source.kind;
}

function sourceOf(text: string): RuleSource {
  if (text === 'fleet' || text === 'installation') {
    return { kind: text };
  }
  return { kind: 'ship', shipId: idSchema('ship').parse(text) };
}

/** The bits of a source: as many as the rules it may hold. */
export function sourceWidth(source: RuleSource): number {
  return source.kind === 'fleet' ? NETWORK_RULES_MAX : DECLARED_NETWORK_RULES_MAX;
}

/** Rule places as a bit string of the source's width, the first place leftmost, as Postgres reads `B'...'`. */
export function bitsOf(places: readonly number[], source: RuleSource): string {
  const bits = Array.from({ length: sourceWidth(source) }, () => '0');
  for (const place of places) {
    bits[place] = '1';
  }
  return bits.join('');
}

function placesOf(bits: string): number[] {
  return Array.from({ length: bits.length }, (_, place) => place).filter((place) => bits.charAt(place) === '1');
}

const rowSchema = z.object({
  shipId: idSchema('ship'),
  verb: z.enum(['send', 'read']),
  source: z.string(),
  toRules: z.string(),
  toRulesEveryActor: z.string(),
});

export function createPrismaRuleMatchRepository(db: Db): RuleMatchRepository {
  const insert = async (fleetId: FleetId, matches: readonly RuleMatch[]): Promise<void> => {
    if (matches.length === 0) {
      return;
    }
    await db.$executeRaw`
      INSERT INTO ship_rule_matches (fleet_id, ship_id, verb, source, to_rules, to_rules_every_actor)
      SELECT ${fleetId}, row.ship_id, row.verb, row.source, row.to_rules::varbit, row.to_rules_every_actor::varbit
      FROM unnest(${matches.map(({ shipId }) => shipId)}::text[], ${matches.map(({ verb }) => verb)}::text[],
                  ${matches.map(({ source }) => sourceText(source))}::text[], ${matches.map(({ toRules, source }) => bitsOf(toRules, source))}::text[],
                  ${matches.map(({ toRulesEveryActor, source }) => bitsOf(toRulesEveryActor, source))}::text[])
        AS row(ship_id, verb, source, to_rules, to_rules_every_actor)`;
  };
  return {
    replaceOfShips: async (fleetId, { shipIds, matches }) => {
      await db.$executeRaw`DELETE FROM ship_rule_matches WHERE fleet_id = ${fleetId} AND ship_id = ANY(${[...shipIds]}::text[])`;
      await insert(fleetId, matches);
    },
    replaceOfSource: async (fleetId, { source, matches }) => {
      await db.$executeRaw`DELETE FROM ship_rule_matches WHERE fleet_id = ${fleetId} AND source = ${sourceText(source)}`;
      await insert(fleetId, matches);
    },
    list: async (fleetId) => {
      const rows = z.array(rowSchema).parse(await db.$queryRaw`
        SELECT ship_id AS "shipId", verb, source, to_rules::text AS "toRules", to_rules_every_actor::text AS "toRulesEveryActor"
        FROM ship_rule_matches WHERE fleet_id = ${fleetId} ORDER BY ship_id, verb, source`);
      return rows.map((row) => ({
        shipId: row.shipId,
        verb: row.verb,
        source: sourceOf(row.source),
        toRules: placesOf(row.toRules),
        toRulesEveryActor: placesOf(row.toRulesEveryActor),
      }));
    },
  };
}
