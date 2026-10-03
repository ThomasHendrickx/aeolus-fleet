import { describe, expect, it } from 'vitest';

import { abandonedLine, inFlightLine, isTypedMatch, retireButtonLabel, newCrewLineReplaced } from './ship-dialogs';

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

describe('newCrewLineReplaced', () => {
  const awaiting = { status: 'awaitingCrew', location: null, startingPrompt: null, inFlightDeliveries: 0 };

  it('says a crewed member loses its session, and what happens to its in-flight deliveries', () => {
    expect(newCrewLineReplaced({ ...awaiting, status: 'crewed', location: { kind: 'DEVICE', description: 'mac mini' }, inFlightDeliveries: 1 })).toBe(
      'Ends the session on mac mini. 1 in-flight delivery returns to pending. Nothing is lost.',
    );
  });

  it('says an unclaimed crew line stops working', () => {
    expect(newCrewLineReplaced({ ...awaiting, startingPrompt: { isClaimed: false } })).toBe('The crew line issued earlier, not claimed yet, stops working.');
  });

  it('says nothing for a member awaiting crew with no unclaimed line out', () => {
    expect(newCrewLineReplaced({ ...awaiting, startingPrompt: { isClaimed: true } })).toBeUndefined();
  });
});
