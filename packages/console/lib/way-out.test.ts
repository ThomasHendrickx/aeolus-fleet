import { describe, expect, it } from 'vitest';

import { createWayOut } from './way-out';

/** The console's calls as the way out sees them: whether they may go, and whether what it loaded is forgotten. */
function aConsole(): { isOnline: () => boolean; hasForgotten: () => boolean; calls: { setOnline: (isOnline: boolean) => void; forget: () => void } } {
  let isOnline = true;
  let hasForgotten = false;
  return {
    isOnline: () => isOnline,
    hasForgotten: () => hasForgotten,
    calls: {
      setOnline: (next) => {
        isOnline = next;
      },
      forget: () => {
        hasForgotten = true;
      },
    },
  };
}

describe('the way out of a page', () => {
  it('holds every call from the moment it starts', () => {
    const theConsole = aConsole();
    const wayOut = createWayOut(theConsole.calls);

    wayOut.holdCalls();

    expect(theConsole.isOnline()).toBe(false);
  });

  it('holds calls until the page itself goes, however many parts of the page started it', () => {
    const theConsole = aConsole();
    const wayOut = createWayOut(theConsole.calls);

    wayOut.holdCalls();
    wayOut.holdCalls();

    expect(theConsole.isOnline()).toBe(false);
    expect(theConsole.hasForgotten()).toBe(false);
  });

  it('forgets what the console loaded and lets calls go once the page has gone', () => {
    const theConsole = aConsole();
    const wayOut = createWayOut(theConsole.calls);
    wayOut.holdCalls();

    wayOut.pageGoes();

    expect(theConsole.hasForgotten()).toBe(true);
    expect(theConsole.isOnline()).toBe(true);
  });

  it('lets the held calls go, forgetting nothing, when Sign out fails', () => {
    const theConsole = aConsole();
    const wayOut = createWayOut(theConsole.calls);
    wayOut.holdCalls();

    wayOut.letCallsGo();

    expect(theConsole.isOnline()).toBe(true);
    expect(theConsole.hasForgotten()).toBe(false);
  });

  it('forgets nothing when a page goes without a way out', () => {
    const theConsole = aConsole();
    const wayOut = createWayOut(theConsole.calls);

    wayOut.pageGoes();

    expect(theConsole.hasForgotten()).toBe(false);
    expect(theConsole.isOnline()).toBe(true);
  });

  it('forgets nothing when the page goes after Sign out failed', () => {
    const theConsole = aConsole();
    const wayOut = createWayOut(theConsole.calls);
    wayOut.holdCalls();
    wayOut.letCallsGo();

    wayOut.pageGoes();

    expect(theConsole.hasForgotten()).toBe(false);
  });
});
