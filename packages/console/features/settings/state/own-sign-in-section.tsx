'use client';

import { LoadingSkeleton } from '../../../components/molecules/loading-skeleton';
import { useOwnSignIn } from '../hooks/use-own-sign-in';
import { OwnSignIn } from '../ui/organisms/own-sign-in';

/** Settings, Sign-in: argo's own email and password, once the account is read. */
export function OwnSignInSection() {
  const { email, ...ownSignIn } = useOwnSignIn();
  if (email === undefined) {
    return <LoadingSkeleton variant="detail" rows={3} label="Loading the sign-in" />;
  }
  return <OwnSignIn email={email} {...ownSignIn} />;
}
