import { accountOutputSchema, consoleSessionOutputSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import { serverInternalUrlFrom } from './server-url';

/**
 * The name of the account signed in as argo, as pagasae gives it (decisions
 * 0054, 0058), read by the web app's server only: the session's account and
 * fleet from the fleet server with the operator's cookie, then pagasae with
 * the console's token. Asked each time it is shown and never stored, so core
 * keeps no email. None for argo's own sign-in, without pagasae, or while
 * pagasae gives none: the console shows the account's id then.
 */

type Environment = Readonly<Record<string, string | undefined>>;

/** pagasae as the console reaches it, from AEOLUS_PAGASAE_URL and AEOLUS_PAGASAE_CONSOLE_TOKEN; none unless both are set. No trailing slash. */
export function pagasaeFrom(environment: Environment): { url: string; token: string } | undefined {
  const url = environment.AEOLUS_PAGASAE_URL;
  const token = environment.AEOLUS_PAGASAE_CONSOLE_TOKEN;
  if (url === undefined || url === '' || token === undefined || token === '') {
    return undefined;
  }
  return { url: url.replace(/\/+$/, ''), token };
}

const nameAnswerSchema = z.object({ name: z.string().min(1) });

/** One query of the fleet server with the operator's cookie, its data parsed. */
async function query<T>(call: { serverUrl: string; procedure: string; cookie: string; output: z.ZodType<T>; fetchImplementation: typeof fetch }): Promise<T> {
  const response = await call.fetchImplementation(`${call.serverUrl}/trpc/${call.procedure}`, { headers: { cookie: call.cookie } });
  if (!response.ok) {
    throw new Error(`${call.procedure} answered ${String(response.status)}`);
  }
  return z.object({ result: z.object({ data: call.output }) }).parse(await response.json()).result.data;
}

export async function accountNameFor(input: { environment: Environment; cookie: string; fetchImplementation?: typeof fetch }): Promise<string | null> {
  const { environment, cookie, fetchImplementation = fetch } = input;
  const pagasae = pagasaeFrom(environment);
  if (pagasae === undefined) {
    return null;
  }
  try {
    const serverUrl = serverInternalUrlFrom(environment);
    const [session, account] = await Promise.all([
      query({ serverUrl, procedure: 'console.session', cookie, output: consoleSessionOutputSchema, fetchImplementation }),
      query({ serverUrl, procedure: 'console.account', cookie, output: accountOutputSchema, fetchImplementation }),
    ]);
    const accountId = account.session.accountId ?? null;
    if (accountId === null) {
      return null;
    }
    const asked = new URL(`${pagasae.url}/api/console/account-name`);
    asked.search = new URLSearchParams({ fleetId: session.fleetId, accountId }).toString();
    const response = await fetchImplementation(asked.toString(), { headers: { 'x-aeolus-console-token': pagasae.token } });
    if (!response.ok) {
      return null;
    }
    return nameAnswerSchema.parse(await response.json()).name;
  } catch {
    return null;
  }
}
