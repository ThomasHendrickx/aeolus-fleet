/**
 * The network rules file (docs/design/network-io): the fleet's applied rules
 * and the labels they use, by name, so a rule set leaves one fleet and comes
 * back into it or another. Export turns every id into its name; import reads
 * the file, finds where the fleet differs from it, drops what the person
 * chose to drop and turns every name back into an id for the draft
 * (decision 0035). Ids differ between fleets, names travel.
 */
import {
  ANY_LABEL_VALUE,
  NETWORK_RULES_FILE_FORMAT,
  NETWORK_RULES_FILE_VERSION,
  NETWORK_RULES_MAX,
  SAME_LABEL_VALUE,
  isOwnerTerm,
  networkRulesFileSchema,
  type FileLabel,
  type FileRule,
  type FileTerm,
  type FleetId,
  type NetworkRulesDifference,
  type NetworkRulesFile,
  type NetworkRulesResolution,
  type SelectorTerm,
  type ShipId,
} from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { checkValueTexts, labelKey, type Label } from './label.js';
import { invalidRuleBy, type NetworkRule, type TermView } from './network-settings.js';

export type InvalidNetworkRulesFile = DomainError<'INVALID_NETWORK_RULES_FILE'>;

export type LabelDifferences = DomainError<'LABEL_DIFFERENCES'>;

type LabelFileTerm = Extract<FileTerm, { label: string }>;

function isLabelTerm(term: FileTerm): term is LabelFileTerm {
  return 'label' in term;
}

function isSymbol(value: string): value is typeof ANY_LABEL_VALUE | typeof SAME_LABEL_VALUE {
  return value === ANY_LABEL_VALUE || value === SAME_LABEL_VALUE;
}

const TERMS_BY_NAME: TermView<FileTerm> = {
  text: (term) => (isLabelTerm(term) ? `${term.label}=${term.value}` : `owner=${term.owner}`),
  sameValueLabel: (term) => (isLabelTerm(term) && term.value === SAME_LABEL_VALUE ? term.label : undefined),
  isSameOwner: (term) => !isLabelTerm(term) && term.owner === SAME_LABEL_VALUE,
};

function invalidFile(message: string): Result<never, InvalidNetworkRulesFile> {
  return refuse('INVALID_NETWORK_RULES_FILE', message);
}

function jsonOf(text: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

/**
 * The file in the text, attached or pasted: JSON of the format at version 1,
 * of the file's shape, keeping the limits of labels (decision 0031) and of
 * rules (decisions 0034, 0037), every term on a label the file holds and a
 * value it gives that label. Another version is refused, naming it, never
 * migrated (decision 0013); every other break is named, each one.
 */
export function readNetworkRulesFile(text: string): Result<NetworkRulesFile, InvalidNetworkRulesFile> {
  const json = jsonOf(text);
  if (json === undefined) {
    return invalidFile('The file is not JSON');
  }
  const { value } = json;
  const format: unknown = typeof value === 'object' && value !== null && 'format' in value ? value.format : undefined;
  if (format !== NETWORK_RULES_FILE_FORMAT) {
    return invalidFile(`The file is not an ${NETWORK_RULES_FILE_FORMAT} file`);
  }
  const version: unknown = typeof value === 'object' && value !== null && 'version' in value ? value.version : undefined;
  if (version !== NETWORK_RULES_FILE_VERSION) {
    return invalidFile(`The file is version ${version === undefined ? 'none' : JSON.stringify(version)}; this fleet reads version ${String(NETWORK_RULES_FILE_VERSION)} only (decision 0013)`);
  }
  const parsed = networkRulesFileSchema.safeParse(value);
  if (!parsed.success) {
    return invalidFile(`The file breaks: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  const breaks = [...labelBreaks(parsed.data.labels), ...ruleBreaks(parsed.data)];
  return breaks.length === 0 ? ok(parsed.data) : invalidFile(`The file breaks: ${breaks.join('; ')}`);
}

function labelBreaks(labels: readonly FileLabel[]): string[] {
  return labels.flatMap((label, index) => {
    const breaks: string[] = [];
    const key = labelKey(label.key);
    if (!key.isOk) {
      breaks.push(key.error.message);
    }
    const values = checkValueTexts(label.values);
    if (!values.isOk) {
      breaks.push(values.error.message);
    }
    if (labels.findIndex((other) => other.key === label.key) !== index) {
      breaks.push('the file holds it twice');
    }
    return breaks.map((broken) => `label ${label.key}: ${broken}`);
  });
}

function ruleBreaks(file: NetworkRulesFile): string[] {
  const { rules } = file;
  if (rules === null) {
    return [];
  }
  if (rules.length > NETWORK_RULES_MAX) {
    return [`A fleet holds at most ${String(NETWORK_RULES_MAX)} network rules of its own, beside the ones its ships declared (decision 0037)`];
  }
  return rules.flatMap((rule, index) => {
    const limit = invalidRuleBy(rule, TERMS_BY_NAME);
    const broken = limit === undefined ? unknownTermIn(rule, file.labels) : `${limit} (decision 0034)`;
    return broken === undefined ? [] : [`rule ${String(index + 1)}: ${broken}`];
  });
}

function unknownTermIn(rule: FileRule, labels: readonly FileLabel[]): string | undefined {
  for (const term of [...rule.from, ...rule.to].filter(isLabelTerm)) {
    const label = labels.find((held) => held.key === term.label);
    if (label === undefined) {
      return `${term.label} is a label the file does not hold`;
    }
    if (!isSymbol(term.value) && !label.values.includes(term.value)) {
      return `${term.label}=${term.value} is a value the file does not give the label ${term.label}`;
    }
  }
  return undefined;
}

/**
 * The file of the applied rules: every id as its name, a label value by its
 * key and value, a label by its key, an owner's ship by its name; the labels
 * the rules use, by key as given, each with all its values and its definer's
 * name. A rule naming a label or ship the fleet no longer has matches no
 * ship, so it is left out. `rulesVersion` is the settings version.
 */
export function exportedFile(input: {
  fleet: { id: FleetId; name: string };
  applied: { rules: readonly NetworkRule[] | null; version: number };
  labels: readonly { label: Label; definer: string }[];
  shipNames: ReadonlyMap<ShipId, string>;
  at: Date;
}): NetworkRulesFile {
  const { applied, labels, shipNames } = input;
  const used = new Set<Label>();
  const nameOf = (term: SelectorTerm): { term: FileTerm; label?: Label } | undefined => {
    if (typeof term === 'string') {
      const found = labels.find(({ label }) => label.values.some((value) => value.id === term))?.label;
      const value = found?.values.find((held) => held.id === term)?.value;
      return found === undefined || value === undefined ? undefined : { term: { label: found.key, value }, label: found };
    }
    if (isOwnerTerm(term)) {
      const owner = isSymbol(term.owner) ? term.owner : shipNames.get(term.owner);
      return owner === undefined ? undefined : { term: { owner } };
    }
    const found = labels.find(({ label }) => label.id === term.labelId)?.label;
    return found === undefined ? undefined : { term: { label: found.key, value: term.value }, label: found };
  };
  const rules =
    applied.rules === null
      ? null
      : applied.rules.flatMap((rule): FileRule[] => {
          const [from, to] = [rule.from.map(nameOf), rule.to.map(nameOf)];
          const named = [...from, ...to];
          if (named.some((term) => term === undefined)) {
            return [];
          }
          for (const term of named) {
            if (term?.label !== undefined) {
              used.add(term.label);
            }
          }
          const termsOf = (side: typeof from) => side.flatMap((term) => (term === undefined ? [] : [term.term]));
          return [{ verb: rule.verb, from: termsOf(from), to: termsOf(to) }];
        });
  return {
    format: NETWORK_RULES_FILE_FORMAT,
    version: NETWORK_RULES_FILE_VERSION,
    exportedAt: input.at.toISOString(),
    fleet: { ...input.fleet },
    rulesVersion: applied.version,
    labels: labels.filter(({ label }) => used.has(label)).map(({ label, definer }) => ({ key: label.key, values: label.values.map((value) => value.value), definer })),
    rules,
  };
}

/** A label of the fleet as import compares it with the file: its key, its value texts and its definer's name, or `installation`. */
export interface FleetLabel {
  key: string;
  values: readonly string[];
  definer: string;
}

/** The owner ship names the rules use, each once, in the order they first name them. */
export function ownerNamesIn(rules: readonly FileRule[] | null): string[] {
  const names = (rules ?? []).flatMap((rule) => [...rule.from, ...rule.to].flatMap((term) => (isLabelTerm(term) || isSymbol(term.owner) ? [] : [term.owner])));
  return [...new Set(names)];
}

function valuesNamed(rules: readonly FileRule[] | null, key: string): Set<string> {
  return new Set((rules ?? []).flatMap((rule) => [...rule.from, ...rule.to].flatMap((term) => (isLabelTerm(term) && term.label === key && !isSymbol(term.value) ? [term.value] : []))));
}

function isSameSet(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((value) => second.includes(value));
}

/**
 * Where the fleet differs from the file (design network-io, Q3, Q9), each
 * difference with the ways to resolve it: a key the fleet has with another
 * definer (use the existing label, or drop the rules on it); a key with
 * other values (use the existing label when it has every value the rules
 * name, else drop the rules naming a value it lacks); an owner's ship name
 * no active ship has (pick one, or drop the rules naming it). Beside them,
 * the keys the fleet lacks, which import defines. The fleet a file came from
 * differs from it in nothing, so a backup comes back as it was.
 */
export function differencesOf(file: NetworkRulesFile, fleet: { labels: readonly FleetLabel[]; activeShipNames: readonly string[] }): { newLabels: string[]; differences: NetworkRulesDifference[] } {
  const newLabels: string[] = [];
  const differences: NetworkRulesDifference[] = [];
  for (const label of file.labels) {
    const held = fleet.labels.find((other) => other.key === label.key);
    if (held === undefined) {
      newLabels.push(label.key);
      continue;
    }
    if (held.definer !== label.definer) {
      differences.push({ kind: 'definer', key: label.key, fileDefiner: label.definer, fleetDefiner: held.definer, ways: ['useExisting', 'dropRules'] });
    }
    if (!isSameSet(held.values, label.values)) {
      const named = valuesNamed(file.rules, label.key);
      const missingValues = label.values.filter((value) => named.has(value) && !held.values.includes(value));
      differences.push({
        kind: 'values',
        key: label.key,
        fileValues: [...label.values],
        fleetValues: [...held.values],
        missingValues,
        ways: missingValues.length === 0 ? ['useExisting'] : ['dropRules'],
      });
    }
  }
  for (const name of ownerNamesIn(file.rules)) {
    if (!fleet.activeShipNames.includes(name)) {
      differences.push({ kind: 'ship', name, ways: ['pickShip', 'dropRules'] });
    }
  }
  return { newLabels, differences };
}

function differenceText(difference: NetworkRulesDifference): string {
  switch (difference.kind) {
    case 'definer':
      return `the definer of ${difference.key}`;
    case 'values':
      return `the values of ${difference.key}`;
    case 'ship':
      return `the ship ${difference.name}`;
  }
}

function resolutionOf(difference: NetworkRulesDifference, resolutions: readonly NetworkRulesResolution[]): NetworkRulesResolution | undefined {
  return resolutions.find((resolution) => {
    if (resolution.kind !== difference.kind) {
      return false;
    }
    const isSameSubject = resolution.kind === 'ship' ? difference.kind === 'ship' && resolution.name === difference.name : difference.kind !== 'ship' && resolution.key === difference.key;
    return isSameSubject && difference.ways.some((way) => way === resolution.way);
  });
}

/** Whether a resolution drops this rule: the rules on a label, naming a value the fleet's label lacks, or naming a ship. */
function isDroppedBy(rule: FileRule, dropped: { difference: NetworkRulesDifference }): boolean {
  const { difference } = dropped;
  const terms = [...rule.from, ...rule.to];
  switch (difference.kind) {
    case 'definer':
      return terms.some((term) => isLabelTerm(term) && term.label === difference.key);
    case 'values':
      return terms.some((term) => isLabelTerm(term) && term.label === difference.key && difference.missingValues.includes(term.value));
    case 'ship':
      return terms.some((term) => !isLabelTerm(term) && term.owner === difference.name);
  }
}

/**
 * The file's rules once every difference is resolved by a way it offers,
 * the rules the person chose to drop left out; none, all-to-all, stays none.
 * A difference without such a resolution is refused, naming it: the person
 * looks at the fleet again.
 */
export function resolvedRules(
  file: NetworkRulesFile,
  resolving: { differences: readonly NetworkRulesDifference[]; resolutions: readonly NetworkRulesResolution[] },
): Result<FileRule[] | null, LabelDifferences> {
  const unresolved = resolving.differences.filter((difference) => resolutionOf(difference, resolving.resolutions) === undefined);
  if (unresolved.length > 0) {
    return refuse('LABEL_DIFFERENCES', `The fleet differs from the file, unresolved: ${unresolved.map(differenceText).join(', ')}. Check the file again and resolve every difference`);
  }
  const dropping = resolving.differences.filter((difference) => resolutionOf(difference, resolving.resolutions)?.way === 'dropRules');
  return ok(file.rules === null ? null : file.rules.filter((rule) => !dropping.some((difference) => isDroppedBy(rule, { difference }))));
}

/**
 * The rules by ids: a value by its label's value id, a label by its id, an
 * owner's ship name by the ship, `*` and `#` as they are. A name with no id
 * means the fleet changed since the check, so it is refused.
 */
export function rulesByIds(rules: readonly FileRule[], fleet: { labels: readonly Label[]; ships: ReadonlyMap<string, ShipId> }): Result<NetworkRule[], LabelDifferences> {
  const missing: string[] = [];
  const idOf = (term: FileTerm): SelectorTerm[] => {
    const id = termIdOf(term, fleet);
    if (id === undefined) {
      missing.push(isLabelTerm(term) ? `${term.label}=${term.value}` : `owner=${term.owner}`);
      return [];
    }
    return [id];
  };
  const byIds = rules.map((rule) => ({ verb: rule.verb, from: rule.from.flatMap(idOf), to: rule.to.flatMap(idOf) }));
  if (missing.length > 0) {
    return refuse('LABEL_DIFFERENCES', `The fleet changed since the check: it has nothing for ${[...new Set(missing)].join(', ')}. Check the file again`);
  }
  return ok(byIds);
}

function termIdOf(term: FileTerm, fleet: { labels: readonly Label[]; ships: ReadonlyMap<string, ShipId> }): SelectorTerm | undefined {
  if (!isLabelTerm(term)) {
    const owner = isSymbol(term.owner) ? term.owner : fleet.ships.get(term.owner);
    return owner === undefined ? undefined : { owner };
  }
  const label = fleet.labels.find((held) => held.key === term.label);
  if (isSymbol(term.value)) {
    return label === undefined ? undefined : { labelId: label.id, value: term.value };
  }
  return label?.values.find((held) => held.value === term.value)?.id;
}
