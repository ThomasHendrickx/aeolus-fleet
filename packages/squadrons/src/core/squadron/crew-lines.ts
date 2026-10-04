import type { CrewLine } from '@aeolus-fleet/common';

/**
 * A member's crew lines: the fleet's, one per harness, each with the squadron
 * id appended, so the session checks in at its flagship (docs/squadrons.md).
 */
export function withSquadronId(crewLines: readonly CrewLine[], squadronId: string): CrewLine[] {
  return crewLines.map(({ harness, line }) => ({ harness, line: `${line} ${squadronId}` }));
}
