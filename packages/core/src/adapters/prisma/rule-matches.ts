/**
 * Rule matches as rows (#1741): the source as text (`fleet`, `installation` or
 * the declarer's ship id) and rule places as fixed-width bits, the fleet's
 * own rules as many as it may hold, a declaration's as many as a declarer
 * may hold, so a call's bits and a row's always have one length.
 */
import { DECLARED_NETWORK_RULES_MAX, idSchema, NETWORK_RULES_MAX, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { MatchedShipsOf, RuleMatchRepository } from '../../domain/registry/ports.js';
import type { RuleMatch, RuleSource } from '../../domain/registry/rule-matches.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';

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

const matchedShipSchema = z.object({
  id: idSchema('ship'),
  owner: idSchema('ship').nullable(),
  labels: z.array(z.object({ labelId: idSchema('label'), valueId: idSchema('labelValue') })),
  declarers: z.array(idSchema('ship')),
});

/** The active ships a writer recomputes: by id, as carriers of an owner's labels, or the whole fleet. */
function matchedShipsWhere(fleetId: FleetId, of: MatchedShipsOf): Prisma.Sql {
  switch (of.kind) {
    case 'ships':
      return Prisma.sql`s.id = ANY(${[...of.shipIds]}::text[])`;
    case 'carriers':
      return Prisma.sql`EXISTS (
        SELECT 1 FROM ship_labels carried JOIN labels owned ON owned.fleet_id = carried.fleet_id AND owned.id = carried.label_id
        WHERE carried.fleet_id = s.fleet_id AND carried.ship_id = s.id
          AND ${of.owner.kind === 'ship' ? Prisma.sql`owned.owner_ship_id = ${of.owner.shipId}` : Prisma.sql`owned.owner_kind = 'installation'`})`;
    case 'fleet':
      return Prisma.sql`s.fleet_id = ${fleetId}`;
  }
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
    matchedShips: async (fleetId, of) => {
      const rows = z.array(matchedShipSchema).parse(await db.$queryRaw`
        SELECT s.id, s.owner_ship_id AS owner,
               COALESCE(jsonb_agg(jsonb_build_object('labelId', sl.label_id, 'valueId', sl.value_id) ORDER BY sl.value_id) FILTER (WHERE sl.value_id IS NOT NULL), '[]'::jsonb) AS labels,
               COALESCE(array_agg(DISTINCT l.owner_ship_id) FILTER (WHERE l.owner_ship_id IS NOT NULL), '{}') AS declarers
        FROM ships s
        LEFT JOIN ship_labels sl ON sl.fleet_id = s.fleet_id AND sl.ship_id = s.id
        LEFT JOIN labels l ON l.fleet_id = sl.fleet_id AND l.id = sl.label_id
        WHERE s.fleet_id = ${fleetId} AND s.retired_at IS NULL AND s.removed_at IS NULL AND ${matchedShipsWhere(fleetId, of)}
        GROUP BY s.id, s.owner_ship_id`);
      return rows.map(({ declarers, ...ship }) => ({ ship, declarers }));
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
