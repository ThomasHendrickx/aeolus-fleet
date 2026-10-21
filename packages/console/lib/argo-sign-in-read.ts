import { cookies } from 'next/headers';

import { isArgoAllowed } from './argo-sign-in';
import { pagasaeFrom } from './pagasae';
import type { PluginAnswer } from './plugin-answer';

/** The console read of whether the account may sign in as argo of the fleet (lib/argo-sign-in.ts), for the avatar menu: never without pagasae. */
export async function readArgoAllowed(): Promise<PluginAnswer<boolean>> {
  const pagasae = pagasaeFrom(process.env);
  return { kind: 'answered', data: pagasae !== undefined && (await isArgoAllowed(pagasae, (await cookies()).toString())) };
}
