/**
 * How a writer keeps rule matches (design rule-matches.md, #1741): in its own
 * unit of work, after the authoritative change, while holding the network
 * settings lock, shared for a writer of carried values or owners, exclusively
 * for a writer of rules. Units of work read committed, so whichever of two
 * concurrent writers takes the lock second recomputes from the other's
 * committed change: no write skew between a rule change and a label change.
 */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { DeclaredNetworkRulesRepository, MatchedShipsOf, NetworkSettingsRepository, RuleMatchRepository } from './ports.js';
import { ruleMatchesOf, ruleSourcesOf, type RuleSource } from './rule-matches.js';
import type { NetworkRule } from './network-settings.js';

export interface KeepRuleMatchesTx {
  networkSettings: Pick<NetworkSettingsRepository, 'findForShare'>;
  declaredNetworkRules: Pick<DeclaredNetworkRulesRepository, 'find' | 'listBy'>;
  ruleMatches: Pick<RuleMatchRepository, 'matchedShips' | 'replaceOfShips' | 'replaceOfSource'>;
}

/** Every row of these ships recomputed from every source concerned; a retired one keeps none. */
export async function keepRuleMatchesOfShips(tx: KeepRuleMatchesTx, change: { fleetId: FleetId; shipIds: readonly ShipId[] }): Promise<void> {
  const { fleetId, shipIds } = change;
  if (shipIds.length === 0) {
    return;
  }
  await keepRuleMatchesOf(tx, { fleetId, of: { kind: 'ships', shipIds }, replacedShipIds: shipIds });
}

/** Every ship's rows recomputed from every source: a fleet's build, and its consistency reference. */
export async function keepEveryRuleMatch(tx: KeepRuleMatchesTx & { ruleMatches: Pick<RuleMatchRepository, 'list'> }, fleetId: FleetId): Promise<void> {
  const replacedShipIds = [...new Set((await tx.ruleMatches.list(fleetId)).map(({ shipId }) => shipId))];
  await keepRuleMatchesOf(tx, { fleetId, of: { kind: 'fleet' }, replacedShipIds });
}

async function keepRuleMatchesOf(tx: KeepRuleMatchesTx, change: { fleetId: FleetId; of: MatchedShipsOf; replacedShipIds: readonly ShipId[] }): Promise<void> {
  const { fleetId } = change;
  const settings = await tx.networkSettings.findForShare(fleetId);
  const matched = await tx.ruleMatches.matchedShips(fleetId, change.of);
  const declarers = [...new Set(matched.flatMap(({ declarers: carried }) => carried))];
  const installation = await tx.declaredNetworkRules.find(fleetId, { kind: 'installation' });
  const declared = [...(await tx.declaredNetworkRules.listBy(fleetId, declarers)), ...(installation === undefined ? [] : [installation])];
  const inForce = { rules: settings.rules ?? [], declared };
  const matches = matched.flatMap(({ ship, declarers: carried }) => ruleMatchesOf(ship, ruleSourcesOf(inForce, new Set(carried))));
  const shipIds = [...new Set([...change.replacedShipIds, ...matched.map(({ ship }) => ship.id)])];
  await tx.ruleMatches.replaceOfShips(fleetId, { shipIds, matches });
}

/**
 * One source's rows recomputed across the fleet from its rules as they are
 * now: the fleet's own over every active ship, a declarer's over the carriers
 * of its labels, none when it holds no rules.
 */
export async function keepRuleMatchesOfSource(tx: KeepRuleMatchesTx, change: { fleetId: FleetId; source: RuleSource; rules: readonly NetworkRule[] }): Promise<void> {
  const { fleetId, source, rules } = change;
  await tx.networkSettings.findForShare(fleetId);
  const hasTo = rules.some((rule) => rule.to.length > 0);
  const matched = hasTo ? await tx.ruleMatches.matchedShips(fleetId, source.kind === 'fleet' ? { kind: 'fleet' } : { kind: 'carriers', owner: source }) : [];
  const matches = matched.flatMap(({ ship }) => ruleMatchesOf(ship, [{ source, rules }]));
  await tx.ruleMatches.replaceOfSource(fleetId, { source, matches });
}
