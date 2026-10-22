import { CircleAlert } from 'lucide-react';

/**
 * The error that sign-in cannot work here: the page is not a secure context,
 * so the browser drops the Secure session cookie and the password travels in
 * clear text (the attention tone of docs/design/conventions.md, "Alert tone").
 */
export function InsecureContextNotice() {
  return (
    <div
      data-testid="sign-in-insecure-context"
      className="flex gap-2.5 rounded-lg border border-tone-attention-border bg-tone-attention-bg px-3.5 py-3 text-meta text-tone-attention-fg"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0" />
      <div className="flex flex-col gap-0.5">
        <p role="alert" className="font-medium">
          Sign-in needs https
        </p>
        <p>
          This page is plain http, so the browser drops the session cookie and your password travels in clear text. Open the
          console over https, or on localhost.
        </p>
      </div>
    </div>
  );
}
