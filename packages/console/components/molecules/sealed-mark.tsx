import { Lock } from 'lucide-react';

interface SealedMarkProps {
  /** The lock with the word, beside a payload; or the lock alone, by a list row's time or line. */
  variant?: 'word' | 'icon';
  testId?: string;
}

/**
 * A payload a sealed fleet stores sealed (decision 0068, N1): rendered as
 * today and marked with a lock. The icon alone still says Sealed to a screen
 * reader and on hover.
 */
export function SealedMark({ variant = 'word', testId }: SealedMarkProps) {
  if (variant === 'icon') {
    return (
      <span role="img" aria-label="Sealed" title="Sealed" data-testid={testId} className="inline-flex shrink-0 text-muted-foreground">
        <Lock aria-hidden className="size-3.5" />
      </span>
    );
  }
  return (
    <span data-testid={testId} className="inline-flex shrink-0 items-center gap-1 text-meta text-muted-foreground">
      <Lock aria-hidden className="size-3.5" />
      Sealed
    </span>
  );
}
