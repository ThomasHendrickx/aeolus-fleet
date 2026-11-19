import { redirectTo, startSignIn } from '../../../lib/account-sign-in';
import { accountAppFrom } from '../../../lib/account-app';

export const dynamic = 'force-dynamic';

/** An account's sign-in starts at the account app (accounts design, F1); without the account app, the console's own sign-in. */
export async function GET(request: Request): Promise<Response> {
  const accountApp = accountAppFrom(process.env);
  return accountApp === undefined ? redirectTo('/sign-in') : startSignIn(request, { accountApp, environment: process.env });
}
