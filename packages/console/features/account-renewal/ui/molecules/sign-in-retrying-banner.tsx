import { RefreshCw } from 'lucide-react';

/** The console could not renew the account's token: it says so and goes on trying, while the page works on (accounts design, F7). */
export function SignInRetryingBanner() {
  return (
    <div role="status" data-testid="sign-in-retrying" className="flex items-start gap-2 border-b border-border bg-muted px-6 py-2.5 max-sm:px-4">
      <RefreshCw aria-hidden className="mt-0.5 size-(--size-icon) shrink-0 text-muted-foreground" />
      <p className="text-meta text-foreground">Can’t reach the sign-in service. Retrying.</p>
    </div>
  );
}
