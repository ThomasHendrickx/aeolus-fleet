/** Only the verified actor and its stored association are loaded, never recipients. */
import { idSchema, networkRulesSchema, scopeNameSchema, shipKindSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import { isCrew, type Caller } from '../../domain/shared/caller.js';
import type { ReachingActor, ReachingShip } from '../../domain/registry/network-settings.js';
import { ruleSourcesOf, type SubjectRuleSources } from '../../domain/registry/rule-matches.js';
import type { DeclaredNetworkRules } from '../../domain/registry/declared-network-rules.js';
import { associatedShipIdOf, type PersonShipReadFacts } from '../../domain/registry/person-ship-reads.js';
import { Prisma } from './generated/client.js';
import type { PersonShipQuery } from './person-ship-query.js';

const labelSchema = z.object({ labelId: idSchema('label'), valueId: idSchema('labelValue') });
const settingsSchema = z.object({ rules: networkRulesSchema, isViewerReadOn: z.boolean() });
const declarationSchema = z.object({ shipId: idSchema('ship').nullable(), rules: networkRulesSchema.unwrap() });
const subjectSchema = z.object({
  id: idSchema('ship'), kind: shipKindSchema, owner: idSchema('ship').nullable(),
  scopes: z.array(scopeNameSchema), labels: z.array(labelSchema),
  isOwnedByPerson: z.boolean(), isActive: z.boolean(), isCrewActive: z.boolean(),
  declarers: z.array(idSchema('ship')),
});
const universalSchema = z.object({ isRead: z.boolean(), isSend: z.boolean() });

type Subject = z.infer<typeof subjectSchema>;

async function subjectOf(query: PersonShipQuery, caller: Caller): Promise<Subject | undefined> {
  const id = associatedShipIdOf(caller);
  if (id === null) {
    return undefined;
  }
  const crew = isCrew(caller) ? Prisma.sql`EXISTS (
    SELECT 1 FROM leases l WHERE l.fleet_id = s.fleet_id AND l.ship_id = s.id AND l.id = ${caller.leaseId} AND l.ended_at IS NULL
  )` : Prisma.sql`false`;
  const [subject] = await query(Prisma.sql`
    SELECT s.id, s.kind::text AS kind, s.owner_ship_id AS owner, s.scopes,
           COALESCE(owner.kind = 'person', false) AS "isOwnedByPerson",
           s.retired_at IS NULL AND s.removed_at IS NULL AS "isActive",
           ${crew} AS "isCrewActive",
           COALESCE((SELECT jsonb_agg(jsonb_build_object('labelId', sl.label_id, 'valueId', sl.value_id))
             FROM ship_labels sl WHERE sl.fleet_id = s.fleet_id AND sl.ship_id = s.id), '[]'::jsonb) AS labels,
           ARRAY(SELECT DISTINCT label.owner_ship_id FROM ship_labels sl
             JOIN labels label ON label.fleet_id = sl.fleet_id AND label.id = sl.label_id
             WHERE sl.fleet_id = s.fleet_id AND sl.ship_id = s.id AND label.owner_ship_id IS NOT NULL) AS declarers
    FROM ships s LEFT JOIN ships owner ON owner.fleet_id = s.fleet_id AND owner.id = s.owner_ship_id
    WHERE s.fleet_id = ${caller.fleetId} AND s.id = ${id}`, subjectSchema);
  return subject;
}

function reaching(subject: Subject): ReachingShip {
  return { id: subject.id, kind: subject.kind, owner: subject.owner, labels: subject.labels, isOwnedByPerson: subject.isOwnedByPerson };
}

async function readerOf(query: PersonShipQuery, input: { caller: Caller; subject: Subject | undefined }): Promise<ReachingActor | null> {
  const { caller, subject } = input;
  if (caller.kind === 'installation') {
    return { kind: 'installation' };
  }
  if (caller.kind !== 'account') {
    return subject?.isActive === true ? reaching(subject) : null;
  }
  const labels = caller.groupValues.length === 0 ? [] : await query(Prisma.sql`
    SELECT value.label_id AS "labelId", value.id AS "valueId"
    FROM labels label JOIN label_values value ON value.fleet_id = label.fleet_id AND value.label_id = label.id
    WHERE label.fleet_id = ${caller.fleetId} AND label.key = 'group' AND value.value = ANY(${[...caller.groupValues]}::text[])
    ORDER BY value.label_id, value.id`, labelSchema);
  // actorAsItIs retains a stored retired/remnant id for account owner terms.
  // Send eligibility below is separately restricted to an active association.
  return { kind: 'account', personShipId: subject?.id ?? null, labels };
}

/**
 * The rule sources the subjects can meet: the fleet's own rules, the
 * installation's declaration and the declarations of the ship declarers whose
 * labels the associated ship carries (an account carries only group values,
 * which the installation owns), plus whether some ship declaration's empty pair
 * grants a verb to every actor. Never every declaration in the fleet.
 */
async function subjectRuleSources(query: PersonShipQuery, read: { caller: Caller; settings: z.infer<typeof settingsSchema>; subject: Subject | undefined; verbs: readonly ('read' | 'send')[] }): Promise<SubjectRuleSources> {
  const { caller, settings, subject } = read;
  const isOpen = settings.rules === null;
  if (isOpen) {
    return { isOpen, isViewerReadOn: settings.isViewerReadOn, sources: [], everyCandidateVerbs: [] };
  }
  const declarers = subject?.declarers ?? [];
  const rows = await query(Prisma.sql`
    SELECT ship_id AS "shipId", rules FROM declared_network_rules WHERE fleet_id = ${caller.fleetId} AND ship_id = ANY(${[...declarers]}::text[])
    UNION ALL
    SELECT NULL::text AS "shipId", rules FROM installation_declared_network_rules WHERE fleet_id = ${caller.fleetId}`, declarationSchema);
  const declared: DeclaredNetworkRules[] = rows.map((row) => ({ fleetId: caller.fleetId, declarer: row.shipId === null ? { kind: 'installation' } : { kind: 'ship', shipId: row.shipId }, rules: row.rules }));
  // Each probe repeats its partial index's predicate exactly, so the index proves absence too.
  const [universal] = await query(Prisma.sql`
    SELECT ${read.verbs.includes('read')} AND EXISTS (SELECT 1 FROM declared_network_rules WHERE fleet_id = ${caller.fleetId}
             AND jsonb_path_exists(rules, '$[*] ? (@.verb == "read" && @.from.size() == 0 && @.to.size() == 0)')) AS "isRead",
           ${read.verbs.includes('send')} AND EXISTS (SELECT 1 FROM declared_network_rules WHERE fleet_id = ${caller.fleetId}
             AND jsonb_path_exists(rules, '$[*] ? (@.verb == "send" && @.from.size() == 0 && @.to.size() == 0)')) AS "isSend"`, universalSchema);
  const everyCandidateVerbs: ('read' | 'send')[] = [...(universal?.isRead === true ? ['read' as const] : []), ...(universal?.isSend === true ? ['send' as const] : [])];
  const inForce = { rules: settings.rules ?? [], declared };
  return { isOpen, isViewerReadOn: settings.isViewerReadOn, sources: ruleSourcesOf(inForce, new Set(declarers)), everyCandidateVerbs };
}

export async function readPersonShipFacts(query: PersonShipQuery, input: { caller: Caller; verbs: readonly ('read' | 'send')[] }): Promise<PersonShipReadFacts> {
  const { caller, verbs } = input;
  const [kept] = await query(Prisma.sql`SELECT rules, built_in_viewer_read AS "isViewerReadOn" FROM network_settings WHERE fleet_id = ${caller.fleetId}`, settingsSchema);
  const settings = kept ?? { rules: null, isViewerReadOn: true };
  const subject = await subjectOf(query, caller);
  const reader = await readerOf(query, { caller, subject });
  return {
    reader,
    scopes: caller.kind === 'account' || caller.kind === 'installation' ? caller.scopes : subject?.scopes ?? [],
    sender: subject?.isActive === true ? { ship: reaching(subject), scopes: subject.scopes } : null,
    isCrewActive: subject?.isActive === true && subject.isCrewActive,
    rules: await subjectRuleSources(query, { caller, settings, subject, verbs }),
  };
}
