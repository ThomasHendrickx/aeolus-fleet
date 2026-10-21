import { KeyRound } from 'lucide-react';

import { Button } from '@aeolus-fleet/common/header';

interface ArgoBannerProps {
  /** Ends this sign-in as argo and goes back to the account. */
  onSignOutOfArgo: () => void;
  isSigningOut: boolean;
}

/**
 * Above every console page while an account is signed in as argo
 * (accounts design, A7): it says so, since everything it does now is argo's,
 * with the way back to the account.
 */
export function ArgoBanner({ onSignOutOfArgo, isSigningOut }: ArgoBannerProps) {
  return (
    <div role="status" data-testid="argo-banner" className="flex items-center gap-2 border-b border-border bg-muted px-8 py-2.5 max-sm:px-4">
      <KeyRound aria-hidden className="size-(--size-icon) shrink-0 text-muted-foreground" />
      <p className="grow text-meta font-medium text-foreground">You are signed in as argo</p>
      <Button variant="secondary" size="xs" disabled={isSigningOut} onClick={onSignOutOfArgo}>
        Sign out of argo
      </Button>
    </div>
  );
}
