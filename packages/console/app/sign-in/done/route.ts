import { finishSignIn } from '../../../lib/account-sign-in';
import { pagasaeFrom } from '../../../lib/pagasae';

export const dynamic = 'force-dynamic';

/** Back from pagasae's sign-in with a code: the account enters the fleet (accounts design, F1). */
export async function GET(request: Request): Promise<Response> {
  const pagasae = pagasaeFrom(process.env);
  return pagasae === undefined ? Response.redirect(new URL('/sign-in', request.url), 303) : finishSignIn(request, { pagasae, environment: process.env });
}
