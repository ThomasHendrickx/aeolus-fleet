import { z } from 'zod';

import { shipStatusSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';
import { crewRequestKeySchema } from './crew-request.js';
import { pageInputOf } from './page.js';

/**
 * Labels (decision 0031): an owned vocabulary for selecting ships. A label is
 * a key with a defined set of values, the label and each value with its own
 * id; a ship holds a set of value ids. Ids are for machines, key and value
 * texts for people. The limits below are the decision's; every refusal names
 * it.
 */

export { LABEL_HANDLE_MAX_LENGTH, LABEL_HANDLE_PATTERN } from '../rules/label-handle.js';

/** The most values one label may define. */
export const LABEL_VALUES_MAX = 50;

/** The most label values one ship may carry. */
export const SHIP_LABELS_MAX = 20;

/**
 * A key or a value as a call carries it: plain text. The server checks the
 * limits above, so every refusal names their decision.
 */
const labelTextSchema = z.string();

/** One value of a label: its id and its text. */
export const labelValueSchema = z.object({ id: idSchema('labelValue'), value: z.string() });

/** One value a ship carries, with its label: ids and texts. */
export const carriedLabelSchema = z.object({ labelId: idSchema('label'), key: z.string(), valueId: idSchema('labelValue'), value: z.string() });

/**
 * What sort of agent crews a ship (the overview's Kind filter, idea #401):
 * the console (argo and the viewer), a ship a console plugin runs as, a
 * machine's trierarch, or what its crewing session's harness says.
 */
export const AGENT_KINDS = ['console', 'claudeCode', 'codex', 'trierarch', 'plugin', 'other'] as const;
export const agentKindSchema = z.enum(AGENT_KINDS);
export type AgentKind = z.infer<typeof agentKindSchema>;

/**
 * Which ships `fleet.list` and the counts read select, every filter combined
 * with AND: the search text its name or type holds, in any case; any of the
 * statuses, types, crew request keys, ship ids and agent kinds picked; and
 * every label value id given (exact matches, decision 0031). A filter left
 * out selects every ship. `pluginShipIds` names the ships the console's
 * plugins run as, which the kind filter counts as plugin.
 */
export const fleetListFilterSchema = z.object({
  query: z.string().optional(),
  status: z.array(shipStatusSchema).optional(),
  type: z.array(z.string()).optional(),
  crewRequest: z.array(crewRequestKeySchema).optional(),
  assignedTo: z.array(idSchema('ship')).optional(),
  needsCrew: z.enum(['withTrierarchs', 'withoutTrierarchs']).optional(),
  valueIds: z.array(idSchema('labelValue')).optional(),
  shipIds: z.array(idSchema('ship')).optional(),
  kind: z.array(agentKindSchema).optional(),
  pluginShipIds: z.array(idSchema('ship')).optional(),
});

/** Input of `fleet.shipCounts`: count only the ships the fleet snapshot's filter selects; none counts every ship. */
export const shipCountsInputSchema = z.object({ filter: fleetListFilterSchema.optional() }).optional();

/** Input of `fleet.shipTypes`: the types of the ships of any of these statuses; none asks the active ships. */
export const shipTypesInputSchema = z.object({ status: z.array(shipStatusSchema).optional() }).optional();

/** Output of `fleet.shipTypes`: each type once, sorted. */
export const shipTypesOutputSchema = z.array(z.string());

/** The columns `fleet.list` sorts by, as the overview shows them. */
export const SHIP_SORT_COLUMNS = ['ship', 'status', 'report', 'runsOn', 'seen', 'requested'] as const;
export type ShipSortColumn = (typeof SHIP_SORT_COLUMNS)[number];

/**
 * The order of `fleet.list`: a column, A to Z or Z to A (Seen: the most
 * recent first when ascending), ships with nothing in the column last either
 * way, ties by name. Without one: argo first, then by name.
 */
export const fleetListSortSchema = z.object({ column: z.enum(SHIP_SORT_COLUMNS), direction: z.enum(['ascending', 'descending']) });

/**
 * Where a page of `fleet.list` starts: after the ship at this position in
 * the order, by whether its sort value is empty, the value, its name and its
 * id. The fleet answers it as an opaque cursor; only the fleet reads it.
 */
export const shipPositionSchema = z.object({ isEmpty: z.boolean(), value: z.string(), name: z.string(), id: idSchema('ship') });
export type ShipPosition = z.infer<typeof shipPositionSchema>;

/** The most characters a cursor may have: a position with a long report note fits. */
const SHIP_CURSOR_MAX_LENGTH = 4096;

/** A position as the opaque cursor fleet.list answers: its JSON in base64url. */
export function shipCursorOf(position: ShipPosition): string {
  const bytes = new TextEncoder().encode(JSON.stringify(position));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function jsonOfCursor(cursor: string): unknown {
  try {
    const binary = atob(cursor.replaceAll('-', '+').replaceAll('_', '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))));
  } catch {
    return undefined;
  }
}

/** A cursor fleet.list answered, read back as its position. */
export const shipCursorSchema = z
  .string()
  .max(SHIP_CURSOR_MAX_LENGTH)
  .transform(jsonOfCursor)
  .pipe(shipPositionSchema);

/** Input of `fleet.list`: the filter, the sort, and the page: the cursor it starts after and its size (decision 4 of the performance design). */
export const fleetListInputSchema = pageInputOf(shipCursorSchema)
  .extend({ ...fleetListFilterSchema.shape, sort: fleetListSortSchema.optional() })
  .optional();

/** `fleet.list`'s filter and sort as a caller writes them, ids as text. */
export type FleetListFilter = z.input<typeof fleetListFilterSchema>;
export type FleetListSort = z.input<typeof fleetListSortSchema>;

/** Input of `fleet.defineLabel` (labels:define): the key, unique in the fleet, and its values. */
export const defineLabelInputSchema = z.object({ key: labelTextSchema, values: z.array(labelTextSchema) });

/** Output of `fleet.defineLabel`: the label's id and each value with its id. */
export const defineLabelOutputSchema = z.object({ labelId: idSchema('label'), values: z.array(labelValueSchema) });

/** Input of `fleet.changeLabelValues` (labels:define, owner only): the label by its id and every value it has from now on. */
export const changeLabelValuesInputSchema = z.object({ labelId: idSchema('label'), values: z.array(labelTextSchema) });

/** Output of `fleet.changeLabelValues`: each value with its id, a kept value with the id it had. */
export const changeLabelValuesOutputSchema = z.object({ values: z.array(labelValueSchema) });

/** Input of `fleet.deleteLabel` (labels:define, owner only): the label by its id. */
export const deleteLabelInputSchema = z.object({ labelId: idSchema('label') });

/** Input of `fleet.findLabelValue` (fleet:read): a key and a value as people write them. */
export const findLabelValueInputSchema = z.object({ key: labelTextSchema, value: labelTextSchema });

/** Output of `fleet.findLabelValue`: the label's id and the value's id. */
export const findLabelValueOutputSchema = z.object({ labelId: idSchema('label'), valueId: idSchema('labelValue') });

/** Input of `fleet.assignLabel` (labels:assign, owner only): the ship and the value it carries from now on, by their ids. */
export const assignLabelInputSchema = z.object({ shipId: idSchema('ship'), valueId: idSchema('labelValue') });

/** Input of `fleet.unassignLabel` (labels:assign, owner only): the ship and the value it no longer carries, by their ids. */
export const unassignLabelInputSchema = assignLabelInputSchema;

/** Output of the label assignments: nothing, the OK is the answer. */
export const labelWriteOutputSchema = z.object({});

/** Who owns a label (decision 0031): a ship by id and name, or the installation. */
export const labelOwnerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ship'), id: idSchema('ship'), name: z.string() }),
  z.object({ kind: z.literal('installation') }),
]);

/** One label of the fleet: its id, its key, its values with their ids and its owner. */
export const listedLabelSchema = z.object({
  id: idSchema('label'),
  key: z.string(),
  values: z.array(labelValueSchema),
  owner: labelOwnerSchema,
});

export type ListedLabel = z.infer<typeof listedLabelSchema>;

/** Output of `fleet.labels` (fleet:read): the fleet's labels by key, each value with how many active ships in the caller's read reach carry it. */
export const labelsOutputSchema = z.array(
  listedLabelSchema.extend({ shipCount: z.int().min(0), values: z.array(labelValueSchema.extend({ shipCount: z.int().min(0) })) }),
);
