import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { PAYLOAD_MAX_BYTES, payloadBytes } from '../rules/payload.js';
import { NETWORK_VERBS } from './network.js';

/**
 * The network rules file (docs/design/network-io): a fleet's applied rules
 * and the labels they use, by name, so they leave one fleet and come back
 * into it or another. Export writes it; import checks it, shows its
 * differences with the fleet and fills the draft from it (decision 0035).
 * A file of another version is refused, never migrated (decision 0013).
 */

export const NETWORK_RULES_FILE_FORMAT = 'aeolus.network-rules' as const;

export const NETWORK_RULES_FILE_VERSION = 1 as const;

/**
 * One term by name: a label by its key with a value text, `*` for any value
 * or `#` for the same value as the other side's; or the owner by its ship's
 * name, `*` or `#` (decisions 0034, 0045).
 */
export const fileTermSchema = z.union([z.object({ label: z.string(), value: z.string() }), z.object({ owner: z.string() })]);

export type FileTerm = z.infer<typeof fileTermSchema>;

export const fileRuleSchema = z.object({ verb: z.enum(NETWORK_VERBS), from: z.array(fileTermSchema), to: z.array(fileTermSchema) });

export type FileRule = z.infer<typeof fileRuleSchema>;

/** A label the rules use: its key, its values and its definer, a ship by name or `installation`. */
export const fileLabelSchema = z.object({ key: z.string(), values: z.array(z.string()), definer: z.string() });

export type FileLabel = z.infer<typeof fileLabelSchema>;

/**
 * The file. `fleet` and `rulesVersion`, the settings version of the applied
 * rules, tell two files apart; rules of null are none applied, all-to-all.
 */
export const networkRulesFileSchema = z.object({
  format: z.literal(NETWORK_RULES_FILE_FORMAT),
  version: z.literal(NETWORK_RULES_FILE_VERSION),
  exportedAt: z.iso.datetime(),
  fleet: z.object({ id: idSchema('fleet'), name: z.string() }),
  rulesVersion: z.int().min(0),
  labels: z.array(fileLabelSchema),
  rules: z.array(fileRuleSchema).nullable(),
});

export type NetworkRulesFile = z.infer<typeof networkRulesFileSchema>;

/** The file as attached or pasted: its text, parsed by the server, of at most 64 KB (decision 0006). */
const fileTextSchema = z.string().refine((text) => payloadBytes(text) <= PAYLOAD_MAX_BYTES, `A network rules file is at most ${String(PAYLOAD_MAX_BYTES)} bytes (64 KB) in UTF-8`);

/** Input of `fleet.checkNetworkRulesFile` (fleet:network and labels:define). */
export const checkNetworkRulesFileInputSchema = z.object({ file: fileTextSchema });

/** The ways to resolve a difference (design network-io, Q9). */
export const DIFFERENCE_WAYS = ['useExisting', 'dropRules', 'pickShip'] as const;

export type DifferenceWay = (typeof DIFFERENCE_WAYS)[number];

/**
 * A difference between the file and the fleet, with the ways offered for it:
 * a key the fleet has with another definer (use the existing label, or drop
 * the rules on it); a key the fleet has with other values (use the existing
 * label when it has every value the rules name, else drop the rules naming a
 * value it lacks); an owner's ship name no active ship has (pick an active
 * ship, or drop the rules naming it).
 */
export const networkRulesDifferenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('definer'), key: z.string(), fileDefiner: z.string(), fleetDefiner: z.string(), ways: z.array(z.enum(['useExisting', 'dropRules'])) }),
  z.object({
    kind: z.literal('values'),
    key: z.string(),
    fileValues: z.array(z.string()),
    fleetValues: z.array(z.string()),
    /** The values the rules name that the fleet's label lacks. */
    missingValues: z.array(z.string()),
    ways: z.array(z.enum(['useExisting', 'dropRules'])),
  }),
  z.object({ kind: z.literal('ship'), name: z.string(), ways: z.array(z.enum(['pickShip', 'dropRules'])) }),
]);

export type NetworkRulesDifference = z.infer<typeof networkRulesDifferenceSchema>;

/** Output of `fleet.checkNetworkRulesFile`: the file as read, the keys import would define, and every difference with the fleet. */
export const checkNetworkRulesFileOutputSchema = z.object({
  file: networkRulesFileSchema,
  newLabels: z.array(z.string()),
  differences: z.array(networkRulesDifferenceSchema),
});

export type CheckedNetworkRulesFile = z.infer<typeof checkNetworkRulesFileOutputSchema>;

/** How the person resolved one difference, named by its kind and its key or ship name. */
export const networkRulesResolutionSchema = z.union([
  z.object({ kind: z.enum(['definer', 'values']), key: z.string(), way: z.enum(['useExisting', 'dropRules']) }),
  z.object({ kind: z.literal('ship'), name: z.string(), way: z.literal('pickShip'), shipId: idSchema('ship') }),
  z.object({ kind: z.literal('ship'), name: z.string(), way: z.literal('dropRules') }),
]);

export type NetworkRulesResolution = z.infer<typeof networkRulesResolutionSchema>;

/**
 * Input of `fleet.importNetworkRules` (fleet:network and labels:define): the
 * file, the ship that defines the labels import creates, argo when none is
 * named, and a resolution of every difference the check answered.
 */
export const importNetworkRulesInputSchema = z.object({
  file: fileTextSchema,
  definerShipId: idSchema('ship').optional(),
  resolutions: z.array(networkRulesResolutionSchema),
});

export type ImportNetworkRulesInput = z.infer<typeof importNetworkRulesInputSchema>;

/** Output of `fleet.importNetworkRules`: the settings version the draft was saved against, which its apply names, and the keys it defined. */
export const importNetworkRulesOutputSchema = z.object({ savedAgainstVersion: z.int().min(0), definedLabels: z.array(z.string()) });
