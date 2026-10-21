import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@aeolus-fleet/common/header';
import { AuthCard } from '../../../../features/sign-in/organisms/auth-card';
import { argoHolderOf, CONFIRMED_FIELD, type ArgoHolder } from '../../../../lib/argo-sign-in';
import { pagasaeFrom } from '../../../../lib/pagasae';

export const dynamic = 'force-dynamic';

/** The warning: whom signing in as argo signs out of argo. */
function warningOf(holder: Exclude<ArgoHolder, { kind: 'none' }>): string {
  return holder.kind === 'account' ? `This signs ${holder.name} out of argo.` : 'This signs out whoever is signed in as argo now.';
}

/**
 * Before an account takes argo over from someone signed in as argo (accounts
 * design, F4, A7): it says whom that signs out, with Continue and Cancel.
 */
export default async function ArgoConfirmPage() {
  const pagasae = pagasaeFrom(process.env);
  if (pagasae === undefined) {
    redirect('/sign-in');
  }
  const holder = await argoHolderOf((await cookies()).toString(), { pagasae, environment: process.env });
  return (
    <AuthCard recovery={null}>
      <form method="post" action="/sign-in/argo" className="flex flex-col gap-4" data-testid="sign-in-argo-confirm">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-section font-semibold">Sign in as argo</h1>
          {holder.kind === 'none' ? null : <p className="text-body text-muted-foreground">{warningOf(holder)}</p>}
        </div>
        <input type="hidden" name={CONFIRMED_FIELD} value="yes" />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" data-testid="sign-in-argo-continue">
            Continue
          </Button>
          <Button variant="secondary" nativeButton={false} render={<Link href="/" />} data-testid="sign-in-argo-cancel">
            Cancel
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
