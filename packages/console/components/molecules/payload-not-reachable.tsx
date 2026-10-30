import { Lock } from 'lucide-react';

/**
 * In place of a sealed payload while the company key is not reachable
 * (decision 0068, N1, scenario 25): the payload is kept and shows again once
 * the key is back. The envelope, the delivery and Done go on around it.
 */
export function PayloadNotReachable({ testId }: { testId?: string }) {
  return (
    <div role="note" data-testid={testId} className="flex gap-2 rounded-lg border border-tone-ended-border bg-tone-ended-bg p-3 text-tone-ended-fg">
      <Lock aria-hidden className="mt-0.5 size-(--size-icon) shrink-0" />
      <div className="flex flex-col gap-1">
        <p className="text-body font-medium">Sealed, key not reachable</p>
        <p className="text-meta text-foreground">The payload is kept. It shows again once your company key is reachable.</p>
      </div>
    </div>
  );
}
