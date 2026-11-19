import { renewAccountToken, renewalResponseOf } from '../../../lib/account-sign-in';
import { accountAppFrom } from '../../../lib/account-app';

export const dynamic = 'force-dynamic';

/** Renews the account's token before it ends (accounts design, A3): the browser asks, the console's server gets it from the account app. */
export async function POST(request: Request): Promise<Response> {
  const accountApp = accountAppFrom(process.env);
  return renewalResponseOf(accountApp === undefined ? { kind: 'ended' } : await renewAccountToken(request, { accountApp, environment: process.env }));
}
