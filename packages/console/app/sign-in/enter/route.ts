import { enterFleet, redirectTo } from '../../../lib/account-sign-in';
import { returnPathOf } from '../../../lib/return-path';
import { accountAppFrom } from '../../../lib/account-app';

export const dynamic = 'force-dynamic';

/** With the shared sign-in already there, into the fleet at once, with no sign-in step (header design, H5). */
export async function GET(request: Request): Promise<Response> {
  const accountApp = accountAppFrom(process.env);
  if (accountApp === undefined) {
    return redirectTo('/sign-in');
  }
  return enterFleet(request, {
    accountApp,
    environment: process.env,
    returnTo: returnPathOf(new URL(request.url).searchParams.get('returnTo')),
  });
}
