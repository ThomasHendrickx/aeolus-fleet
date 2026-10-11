/**
 * The console's calls to the server, ordered around Sign out. Every call the
 * session authenticates renews its cookie when it answers, so a call still on
 * its way when Sign out clears the cookie would set it again (#571). Sign out
 * therefore goes once every call on its way has answered, and a call asked
 * meanwhile waits for Sign out's answer. Once Sign out has ended the session
 * that call is never sent: it would carry no session and be refused, and the
 * page leaves for one without a session (lib/session.ts). Should Sign out
 * fail, the operator is still signed in and the call goes.
 */

/** The procedure that ends the session; the console sends it on its own (app/providers.tsx). */
const SIGN_OUT_PATH = '/console.signOut';

function urlOf(input: RequestInfo | URL): string {
  if (input instanceof Request) {
    return input.url;
  }
  return input instanceof URL ? input.href : input;
}

function isSignOut(input: RequestInfo | URL): boolean {
  return new URL(urlOf(input)).pathname.endsWith(SIGN_OUT_PATH);
}

/** A call that is never sent and never answered: the page that asked it is leaving. */
function neverSent(): Promise<Response> {
  return new Promise<Response>(() => undefined);
}

/** Settles when the call does, answered or failed: only that it is no longer on its way matters. */
function settledOf(call: Promise<unknown>): Promise<void> {
  return call.then(
    () => undefined,
    () => undefined,
  );
}

export function createSessionFetch(fetchImplementation: typeof fetch): typeof fetch {
  const onTheirWay = new Set<Promise<void>>();
  /** Sign out on its way, settling with whether it ended the session. */
  let signingOut: Promise<boolean> | undefined;

  const signOut = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const answer = Promise.all(onTheirWay).then(() => fetchImplementation(input, init));
    const hasEndedSession = answer.then(
      (response) => response.ok,
      () => false,
    );
    signingOut = hasEndedSession;
    void hasEndedSession.then(() => {
      if (signingOut === hasEndedSession) {
        signingOut = undefined;
      }
    });
    return answer;
  };

  const send = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    while (signingOut !== undefined) {
      if (await signingOut) {
        return neverSent();
      }
    }
    const answer = fetchImplementation(input, init);
    const settled = settledOf(answer);
    onTheirWay.add(settled);
    void settled.then(() => onTheirWay.delete(settled));
    return answer;
  };

  return (input, init) => (isSignOut(input) ? signOut(input, init) : send(input, init));
}
