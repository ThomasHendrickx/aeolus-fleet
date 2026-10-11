import { Info } from 'lucide-react';

/**
 * The calm notice that this console session ended because the operator
 * signed in on another device: nothing went wrong (docs/design/README.md,
 * SignInForm; the muted panel of docs/design/conventions.md, "Alert tone").
 */
export function SignedInElsewhereNotice() {
  return (
    <div
      data-testid="sign-in-signed-in-elsewhere"
      className="flex gap-2.5 rounded-lg border border-border bg-muted px-3.5 py-3 text-meta text-foreground"
    >
      <Info aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0 text-muted-foreground" />
      <div role="status" className="flex flex-col gap-0.5">
        <p className="font-medium">You signed in somewhere else</p>
        <p className="text-muted-foreground">
          This session ended when you signed in on another device. Sign in again to use the console here.
        </p>
      </div>
    </div>
  );
}
