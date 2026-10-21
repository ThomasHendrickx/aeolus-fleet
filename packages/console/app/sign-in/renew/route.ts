import { renewAccountToken, renewalResponseOf } from '../../../lib/account-sign-in';
import { pagasaeFrom } from '../../../lib/pagasae';

export const dynamic = 'force-dynamic';

/** Renews the account's token before it ends (accounts design, A3): the browser asks, the console's server gets it from pagasae. */
export async function POST(request: Request): Promise<Response> {
  const pagasae = pagasaeFrom(process.env);
  return renewalResponseOf(pagasae === undefined ? { kind: 'ended' } : await renewAccountToken(request, { pagasae, environment: process.env }));
}
