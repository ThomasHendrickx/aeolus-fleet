'use client';

import { useAccountRenewal } from '../hooks/use-account-renewal';
import { SignInRetryingBanner } from '../ui/molecules/sign-in-retrying-banner';

/** Renews an account's token while the console is open, and says when pagasae does not answer. */
export function AccountRenewal() {
  const { isRetrying } = useAccountRenewal();
  return isRetrying ? <SignInRetryingBanner /> : null;
}
