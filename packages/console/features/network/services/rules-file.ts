import type { DifferenceWay, FileRule, FileTerm, NetworkRulesDifference, NetworkRulesFile, NetworkRulesResolution, NetworkVerb, ShipId } from '@aeolus-fleet/common';

/**
 * What Network shows of a network rules file (design network-io): the name
 * an export downloads as, a rule by name in the import overview, the ways
 * each difference offers, worded, and the resolutions the person picked. The
 * fleet reads and checks the file; this only words what it answered.
 */

/** The file an export downloads as: the fleet and the rules version, so two files tell apart. */
export function exportFileNameOf(file: NetworkRulesFile): string {
  const fleet = file.fleet.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '');
  return `network-rules-${fleet}-v${String(file.rulesVersion)}.json`;
}

function termTextOf(term: FileTerm): string {
  return 'label' in term ? `${term.label}=${term.value}` : `owner=${term.owner}`;
}

/** A rule as the overview lists it: its verb, and each side's terms, an empty side every ship. */
export function ruleTextOf(rule: FileRule): { verb: NetworkVerb; from: string[]; to: string[] } {
  const sideOf = (terms: readonly FileTerm[]) => (terms.length === 0 ? ['every ship'] : terms.map(termTextOf));
  return { verb: rule.verb, from: sideOf(rule.from), to: sideOf(rule.to) };
}

function wayText(difference: NetworkRulesDifference, way: DifferenceWay): string {
  switch (difference.kind) {
    case 'definer':
      return way === 'useExisting' ? `Use the label ${difference.key} as it is, defined by ${difference.fleetDefiner}` : `Drop the rules on ${difference.key}`;
    case 'values':
      return way === 'useExisting'
        ? `Use the label ${difference.key} as it is: it has every value the rules name`
        : `Drop the rules naming ${difference.missingValues.map((value) => `${difference.key}=${value}`).join(', ')}`;
    case 'ship':
      return way === 'pickShip' ? `Pick an active ship for ${difference.name}` : `Drop the rules naming owner=${difference.name}`;
  }
}

/** Each way the difference offers, worded for it. */
export function waysOf(difference: NetworkRulesDifference): { way: DifferenceWay; text: string }[] {
  return difference.ways.map((way) => ({ way, text: wayText(difference, way) }));
}

/** A way the person picked for a difference, with the ship picked for a pick, once one is. */
export interface ResolutionChoice {
  difference: NetworkRulesDifference;
  way: DifferenceWay;
  shipId?: ShipId;
}

/** The key that tells a difference apart from the others: its kind and its key or ship name. */
export function differenceKeyOf(difference: NetworkRulesDifference): string {
  return difference.kind === 'ship' ? `ship:${difference.name}` : `${difference.kind}:${difference.key}`;
}

function choiceFor(difference: NetworkRulesDifference, choices: readonly ResolutionChoice[]): ResolutionChoice | undefined {
  return choices.find((choice) => differenceKeyOf(choice.difference) === differenceKeyOf(difference));
}

/** Whether every difference has a way, and a ship for a pick: only then may the import go. */
export function isEveryDifferenceResolved(differences: readonly NetworkRulesDifference[], choices: readonly ResolutionChoice[]): boolean {
  return differences.every((difference) => {
    const choice = choiceFor(difference, choices);
    return choice !== undefined && (choice.way !== 'pickShip' || choice.shipId !== undefined);
  });
}

/** The resolution the import takes for a complete choice; none for a pick without its ship. */
export function resolutionOf(choice: ResolutionChoice): NetworkRulesResolution | undefined {
  const { difference, way } = choice;
  if (difference.kind === 'ship') {
    if (way === 'pickShip') {
      return choice.shipId === undefined ? undefined : { kind: 'ship', name: difference.name, way, shipId: choice.shipId };
    }
    return { kind: 'ship', name: difference.name, way: 'dropRules' };
  }
  return { kind: difference.kind, key: difference.key, way: way === 'useExisting' ? 'useExisting' : 'dropRules' };
}
