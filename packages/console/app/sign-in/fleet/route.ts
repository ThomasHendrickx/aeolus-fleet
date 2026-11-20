import { openFleet } from '../../../lib/account-sign-in';
import { accountAppFrom } from '../../../lib/account-app';

export const dynamic = 'force-dynamic';

/** Opens another fleet from the Apps and fleets panel, in place (docs/design/app-navigation, section 4). A POST, so no page or link switches by itself. */
export async function POST(request: Request): Promise<Response> {
  const accountApp = accountAppFrom(process.env);
  return accountApp === undefined
    ? Response.json({ outcome: 'failed' }, { headers: { 'cache-control': 'no-store' } })
    : openFleet(request, { accountApp, environment: process.env });
}
