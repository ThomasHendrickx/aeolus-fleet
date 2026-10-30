import { TriangleAlert } from 'lucide-react';

/**
 * A crewed agent ship whose session stated no harness (aeolus-fleet#1408):
 * a small label in the attention tone, a fault in Aeolus rather than a
 * default. The warning icon and the words carry it, never colour alone.
 */
export function HarnessUnknown() {
  return (
    <span
      data-testid="harness-unknown"
      title="The session stated no harness: a fault in Aeolus"
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-tone-attention-border bg-tone-attention-bg px-1.5 text-micro font-semibold text-tone-attention-fg [&_svg]:size-3"
    >
      <TriangleAlert aria-hidden />
      Harness unknown
    </span>
  );
}
