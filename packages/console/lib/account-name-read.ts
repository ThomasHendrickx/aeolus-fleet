import { cookies } from 'next/headers';

import { accountNameFor } from './account-name';
import type { PluginAnswer } from './plugin-answer';
import { sessionCookieOf } from './plugin-call';

/** The console read of the signed-in account's name (lib/account-name.ts), with the operator's session cookie: none while pagasae gives none. */
export async function readAccountName(): Promise<PluginAnswer<string | null>> {
  const cookie = sessionCookieOf((await cookies()).toString());
  return { kind: 'answered', data: await accountNameFor({ environment: process.env, cookie }) };
}
