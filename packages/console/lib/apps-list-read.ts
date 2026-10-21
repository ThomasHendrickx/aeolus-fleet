import type { AppsList } from '@aeolus-fleet/common';
import { cookies } from 'next/headers';

import { appsListFor } from './apps-list';
import type { PluginAnswer } from './plugin-answer';

/** The console read of the apps and fleets the signed-in account may open (lib/apps-list.ts), with the cookies the browser sent: none while pagasae gives none. */
export async function readAppsList(): Promise<PluginAnswer<AppsList | null>> {
  return { kind: 'answered', data: await appsListFor({ environment: process.env, cookieHeader: (await cookies()).toString() }) };
}
