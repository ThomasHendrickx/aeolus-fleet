import { z } from 'zod';

import { idSchema } from '../ids/index.js';

/**
 * Labels (decision 0031): an owned vocabulary for selecting ships. A label is
 * a key with a defined set of values; a ship carries at most one value per
 * key. The limits below are the decision's; every refusal names it.
 */

/** The most characters a label's key or one of its values may have. */
export const LABEL_HANDLE_MAX_LENGTH = 63;

/** A label's key or value: lowercase letters, digits and hyphens, at least one. */
export const LABEL_HANDLE_PATTERN = /^[a-z0-9-]+$/;

/** The most values one label may define. */
export const LABEL_VALUES_MAX = 50;

/** The most labels one ship may carry. */
export const SHIP_LABELS_MAX = 20;

/**
 * A key or a value as a call carries it: plain text. The server checks the
 * limits above, so every refusal names their decision.
 */
const labelTextSchema = z.string();

/** Labels to select ships by, value by key: exact matches, combined with AND. */
export const labelSelectorSchema = z.record(z.string(), z.string());

/** Input of `fleet.list`: none, or the labels a listed ship must carry, each with its value. */
export const fleetListInputSchema = z.object({ labels: labelSelectorSchema.optional() }).optional();

/** Input of `fleet.defineLabel` (labels:define): the key, unique in the fleet, and its values. */
export const defineLabelInputSchema = z.object({ key: labelTextSchema, values: z.array(labelTextSchema) });

/** Input of `fleet.changeLabelValues` (labels:define, owner only): the key and every value it has from now on. */
export const changeLabelValuesInputSchema = defineLabelInputSchema;

/** Input of `fleet.assignLabel` (labels:assign, owner only): the ship and the value it carries from now on. */
export const assignLabelInputSchema = z.object({ shipId: idSchema('ship'), key: labelTextSchema, value: labelTextSchema });

/** Input of `fleet.unassignLabel` (labels:assign, owner only): the ship and the key it no longer carries. */
export const unassignLabelInputSchema = z.object({ shipId: idSchema('ship'), key: labelTextSchema });

/** Output of the label writes: nothing, the OK is the answer. */
export const labelWriteOutputSchema = z.object({});

/** One label of the fleet: its key, its values and its owner by id and name. */
export const listedLabelSchema = z.object({
  key: z.string(),
  values: z.array(z.string()),
  owner: z.object({ id: idSchema('ship'), name: z.string() }),
});

export type ListedLabel = z.infer<typeof listedLabelSchema>;

/** Output of `fleet.labels` (fleet:read): the fleet's labels by key. */
export const labelsOutputSchema = z.array(listedLabelSchema);
