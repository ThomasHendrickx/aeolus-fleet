import { accountOutputSchema, consoleSessionOutputSchema, type AccountId } from '@aeolus-fleet/common';
import { z } from 'zod';

import { serverInternalUrlFrom } from './server-url';

/**
 * Accounts by the name pagasae gives them (decisions 0054, 0058), read by the
 * web app's server only: the session's fleet (and, for the menu, its account)
 * from the fleet server with the operator's cookie, then pagasae with the
 * console's token. Asked each time they are shown and never stored, so core
 * keeps no email. Deleted user for an account pagasae deleted for good (410).
 * None for argo's own sign-in, without pagasae, or while pagasae gives none:
 * the console shows the account's id then.
 */

/** What the console names an account pagasae deleted for good, which has no name any more. */
export const DELETED_USER = 'Deleted user';

/** pagasae's answer for an account it deleted for good. */
const DELETED_STATUS = 410;

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

/** The name pagasae gives one account of the fleet, Deleted user for one it deleted; none when it gives none. */
async function askPagasae(call: { pagasae: { url: string; token: string }; fleetId: string; accountId: string; fetchImplementation: typeof fetch }): Promise<string | null> {
  const asked = new URL(`${call.pagasae.url}/api/console/account-name`);
  asked.search = new URLSearchParams({ fleetId: call.fleetId, accountId: call.accountId }).toString();
  try {
    const response = await call.fetchImplementation(asked.toString(), { headers: { 'x-aeolus-console-token': call.pagasae.token } });
    if (response.status === DELETED_STATUS) {
      return DELETED_USER;
    }
    if (!response.ok) {
      return null;
    }
    return nameAnswerSchema.parse(await response.json()).name;
  } catch {
    return null;
  }
}

/** The name of the account signed in as argo in this console session. */
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
    return await askPagasae({ pagasae, fleetId: session.fleetId, accountId, fetchImplementation });
  } catch {
    return null;
  }
}

/**
 * The names of these accounts of the session's fleet, such as those an
 * event names as signed in as argo, each asked once: only those pagasae
 * names, so the rest show by their id.
 */
export async function accountNamesFor(input: {
  environment: Environment;
  cookie: string;
  accountIds: readonly AccountId[];
  fetchImplementation?: typeof fetch;
}): Promise<Partial<Record<AccountId, string>>> {
  const { environment, cookie, accountIds, fetchImplementation = fetch } = input;
  const pagasae = pagasaeFrom(environment);
  if (pagasae === undefined || accountIds.length === 0) {
    return {};
  }
  try {
    const session = await query({ serverUrl: serverInternalUrlFrom(environment), procedure: 'console.session', cookie, output: consoleSessionOutputSchema, fetchImplementation });
    const named = await Promise.all(
      [...new Set(accountIds)].map(async (accountId) => ({ accountId, name: await askPagasae({ pagasae, fleetId: session.fleetId, accountId, fetchImplementation }) })),
    );
    return Object.fromEntries(named.flatMap(({ accountId, name }) => (name === null ? [] : [[accountId, name]])));
  } catch {
    return {};
  }
}
