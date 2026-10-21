import { enterFleet } from '../../../lib/account-sign-in';
import { returnPathOf } from '../../../lib/return-path';
import { pagasaeFrom } from '../../../lib/pagasae';

export const dynamic = 'force-dynamic';

/** With the shared sign-in already there, into the fleet at once, with no sign-in step (header design, H5). */
export async function GET(request: Request): Promise<Response> {
  const pagasae = pagasaeFrom(process.env);
  if (pagasae === undefined) {
    return Response.redirect(new URL('/sign-in', request.url), 303);
  }
  return enterFleet(request, {
    pagasae,
    environment: process.env,
    returnTo: returnPathOf(new URL(request.url).searchParams.get('returnTo')),
  });
}
