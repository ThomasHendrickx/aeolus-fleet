/**
 * What a failed new setup line left behind (trierarch#260). The trierarch
 * plugin releases a crewed machine's ship first, then gets it a new starting
 * prompt; its refusal does not say which call failed. `unchanged`: nothing
 * went through and the old line still works. `released`: the release went
 * through, so the old line stopped working, but no new line came. `unsure`:
 * the machine was crewed and could not be read again.
 */
export type NewSetupLineOutcome = 'unchanged' | 'released' | 'unsure';

/** The outcome from whether the machine was crewed before asking, and is now; `isCrewedNow` is undefined when it could not be read again. */
export function newSetupLineOutcomeOf({ wasCrewed, isCrewedNow }: { wasCrewed: boolean; isCrewedNow: boolean | undefined }): NewSetupLineOutcome {
  if (!wasCrewed) {
    return 'unchanged';
  }
  if (isCrewedNow === undefined) {
    return 'unsure';
  }
  return isCrewedNow ? 'unchanged' : 'released';
}

/** A failed new setup line: the plugin's reason, and what it left behind. */
export class NewSetupLineError extends Error {
  readonly outcome: NewSetupLineOutcome;

  constructor(reason: string, outcome: NewSetupLineOutcome) {
    super(reason);
    this.name = 'NewSetupLineError';
    this.outcome = outcome;
  }
}
