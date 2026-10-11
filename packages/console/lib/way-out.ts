/**
 * The way out of a page whose session has ended, or is ending, for one
 * without a session. While the console holds its calls it asks nothing: a
 * call asked then would race Sign out, or carry no session (#584, #611).
 * There is one way out per console, not one per part of the page that starts
 * it: a part that goes while the page still shows (a read in a closing
 * dialog) must not let calls go (#618). Only the page going ends it: the
 * console then forgets what it loaded, since forgetting while the page still
 * shows asks every read again, and the next page asks as usual.
 */

/** What the way out does to the console's calls: TanStack Query holds every call while it counts as offline. */
export interface ConsoleCalls {
  setOnline: (isOnline: boolean) => void;
  forget: () => void;
}

export interface WayOut {
  holdCalls: () => void;
  /** Sign out failed: the operator is still signed in, so the held calls go. */
  letCallsGo: () => void;
  pageGoes: () => void;
}

export function createWayOut(calls: ConsoleCalls): WayOut {
  let isHolding = false;
  return {
    holdCalls: () => {
      isHolding = true;
      calls.setOnline(false);
    },
    letCallsGo: () => {
      isHolding = false;
      calls.setOnline(true);
    },
    pageGoes: () => {
      if (!isHolding) {
        return;
      }
      isHolding = false;
      calls.forget();
      calls.setOnline(true);
    },
  };
}
