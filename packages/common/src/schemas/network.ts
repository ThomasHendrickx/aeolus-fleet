import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { carriedLabelSchema } from './label.js';

/**
 * Network rules (decision 0034): which ships may send to which. A rule says
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

/**
 * What happens to sends while a fleet's networking plugin is unavailable
 * (decision 0035): every send refused but the fixed exceptions, every send
 * allowed, or the rules it supplied last kept.
 */
export const WHILE_UNAVAILABLE = ['block-all', 'open-all', 'keep-latest'] as const;

export type WhileUnavailable = (typeof WHILE_UNAVAILABLE)[number];

/** The least time without a call from its ship after which a networking plugin is not responding: longer than a receive waits. */
export const NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS = 60;

/** The most: a day. */
export const NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS = 86_400;

/** Input of `fleet.registerNetworkPlugin` (fleet:network): what happens while the plugin is unavailable, and after how long without a call it is not responding. */
export const registerNetworkPluginInputSchema = z.object({
  whileUnavailable: z.enum(WHILE_UNAVAILABLE),
  notRespondingAfterSeconds: z.int().min(NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS).max(NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS),
});

export type NetworkPluginDeclaration = z.infer<typeof registerNetworkPluginInputSchema>;

/** A ship as a reach refusal saw it: its id, its name and the label values it carried then. */
const refusedShipSchema = z.object({ id: idSchema('ship'), name: z.string(), labels: z.array(carriedLabelSchema) });

/** One refused send: who tried to reach whom, both ships as they were, the settings version that refused it and when. */
export const reachRefusalSchema = z.object({
  id: idSchema('reachRefusal'),
  at: z.iso.datetime(),
  sender: refusedShipSchema,
  recipient: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('ship'), ship: refusedShipSchema }),
    /** A send to a type: the type and each ship of it, none of which the sender may reach. */
    z.object({ kind: z.literal('type'), type: z.string(), ships: z.array(refusedShipSchema) }),
  ]),
  settingsVersion: z.int().min(1),
  /** What the plugin declared for while it is unavailable, when it refused because the plugin was not responding (decision 0035); null otherwise. */
  whilePluginUnavailable: z.enum(['block-all', 'keep-latest']).nullable(),
});

export type ReachRefusal = z.infer<typeof reachRefusalSchema>;

/** Output of `fleet.reachRefusals` (argo only): the fleet's latest refusals, newest first, at most REACH_REFUSALS_READ_MAX. */
export const reachRefusalsOutputSchema = z.array(reachRefusalSchema);
