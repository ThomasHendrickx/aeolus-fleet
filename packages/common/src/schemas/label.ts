import { z } from 'zod';

import { idSchema } from '../ids/index.js';

/**
 * Labels (decision 0031): an owned vocabulary for selecting ships. A label is
 * a key with a defined set of values, the label and each value with its own
 * id; a ship holds a set of value ids. Ids are for machines, key and value
 * texts for people. The limits below are the decision's; every refusal names
 * it.
 */

/** The most characters a label's key or one of its values may have. */
export const LABEL_HANDLE_MAX_LENGTH = 63;

/** A label's key or value: lowercase letters, digits and hyphens, at least one. */
export const LABEL_HANDLE_PATTERN = /^[a-z0-9-]+$/;

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

/** Input of `fleet.list`: none, or the value ids a listed ship must carry: exact matches, combined with AND. */
export const fleetListInputSchema = z.object({ valueIds: z.array(idSchema('labelValue')).optional() }).optional();

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

/** One label of the fleet: its id, its key, its values with their ids and its owner by id and name. */
export const listedLabelSchema = z.object({
  id: idSchema('label'),
  key: z.string(),
  values: z.array(labelValueSchema),
  owner: z.object({ id: idSchema('ship'), name: z.string() }),
});

export type ListedLabel = z.infer<typeof listedLabelSchema>;

/** Output of `fleet.labels` (fleet:read): the fleet's labels by key. */
export const labelsOutputSchema = z.array(listedLabelSchema);
