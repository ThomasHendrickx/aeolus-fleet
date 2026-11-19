import { redirectTo } from '../../../lib/account-sign-in';
import { signInAsArgo } from '../../../lib/argo-sign-in';
import { accountAppFrom } from '../../../lib/account-app';

export const dynamic = 'force-dynamic';

/** Signs an account in as argo (accounts design, F4). A POST, so no page or link takes argo over by itself. */
export async function POST(request: Request): Promise<Response> {
  const accountApp = accountAppFrom(process.env);
  return accountApp === undefined ? redirectTo('/sign-in') : signInAsArgo(request, { accountApp, environment: process.env });
}
