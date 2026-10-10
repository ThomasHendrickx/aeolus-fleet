import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { carriedLabelSchema } from './label.js';

/**
 * Network rules (decision 0034): which ships may send to which. A rule says
 * that the ships matching one label selector may send to the ships matching
 * another; a selector is a list of terms that must all hold (an empty one
 * holds for every ship). Allow-only. The limits are the decision's; the server
 * checks them, so every refusal names it.
 */

/** The most rules of argo's one fleet may hold, beside the rules its ships declared (decision 0037). */
export const NETWORK_RULES_MAX = 200;

/** The most rules one ship may declare (decision 0037). */
export const DECLARED_NETWORK_RULES_MAX = 20;

/** The most refusals one read of them answers: the latest. */
export const REACH_REFUSALS_READ_MAX = 100;

/** A term's value that is any value of its label: the ship carries the label. */
export const ANY_LABEL_VALUE = '*' as const;

/** A term's value that is any value of its label the ship on the other side of the rule carries too. */
export const SAME_LABEL_VALUE = '#' as const;

/**
 * One term of a selector: an exact label value, written as its id, which
 * names its label; or a label with any value (`*`) or with the same value as
 * the other side's (`#`), which binds the same label there only.
 */
export const selectorTermSchema = z.union([idSchema('labelValue'), z.object({ labelId: idSchema('label'), value: z.enum([ANY_LABEL_VALUE, SAME_LABEL_VALUE]) })]);

export type SelectorTerm = z.infer<typeof selectorTermSchema>;

/** The ships for which every one of these terms holds, combined with AND. */
export const labelSelectorSchema = z.array(selectorTermSchema);

/** One rule: the ships matching `from` may send to the ships matching `to`. */
export const networkRuleSchema = z.object({ from: labelSelectorSchema, to: labelSelectorSchema });

export type NetworkRule = z.infer<typeof networkRuleSchema>;

/** Input of `fleet.setNetworkRules` (fleet:network): every rule the fleet holds from now on, or none for all-to-all. */
export const setNetworkRulesInputSchema = z.object({ rules: z.array(networkRuleSchema).nullable() });

/** Output of `fleet.setNetworkRules`: the version the fleet's network settings have now. */
export const setNetworkRulesOutputSchema = z.object({ version: z.int().min(1) });

/** Input of `fleet.declareNetworkRules` (labels:define): every rule the ship declares from now on, on labels it owns; an empty list withdraws them (decision 0037). */
export const declareNetworkRulesInputSchema = z.object({ rules: z.array(networkRuleSchema) });

/** Output of `fleet.declareNetworkRules`: how many rules the ship declares now. */
export const declareNetworkRulesOutputSchema = z.object({ rules: z.int().min(0) });

/** Output of `fleet.declaredNetworkRules` (fleet:network): each ship that declared rules, with its whole list. */
export const declaredNetworkRulesOutputSchema = z.array(z.object({ shipId: idSchema('ship'), rules: z.array(networkRuleSchema) }));

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

/** Input of `fleet.explainReach` (argo only): the ship to explain from, and the one ship asked about, or none for every ship. */
export const explainReachInputSchema = z.object({ fromShipId: idSchema('ship'), toShipId: idSchema('ship').optional() });

/** Output of `fleet.explainReach`: the ships it reaches now, by id; never the rules or why (design on #260). */
export const explainReachOutputSchema = z.object({ reachableShipIds: z.array(idSchema('ship')) });
