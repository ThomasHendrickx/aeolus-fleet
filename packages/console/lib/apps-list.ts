import { appsListSchema, type AppsList } from '@aeolus-fleet/common';

import { basicAuthOf, pagasaeFrom, SHARED_SIGN_IN_COOKIE } from './pagasae';

/**
 * The apps and fleets the signed-in account may open (header design H1), read
 * by the web app's server only: pagasae's GET /api/apps, asked with the
 * console's app credentials and the shared sign-in the browser sent, never
 * cached. None without pagasae (self-hosted), without the shared sign-in
 * (argo's sign-in, the viewer) or while pagasae gives none: the header then
 * shows the console and its own fleet alone.
 */

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
}): Promise<AppsList | null> {
  const { environment, cookieHeader, fetchImplementation = fetch } = input;
  const pagasae = pagasaeFrom(environment);
  const signIn = sharedSignInOf(cookieHeader);
  if (pagasae === undefined || signIn === undefined) {
    return null;
  }
  try {
    const response = await fetchImplementation(`${pagasae.url}/api/apps`, { headers: { authorization: basicAuthOf(pagasae), 'aeolus-sign-in': signIn }, cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    const parsed = appsListSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
