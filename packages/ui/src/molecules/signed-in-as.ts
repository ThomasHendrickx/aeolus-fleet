/** How someone is signed in here (H10). */
export type SignedInAs = 'argo' | 'account' | 'viewer';

const SIGNED_IN_AS_LABELS: Record<SignedInAs, string> = { argo: 'Signed in as argo', account: 'Signed in as your account', viewer: 'Viewer' };

/** The avatar menu's line for how someone is signed in here. */
export function signedInAsOf(signedInAs: SignedInAs): string {
  return SIGNED_IN_AS_LABELS[signedInAs];
}
