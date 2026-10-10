import { NETWORK_RULES_MAX, SHIP_LABELS_MAX, type NetworkRule } from '@aeolus-fleet/common';

/**
 * What breaks decision 0034's limits, said for argo, or undefined when the
 * rules keep them: at most 200 rules, each selector at most 20 label values,
 * as a ship carries no more, each once. The fleet checks them too; checking
 * here keeps a list the fleet would refuse from being kept and supplied
 * again and again.
 */
export function brokenRuleLimit(rules: readonly NetworkRule[]): string | undefined {
  if (rules.length > NETWORK_RULES_MAX) {
    return `A fleet holds at most ${String(NETWORK_RULES_MAX)} network rules`;
  }
  for (const selector of rules.flatMap((rule) => [rule.from, rule.to])) {
    if (selector.length > SHIP_LABELS_MAX) {
      return `A selector holds at most ${String(SHIP_LABELS_MAX)} label values, as a ship carries no more`;
    }
    // The editor picks exact values only; terms of any or the same value the fleet checks (decision 0034).
    const valueIds = selector.filter((term) => typeof term === 'string');
    const twice = valueIds.find((valueId, index) => valueIds.indexOf(valueId) !== index);
    if (twice !== undefined) {
      return `A selector names each label value once: ${twice} twice`;
    }
  }
  return undefined;
}
