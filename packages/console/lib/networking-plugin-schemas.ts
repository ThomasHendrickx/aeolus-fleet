import { networkRuleSchema, WHILE_UNAVAILABLE } from '@aeolus-fleet/common';
import { z } from 'zod';

/**
 * The networking plugin's answers as the web app's server parses them
 * (decision 0033): outside data, checked here before any reaches the
 * browser, which imports only the types.
 */

const rulesSchema = z.array(networkRuleSchema).nullable();

/** What the plugin declares for while it is unavailable (decision 0035). */
const declarationSchema = z.object({ whileUnavailable: z.enum(WHILE_UNAVAILABLE), notRespondingAfterSeconds: z.int() });

/** What a save did at the fleet: supplied, or waiting for the fleet to answer; the other two only in a race with a disconnect or a switch. */
const supplySchema = z.enum(['supplied', 'waiting', 'not-connected', 'unregistered']);

/** `network.get`: the rules, none for all-to-all, and the declaration. */
export const networkSchema = z.object({ rules: rulesSchema, declaration: declarationSchema });

/** `network.setRules`: the rules as kept, and the supply. */
export const savedRulesSchema = z.object({ rules: rulesSchema, supply: supplySchema });

/** `network.setDeclaration`: the declaration as kept, and the supply. */
export const savedDeclarationSchema = z.object({ declaration: declarationSchema, supply: supplySchema });

export type Network = z.infer<typeof networkSchema>;
export type SavedRules = z.infer<typeof savedRulesSchema>;
export type SavedDeclaration = z.infer<typeof savedDeclarationSchema>;
export type NetworkDeclaration = Network['declaration'];
