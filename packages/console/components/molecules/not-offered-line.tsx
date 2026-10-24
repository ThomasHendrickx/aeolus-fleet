import { TriangleAlert } from 'lucide-react';

import { harnessWord } from '../../lib/harness';
import { NOT_OFFERED_CLEARS } from '../../lib/machines';

interface NotOfferedLineProps {
  harness: string;
  reason: string;
}

/**
 * A harness its computer's trierarch cannot serve (#1215), for the Trierarchs
 * page and Health: the harness, why, and that it clears itself. The warning
 * icon and the words carry it, never colour alone.
 */
export function NotOfferedLine({ harness, reason }: NotOfferedLineProps) {
  return (
    <p data-testid="not-offered" className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-meta text-tone-attention-fg [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0 [&_svg]:self-center">
      <TriangleAlert aria-hidden />
      <span className="font-medium">{harnessWord(harness)} not offered</span>
      <span>{reason}.</span>
      <span className="text-muted-foreground">{NOT_OFFERED_CLEARS}</span>
    </p>
  );
}
