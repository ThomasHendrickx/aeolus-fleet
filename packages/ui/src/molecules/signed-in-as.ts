/** How someone is signed in here (H10). */
export type SignedInAs = 'argo' | 'account' | 'viewer';

const SIGNED_IN_AS_LABELS: Record<SignedInAs, string> = { argo: 'Signed in as argo', account: 'Signed in as your account', viewer: 'Viewer' };

/** The avatar menu's line for how someone is signed in here. */
export function signedInAsOf(signedInAs: SignedInAs): string {
  return SIGNED_IN_AS_LABELS[signedInAs];
}

const ACCOUNT_BUTTON_WORDS: Record<SignedInAs, string> = { argo: 'Signed in as argo', account: 'Your account', viewer: 'Viewer' };

/** What the account button at the end of the bar says (docs/design/app-navigation, section 4). */
export function accountButtonWordsOf(signedInAs: SignedInAs, isSignInExpired: boolean): string {
  return isSignInExpired ? 'Sign-in expired' : ACCOUNT_BUTTON_WORDS[signedInAs];
}

/** The account panel's line under who is signed in; `signedInFor` names where argo's or the viewer's sign-in holds ("Console in Aeolus"). */
export function howSignedInOf(signedInAs: SignedInAs, signedInFor: string | undefined): string {
  const place = signedInFor === undefined ? '' : `, for ${signedInFor}`;
  const words: Record<SignedInAs, string> = { account: 'Signed in with your account', argo: `Signed in as argo${place}`, viewer: `Viewer sign-in${place}` };
  return words[signedInAs];
}
