import { ANY_LABEL_VALUE, isOwnerTerm, NETWORK_VERBS, SAME_LABEL_VALUE, type Declarer, type NetworkRule, type NetworkRulesDraftChanges, type ShipId } from '@aeolus-fleet/common';

/**
 * The ships the Network page names, by id (Thomas, 24 Oct): the owners the
 * rules name, the ships that declared rules, the ships whose reach the draft
 * changes, and the picked ship with the ships it reaches. The page reads only
 * these, never the whole fleet (decision 4 of the performance design).
 */
export function networkShipIdsOf(named: {
  rules: readonly NetworkRule[];
  declarers: readonly Declarer[];
  draftChanges?: NetworkRulesDraftChanges;
  pickedShipId?: ShipId;
  reachableShipIds?: readonly ShipId[];
}): ShipId[] {
  const owners = named.rules.flatMap((rule) =>
    [...rule.from, ...rule.to].flatMap((term) => (isOwnerTerm(term) && term.owner !== ANY_LABEL_VALUE && term.owner !== SAME_LABEL_VALUE ? [term.owner] : [])),
  );
  const declarers = named.declarers.flatMap((declarer) => (declarer.kind === 'ship' ? [declarer.shipId] : []));
  const { draftChanges } = named;
  const changed =
    draftChanges === undefined
      ? []
      : NETWORK_VERBS.flatMap((verb) => [...draftChanges[verb].gained, ...draftChanges[verb].lost]).flatMap((pair) => [pair.fromShipId, pair.toShipId]);
  const picked = named.pickedShipId === undefined ? [] : [named.pickedShipId, ...(named.reachableShipIds ?? [])];
  return [...new Set([...owners, ...declarers, ...changed, ...picked])];
}
