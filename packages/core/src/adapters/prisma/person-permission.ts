/** Parameterized predicates against candidate s, with label-indexed rule data.
 * OFFSET 0 keeps simple EXISTS correlated, preventing global hashed label scans.
 */
import type { PersonPermissionPlan, PersonPermissionTerm } from '../../domain/registry/person-permission.js';
import { Prisma } from './generated/client.js';

export function personPermissionSql(plan: PersonPermissionPlan): Prisma.Sql {
  if (plan.isEvery) {
    return Prisma.sql`true`;
  }
  const branches = plan.anyOf.map((terms) => Prisma.sql`(${Prisma.join(terms.map(termSql), ' AND ')})`);
  if (plan.valueIds.length > 0) {
    branches.push(Prisma.sql`EXISTS (SELECT 1 FROM ship_labels sl WHERE sl.fleet_id = s.fleet_id AND sl.ship_id = s.id AND sl.value_id = ANY(${[...plan.valueIds]}::text[]) OFFSET 0)`);
  }
  if (plan.labelIds.length > 0) {
    branches.push(Prisma.sql`EXISTS (SELECT 1 FROM ship_labels sl WHERE sl.fleet_id = s.fleet_id AND sl.ship_id = s.id AND sl.label_id = ANY(${[...plan.labelIds]}::text[]) OFFSET 0)`);
  }
  if (plan.valuePairs.size > 0) {
    const pairs = JSON.stringify(Object.fromEntries(plan.valuePairs));
    branches.push(Prisma.sql`EXISTS (
      SELECT 1 FROM ship_labels first_value
      WHERE first_value.fleet_id = s.fleet_id AND first_value.ship_id = s.id
        AND EXISTS (
          SELECT 1 FROM ship_labels second_value
          WHERE second_value.fleet_id = s.fleet_id AND second_value.ship_id = s.id
            AND COALESCE((${pairs}::jsonb -> first_value.value_id) ? second_value.value_id, false)
        )
    )`);
  }
  if (plan.byValue.size > 0 || plan.byLabel.size > 0) {
    branches.push(indexedClauses(plan));
  }
  return branches.length === 0 ? Prisma.sql`false` : Prisma.sql`COALESCE((${Prisma.join(branches, ' OR ')}), false)`;
}

/** Each candidate probes only predicate lists indexed by values/labels it carries. */
function indexedClauses(plan: PersonPermissionPlan): Prisma.Sql {
  const byValue = JSON.stringify(Object.fromEntries(plan.byValue));
  const byLabel = JSON.stringify(Object.fromEntries(plan.byLabel));
  return Prisma.sql`EXISTS (
    SELECT 1 FROM ship_labels anchor
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(${byValue}::jsonb -> anchor.value_id, '[]'::jsonb) ||
      COALESCE(${byLabel}::jsonb -> anchor.label_id, '[]'::jsonb)
    ) clause(terms)
    WHERE anchor.fleet_id = s.fleet_id AND anchor.ship_id = s.id
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_to_recordset(clause.terms)
          AS term(kind text, "valueId" text, "labelId" text, "valueIds" jsonb, "shipId" text, "shipKind" text)
        WHERE NOT COALESCE(CASE term.kind
          WHEN 'value' THEN EXISTS (SELECT 1 FROM ship_labels sl WHERE sl.fleet_id = s.fleet_id AND sl.ship_id = s.id AND sl.value_id = term."valueId")
          WHEN 'label' THEN EXISTS (
            SELECT 1 FROM ship_labels sl WHERE sl.fleet_id = s.fleet_id AND sl.ship_id = s.id AND sl.label_id = term."labelId"
              AND (term."valueIds" IS NULL OR sl.value_id IN (SELECT jsonb_array_elements_text(term."valueIds")))
          )
          WHEN 'owner' THEN CASE WHEN term."shipId" IS NULL THEN s.owner_ship_id IS NOT NULL ELSE s.owner_ship_id = term."shipId" END
          WHEN 'ship' THEN s.id = term."shipId"
          WHEN 'kind' THEN s.kind::text = term."shipKind"
          ELSE false
        END, false)
      )
  )`;
}

function termSql(term: PersonPermissionTerm): Prisma.Sql {
  switch (term.kind) {
    case 'value':
      return Prisma.sql`EXISTS (SELECT 1 FROM ship_labels sl WHERE sl.fleet_id = s.fleet_id AND sl.ship_id = s.id AND sl.value_id = ${term.valueId} OFFSET 0)`;
    case 'label':
      return Prisma.sql`EXISTS (SELECT 1 FROM ship_labels sl WHERE sl.fleet_id = s.fleet_id AND sl.ship_id = s.id AND sl.label_id = ${term.labelId} ${term.valueIds === null ? Prisma.empty : Prisma.sql`AND sl.value_id = ANY(${[...term.valueIds]}::text[])`} OFFSET 0)`;
    case 'owner':
      return term.shipId === null ? Prisma.sql`s.owner_ship_id IS NOT NULL` : Prisma.sql`COALESCE(s.owner_ship_id = ${term.shipId}, false)`;
    case 'ship':
      return Prisma.sql`s.id = ${term.shipId}`;
    case 'kind':
      return Prisma.sql`s.kind = ${term.shipKind}`;
  }
}
