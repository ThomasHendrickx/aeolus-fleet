import { redirectTo } from '../../../lib/account-sign-in';
import { signInAsArgo } from '../../../lib/argo-sign-in';
import { pagasaeFrom } from '../../../lib/pagasae';

export const dynamic = 'force-dynamic';

/** Signs an account in as argo (accounts design, F4). A POST, so no page or link takes argo over by itself. */
export async function POST(request: Request): Promise<Response> {
  const pagasae = pagasaeFrom(process.env);
  return pagasae === undefined ? redirectTo('/sign-in') : signInAsArgo(request, { pagasae, environment: process.env });
}
