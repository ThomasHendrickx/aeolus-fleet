import { describe, expect, it } from 'vitest';

import { newSetupLineOutcomeOf } from './new-setup-line-outcome';

describe('newSetupLineOutcomeOf', () => {
  it('is released when the machine was crewed and is crewed no more: the release went through before the new line failed', () => {
    expect(newSetupLineOutcomeOf({ wasCrewed: true, isCrewedNow: false })).toBe('released');
  });

  it('is unchanged when the machine is still crewed: the release itself failed', () => {
    expect(newSetupLineOutcomeOf({ wasCrewed: true, isCrewedNow: true })).toBe('unchanged');
  });

  it('is unchanged when the machine was not crewed: there was nothing to release', () => {
    expect(newSetupLineOutcomeOf({ wasCrewed: false, isCrewedNow: false })).toBe('unchanged');
    expect(newSetupLineOutcomeOf({ wasCrewed: false, isCrewedNow: undefined })).toBe('unchanged');
  });

  it('is unsure when the machine was crewed and its crew could not be read again', () => {
    expect(newSetupLineOutcomeOf({ wasCrewed: true, isCrewedNow: undefined })).toBe('unsure');
  });
});
