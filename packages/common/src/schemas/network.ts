import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { carriedLabelSchema } from './label.js';

/**
 * Network rules (decision 0033): which ships may send to which. A rule says
 * that the ships matching one label selector may send to the ships matching
 * another; a selector is a set of label value ids, matched as label selection
 * is (every one of them, an empty one every ship). Allow-only. The limits are
 * the decision's; the server checks them, so every refusal names it.
 */

/** The most rules one fleet may hold. */
export const NETWORK_RULES_MAX = 200;

/** The most refusals one read of them answers: the latest. */
export const REACH_REFUSALS_READ_MAX = 100;

/** Ships carrying every one of these label values: exact matches, combined with AND. */
export const labelSelectorSchema = z.array(idSchema('labelValue'));

/** One rule: the ships matching `from` may send to the ships matching `to`. */
export const networkRuleSchema = z.object({ from: labelSelectorSchema, to: labelSelectorSchema });

export type NetworkRule = z.infer<typeof networkRuleSchema>;

/** Input of `fleet.setNetworkRules` (fleet:network): every rule the fleet holds from now on, or none for all-to-all. */
export const setNetworkRulesInputSchema = z.object({ rules: z.array(networkRuleSchema).nullable() });

/** Output of `fleet.setNetworkRules`: the version the fleet's network settings have now. */
export const setNetworkRulesOutputSchema = z.object({ version: z.int().min(1) });

/** A ship as a reach refusal saw it: its id, its name and the label values it carried then. */
const refusedShipSchema = z.object({ id: idSchema('ship'), name: z.string(), labels: z.array(carriedLabelSchema) });

/** One refused send: who tried to reach whom, both ships as they were, the settings version that refused it and when. */
export const reachRefusalSchema = z.object({
  id: idSchema('reachRefusal'),
  at: z.iso.datetime(),
  sender: refusedShipSchema,
  recipient: z.object({ kind: z.literal('ship'), ship: refusedShipSchema }),
  settingsVersion: z.int().min(1),
});

export type ReachRefusal = z.infer<typeof reachRefusalSchema>;

/** Output of `fleet.reachRefusals` (argo only): the fleet's latest refusals, newest first, at most REACH_REFUSALS_READ_MAX. */
export const reachRefusalsOutputSchema = z.array(reachRefusalSchema);
