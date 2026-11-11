import { describe, expect, it } from 'vitest';

import { aGeneratedRuleFleet, declarersOfCarried } from '../../../test/support/generated-rule-fleets.js';
import { allowsReach } from './network-settings.js';
import { everyCandidateVerbsOf, isGrantedByRuleMatches, ruleMatchFilterOf, ruleMatchesOf, ruleSourcesOf, MATCHED_VERBS } from './rule-matches.js';

const GENERATED_FLEETS = 400;

describe('rule matches', () => {
  it('decide every subject and candidate of a generated fleet as the network rules do', () => {
    const mismatches: string[] = [];
    let granted = 0;
    let refused = 0;
    for (let seed = 1; seed <= GENERATED_FLEETS; seed += 1) {
      // Given a generated fleet, its rule matches derived for every active ship.
      const fleet = aGeneratedRuleFleet(seed);
      const stored = fleet.ships.flatMap((ship) => ruleMatchesOf(ship, ruleSourcesOf(fleet.inForce, declarersOfCarried(fleet, ship.labels))));
      for (const subject of fleet.subjects) {
        const carried = subject.kind === 'installation' ? [] : subject.labels;
        const rules = {
          isOpen: fleet.inForce.isOpen,
          isViewerReadOn: fleet.inForce.isViewerReadOn,
          sources: ruleSourcesOf(fleet.inForce, declarersOfCarried(fleet, carried)),
          everyCandidateVerbs: everyCandidateVerbsOf(fleet.inForce.declared),
        };
        for (const verb of MATCHED_VERBS) {
          // When the subject's filter meets each candidate's stored matches.
          const filter = ruleMatchFilterOf(rules, { subject, verb });
          for (const candidate of fleet.ships) {
            const isGranted = isGrantedByRuleMatches(filter, { candidate, matches: stored.filter((match) => match.shipId === candidate.id) });

            // Then the decision is the network rules' own, a ship reading itself included.
            const isSelf = verb === 'read' && 'id' in subject && subject.id === candidate.id;
            const isExpected = isSelf || allowsReach(fleet.inForce, { verb, sender: subject, recipient: candidate, isAnswerToSender: false });
            if (isGranted !== isExpected) {
              mismatches.push(JSON.stringify({ seed, verb, subject, candidate: candidate.id, isExpected }));
            }
            if (isExpected) {
              granted += 1;
            } else {
              refused += 1;
            }
          }
        }
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
    // The generated fleets exercise both outcomes, not one of them only.
    expect(granted).toBeGreaterThan(1000);
    expect(refused).toBeGreaterThan(1000);
  });
});
