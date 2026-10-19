import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { accountIdSchema } from './account-token.js';
import { carriedLabelSchema } from './label.js';

/**
 * Network rules (decision 0034): which ships may send to, read or manage
 * which. A rule names its verb and says that the ships matching one selector
 * may do it to the ships matching another; a selector is a list of terms that must all hold (an empty one
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
 * names its label; a label with any value (`*`) or with the same value as
 * the other side's (`#`), which binds the same label there only; or the
 * owner (decision 0045): an owner's ship by its id, any owner (`*`), or the
 * same owner as the other side's (`#`), which binds the owner there.
 */
export const selectorTermSchema = z.union([
  idSchema('labelValue'),
  z.object({ labelId: idSchema('label'), value: z.enum([ANY_LABEL_VALUE, SAME_LABEL_VALUE]) }),
  z.object({ owner: z.union([idSchema('ship'), z.enum([ANY_LABEL_VALUE, SAME_LABEL_VALUE])]) }),
]);

export type SelectorTerm = z.infer<typeof selectorTermSchema>;

/** A term of the owner (decision 0045). */
export type OwnerTerm = Extract<SelectorTerm, { owner: unknown }>;

/** A term on a label: an exact value, or a label with any or the same value. */
export type LabelTerm = Exclude<SelectorTerm, OwnerTerm>;

export function isOwnerTerm(term: SelectorTerm): term is OwnerTerm {
  return typeof term !== 'string' && 'owner' in term;
}

/** The ships for which every one of these terms holds, combined with AND. */
export const labelSelectorSchema = z.array(selectorTermSchema);

/** What a rule lets one ship do to another: send to it, read it or manage it (decision 0034). */
export const NETWORK_VERBS = ['send', 'read', 'manage'] as const;

export type NetworkVerb = (typeof NETWORK_VERBS)[number];

/** One rule: the ships matching `from` may do its verb to the ships matching `to`. */
export const networkRuleSchema = z.object({ verb: z.enum(NETWORK_VERBS), from: labelSelectorSchema, to: labelSelectorSchema });

export type NetworkRule = z.infer<typeof networkRuleSchema>;

/** Input of `fleet.setNetworkRules` (fleet:network): every rule the fleet holds from now on beside the built-in ones. */
export const setNetworkRulesInputSchema = z.object({ rules: z.array(networkRuleSchema) });

/**
 * The built-in rules, core's own (decision 0034): argo to and from every ship,
 * the owner's ship to the ships it owns, an answer to the sender of the
 * message it answers, and a connected plugin's ship reading every ship, which
 * are never off; the viewer reading every ship,
 * which argo turns off or on; the installation managing person ships and the
 * ships they own, never off (decision 0020); and open, every ship to every
 * ship, one per verb, which the networking plugin turns off or on.
 */
export const BUILT_IN_RULES = ['argo', 'owner', 'answer', 'pluginRead', 'viewerRead', 'installation', 'open'] as const;

export type BuiltInRule = (typeof BUILT_IN_RULES)[number];

/** The built-in rules that are never off. */
export const FIXED_BUILT_IN_RULES = ['argo', 'owner', 'answer', 'pluginRead', 'installation'] as const satisfies readonly BuiltInRule[];

/** Input of `fleet.setBuiltInRule` (fleet:network): a built-in rule turned on or off, open for one verb, which it names and no other rule does. */
export const setBuiltInRuleInputSchema = z
  .object({ rule: z.enum(BUILT_IN_RULES), verb: z.enum(NETWORK_VERBS).optional(), isOn: z.boolean() })
  .refine((input) => (input.rule === 'open') === (input.verb !== undefined), { message: 'open names its verb, and no other built-in rule names one', path: ['verb'] });

export type SetBuiltInRuleInput = z.infer<typeof setBuiltInRuleInputSchema>;

/**
 * One built-in rule as it is now: open for one verb, which it names and no
 * other rule does, and whether it is on; the fixed ones always are.
 */
export const builtInRuleStateSchema = z.union([
  z.object({ rule: z.enum(['argo', 'owner', 'answer', 'pluginRead', 'viewerRead', 'installation']), isOn: z.boolean() }),
  z.object({ rule: z.literal('open'), verb: z.enum(NETWORK_VERBS), isOn: z.boolean() }),
]);

export type BuiltInRuleState = z.infer<typeof builtInRuleStateSchema>;

/** Output of `fleet.builtInRules` (fleet:network): every built-in rule as it is now, in the order the rule list shows them, first (decision 0034). */
export const builtInRulesOutputSchema = z.array(builtInRuleStateSchema);

/**
 * Output of `fleet.networkPlugin` (fleet:read): the fleet's networking plugin,
 * its ship and when it registered, or null without one (decision 0035). The
 * gateway reads it before it switches on for a fleet (interop I-3).
 */
export const networkPluginOutputSchema = z.object({ shipId: idSchema('ship'), registeredAt: z.iso.datetime() }).nullable();

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

/** A ship as a reach refusal saw it: its id, its name, the label values it carried then and its owner's ship then, none for argo and the viewer (decision 0045). */
const refusedShipSchema = z.object({
  id: idSchema('ship'),
  name: z.string(),
  labels: z.array(carriedLabelSchema),
  owner: z.object({ id: idSchema('ship'), name: z.string() }).nullable(),
});

/**
 * The request header a plugin ship names the ship it reads on behalf of with,
 * by id: every fleet:read read then answers with that ship's read reach
 * (decision 0034). Any other call refuses it.
 */
export const ON_BEHALF_OF_HEADER = 'aeolus-on-behalf-of';

/**
 * Who a refusal refused (decision 0057): a ship as it was; an account by
 * its id only, never an email, with the `group` values its token carried
 * that the fleet defines and its person ship then; or the installation.
 */
const refusedActorSchema = z.discriminatedUnion('kind', [
  refusedShipSchema.extend({ kind: z.literal('ship') }),
  z.object({
    kind: z.literal('account'),
    accountId: accountIdSchema,
    labels: z.array(carriedLabelSchema),
    personShip: z.object({ id: idSchema('ship'), name: z.string() }).nullable(),
  }),
  z.object({ kind: z.literal('installation') }),
]);

/** One refused call: who tried to reach whom by which verb, the actor and the ship as they were with their owners, the settings version that refused it and when. */
export const reachRefusalSchema = z.object({
  id: idSchema('reachRefusal'),
  at: z.iso.datetime(),
  sender: refusedActorSchema,
  /** The plugin ship that read on behalf of the sender (decision 0034), as it was then; null for the sender's own call. */
  askedBy: refusedShipSchema.nullable(),
  recipient: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('ship'), ship: refusedShipSchema }),
    /** A send to a type: the type and each ship of it, none of which the sender may reach. */
    z.object({ kind: z.literal('type'), type: z.string(), ships: z.array(refusedShipSchema) }),
  ]),
  /** What the sender tried to do: send, the one verb checked so far. */
  verb: z.enum(NETWORK_VERBS),
  settingsVersion: z.int().min(1),
  /** What the plugin declared for while it is unavailable, when it refused because the plugin was not responding (decision 0035); null otherwise. */
  whilePluginUnavailable: z.enum(['block-all', 'keep-latest']).nullable(),
});

export type ReachRefusal = z.infer<typeof reachRefusalSchema>;

/** Output of `fleet.reachRefusals` (argo only): the fleet's latest refusals, newest first, at most REACH_REFUSALS_READ_MAX. */
export const reachRefusalsOutputSchema = z.array(reachRefusalSchema);

/** Input of `fleet.explainReach` (argo only): the ship to explain from, and the one ship asked about, or none for every ship. */
export const explainReachInputSchema = z.object({ fromShipId: idSchema('ship'), toShipId: idSchema('ship').optional() });

/**
 * The rule that lets one ship reach another (decision 0034): a built-in rule;
 * a rule the networking plugin supplied, by its place in the fleet's list;
 * or a rule a ship declared, by its declarer and its place in that ship's
 * list (decision 0037).
 */
export const reachRuleSchema = z.union([
  z.object({ builtIn: z.enum(BUILT_IN_RULES) }),
  z.object({ plugin: z.int().min(0) }),
  z.object({ declared: idSchema('ship'), index: z.int().min(0) }),
]);

export type ReachRule = z.infer<typeof reachRuleSchema>;

const reachedShipsSchema = z.array(z.object({ shipId: idSchema('ship'), rule: reachRuleSchema }));

/** Output of `fleet.explainReach`: per verb, the ships it reaches now, each with the rule that allows it. */
export const explainReachOutputSchema = z.object({ send: reachedShipsSchema, read: reachedShipsSchema, manage: reachedShipsSchema });

export type ExplainedReach = z.infer<typeof explainReachOutputSchema>;
