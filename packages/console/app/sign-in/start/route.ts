import { startSignIn } from '../../../lib/account-sign-in';
import { pagasaeFrom } from '../../../lib/pagasae';

export const dynamic = 'force-dynamic';

/** An account's sign-in starts at pagasae (accounts design, F1); without pagasae, the console's own sign-in. */
export async function GET(request: Request): Promise<Response> {
  const pagasae = pagasaeFrom(process.env);
  return pagasae === undefined ? Response.redirect(new URL('/sign-in', request.url), 303) : startSignIn(request, pagasae);
}
