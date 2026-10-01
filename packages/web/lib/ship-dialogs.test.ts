import { describe, expect, it } from 'vitest';

import { abandonedLine, inFlightLine, isTypedMatch, retireButtonLabel } from './ship-dialogs';

describe('isTypedMatch', () => {
  it('matches the ship name exactly', () => {
    expect(isTypedMatch('reviewer-01', 'reviewer-01')).toBe(true);
  });

  it.each(['', 'reviewer-0', 'Reviewer-01', 'reviewer01', ' reviewer-01', 'reviewer-01 '])(
    'does not match %j: case and hyphens must match, nothing is trimmed',
    (typed) => {
      expect(isTypedMatch('reviewer-01', typed)).toBe(false);
    },
  );
});

describe('inFlightLine', () => {
  it('says nothing moves when nothing is in flight', () => {
    expect(inFlightLine(0)).toBe('Nothing is in flight, so no delivery moves.');
  });

  it('counts one in-flight delivery', () => {
    expect(inFlightLine(1)).toBe('1 in-flight delivery returns to pending. Nothing is lost.');
  });

  it('counts several in-flight deliveries', () => {
    expect(inFlightLine(3)).toBe('3 in-flight deliveries return to pending. Nothing is lost.');
  });
});

describe('retireButtonLabel', () => {
  it('says Retire ship for a clean inbox', () => {
    expect(retireButtonLabel(0)).toBe('Retire ship');
  });

  it('names the consequence when deliveries are open', () => {
    expect(retireButtonLabel(1)).toBe('Retire and abandon 1 delivery');
    expect(retireButtonLabel(3)).toBe('Retire and abandon 3 deliveries');
  });
});

describe('abandonedLine', () => {
  it('counts the deliveries a retire abandons', () => {
    expect(abandonedLine(1)).toBe('1 delivery will be abandoned');
    expect(abandonedLine(3)).toBe('3 deliveries will be abandoned');
  });
});
