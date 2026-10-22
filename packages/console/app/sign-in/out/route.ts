import { redirectTo, signOutAccount } from '../../../lib/account-sign-in';
import { pagasaeFrom } from '../../../lib/pagasae';

export const dynamic = 'force-dynamic';

/** Signs an account out, everywhere it signed in through pagasae. A POST, so no page or link signs anyone out by itself. */
export async function POST(request: Request): Promise<Response> {
  const pagasae = pagasaeFrom(process.env);
  return pagasae === undefined ? redirectTo('/sign-in') : signOutAccount(request, { pagasae, environment: process.env });
}
