import { redirectTo, signOutAccount } from '../../../lib/account-sign-in';
import { accountAppFrom } from '../../../lib/account-app';

export const dynamic = 'force-dynamic';

/** Signs an account out, everywhere it signed in through the account app. A POST, so no page or link signs anyone out by itself. */
export async function POST(request: Request): Promise<Response> {
  const accountApp = accountAppFrom(process.env);
  return accountApp === undefined ? redirectTo('/sign-in') : signOutAccount(request, { accountApp, environment: process.env });
}
