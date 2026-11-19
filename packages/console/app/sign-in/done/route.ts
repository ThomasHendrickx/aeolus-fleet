import { finishSignIn, redirectTo } from '../../../lib/account-sign-in';
import { accountAppFrom } from '../../../lib/account-app';

export const dynamic = 'force-dynamic';

/** Back from the account app's sign-in with a code: the account enters the fleet (accounts design, F1). */
export async function GET(request: Request): Promise<Response> {
  const accountApp = accountAppFrom(process.env);
  return accountApp === undefined ? redirectTo('/sign-in') : finishSignIn(request, { accountApp, environment: process.env });
}
