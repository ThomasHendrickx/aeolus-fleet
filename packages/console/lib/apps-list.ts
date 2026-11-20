import { appsListSchema, type AppsList } from '@aeolus-fleet/common';

import { basicAuthOf, accountAppFrom, SHARED_SIGN_IN_COOKIE } from './account-app';

/**
 * The apps and fleets the signed-in account may open (header design H1), read
 * by the web app's server only: the account app's GET /api/apps, asked with the
 * console's app credentials and the shared sign-in the browser sent, never
 * cached. None without the account app (self-hosted) or without the shared sign-in
 * (argo's sign-in, the viewer): the bar then shows the console and its own fleet
 * alone. Ended when the account app refuses the shared sign-in; unreachable when it
 * does not answer, fails or answers a shape the console does not know
 * (docs/design/app-navigation, section 4).
 */

/** What the account app answered for the apps list. */
export type AppsListAnswer = { kind: 'list'; list: AppsList } | { kind: 'none' } | { kind: 'ended' } | { kind: 'unreachable' };

const UNAUTHORIZED = 401;

/** The shared sign-in in a Cookie header; none when the browser sent none. */
export function sharedSignInOf(cookieHeader: string): string | undefined {
  for (const pair of cookieHeader.split(';')) {
    const [name, ...value] = pair.trim().split('=');
    if (name === SHARED_SIGN_IN_COOKIE && value.length > 0) {
      return decodeURIComponent(value.join('='));
    }
  }
  return undefined;
}

export async function appsListFor(input: {
  environment: Readonly<Record<string, string | undefined>>;
  cookieHeader: string;
  fetchImplementation?: typeof fetch;
}): Promise<AppsListAnswer> {
  const { environment, cookieHeader, fetchImplementation = fetch } = input;
  const accountApp = accountAppFrom(environment);
  const signIn = sharedSignInOf(cookieHeader);
  if (accountApp === undefined || signIn === undefined) {
    return { kind: 'none' };
  }
  try {
    const response = await fetchImplementation(`${accountApp.url}/api/apps`, { headers: { authorization: basicAuthOf(accountApp), 'aeolus-sign-in': signIn }, cache: 'no-store' });
    if (response.status === UNAUTHORIZED) {
      return { kind: 'ended' };
    }
    if (!response.ok) {
      return { kind: 'unreachable' };
    }
    const parsed = appsListSchema.safeParse(await response.json());
    return parsed.success ? { kind: 'list', list: parsed.data } : { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}

/** The list itself, or none whatever the reason: for a read that only adds what the list offers, as the palette's. */
export function listOf(answer: AppsListAnswer): AppsList | null {
  return answer.kind === 'list' ? answer.list : null;
}
