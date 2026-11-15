import type { AppsList } from '@aeolus-fleet/common';
import { cookies } from 'next/headers';

import { appsListFor, sharedSignInOf } from './apps-list';
import type { PluginAnswer } from './plugin-answer';

/**
 * How long the web app's server hands the list the header's read took on to
 * the palette's read of the same page load: the palette asks only once the
 * header holds the list, so a page load asks pagasae once (#1117).
 */
const HANDED_ON_MS = 30 * 1000;

/** The last list read per shared sign-in, by the header's read, held only to hand it on. */
const lastRead = new Map<string, { list: AppsList | null; readAt: number }>();

function keep({ signIn, list, now }: { signIn: string | undefined; list: AppsList | null; now: number }): void {
  for (const [key, held] of lastRead) {
    if (now - held.readAt >= HANDED_ON_MS) {
      lastRead.delete(key);
    }
  }
  if (signIn !== undefined) {
    lastRead.set(signIn, { list, readAt: now });
  }
}

/** The console read of the apps and fleets the signed-in account may open (lib/apps-list.ts), with the cookies the browser sent: none while pagasae gives none. Always asked anew. */
export async function readAppsList(): Promise<PluginAnswer<AppsList | null>> {
  const cookieHeader = (await cookies()).toString();
  const list = await appsListFor({ environment: process.env, cookieHeader });
  keep({ signIn: sharedSignInOf(cookieHeader), list, now: Date.now() });
  return { kind: 'answered', data: list };
}

/**
 * The apps list for a read that follows the header's on the same page load,
 * such as the palette's: the list the header's read just took for this
 * sign-in, or asked anew when there is none.
 */
export async function appsListOfThisPageLoad(): Promise<AppsList | null> {
  const cookieHeader = (await cookies()).toString();
  const signIn = sharedSignInOf(cookieHeader);
  const now = Date.now();
  const held = signIn === undefined ? undefined : lastRead.get(signIn);
  if (held !== undefined && now - held.readAt < HANDED_ON_MS) {
    return held.list;
  }
  const list = await appsListFor({ environment: process.env, cookieHeader });
  keep({ signIn, list, now });
  return list;
}
