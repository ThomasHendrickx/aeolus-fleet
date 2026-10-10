import { NETWORK_RULES_MAX, SAME_LABEL_VALUE, SHIP_LABELS_MAX, type LabelId, type NetworkRule, type SelectorTerm } from '@aeolus-fleet/common';

/**
 * What breaks decision 0034's limits, said for argo as the fleet says it, or
 * undefined when the rules keep them: at most 200 rules, each selector at most
 * 20 terms, as a ship carries no more label values, each term once, and a
 * term of the same value on a label on both sides of its rule. The fleet
 * checks them too; checking here keeps a list the fleet would refuse from
 * being kept and supplied again and again.
 */
export function brokenRuleLimit(rules: readonly NetworkRule[]): string | undefined {
  if (rules.length > NETWORK_RULES_MAX) {
    return `A fleet holds at most ${String(NETWORK_RULES_MAX)} network rules`;
  }
  for (const rule of rules) {
    const broken = brokenSelector(rule.from) ?? brokenSelector(rule.to) ?? sameValueOnOneSide(rule);
    if (broken !== undefined) {
      return broken;
    }
  }
  return undefined;
}

function brokenSelector(selector: readonly SelectorTerm[]): string | undefined {
  if (selector.length > SHIP_LABELS_MAX) {
    return `A selector holds at most ${String(SHIP_LABELS_MAX)} terms, as a ship carries no more label values`;
  }
  const texts = selector.map(termText);
  const twice = texts.find((text, index) => texts.indexOf(text) !== index);
  return twice === undefined ? undefined : `A selector holds each term once: ${twice} twice`;
}

function sameValueOnOneSide(rule: NetworkRule): string | undefined {
  const [from, to] = [sameValueLabels(rule.from), sameValueLabels(rule.to)];
  const alone = [...from.filter((labelId) => !to.includes(labelId)), ...to.filter((labelId) => !from.includes(labelId))][0];
  return alone === undefined ? undefined : `A term of the same value binds its label on both sides: ${termText({ labelId: alone, value: SAME_LABEL_VALUE })} is on one side only`;
}

/** A term as a refusal names it: an exact value by its id, any other by its label id and symbol. */
function termText(term: SelectorTerm): string {
  return typeof term === 'string' ? term : `${term.labelId}=${term.value}`;
}

function sameValueLabels(selector: readonly SelectorTerm[]): LabelId[] {
  return selector.flatMap((term) => (typeof term !== 'string' && term.value === SAME_LABEL_VALUE ? [term.labelId] : []));
}
