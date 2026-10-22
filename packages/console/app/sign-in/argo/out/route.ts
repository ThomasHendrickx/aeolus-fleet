import { signOutOfArgo } from '../../../../lib/argo-sign-in';

export const dynamic = 'force-dynamic';

/** Signs out of argo, back to the account (accounts design, A7). A POST, so no page or link signs anyone out by itself. */
export function POST(request: Request): Promise<Response> {
  return signOutOfArgo(request, process.env);
}
