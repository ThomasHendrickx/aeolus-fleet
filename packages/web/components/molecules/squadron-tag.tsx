import { Shapes } from 'lucide-react';
import Link from 'next/link';

import { classNames } from '../../lib/class-names';

interface SquadronTagProps {
  squadronId: string;
  /** The member's role, after the squadron; none for the squadron itself. */
  role?: string;
  size?: 'md' | 'sm';
  className?: string;
}

/**
 * How a ship's squadron is named (docs/design/png/SquadronTag.png): the
 * squadron, and the member's role after it, linking to the squadron's page.
 * It marks membership; the member's own name is shown as is.
 */
export function SquadronTag({ squadronId, role, size = 'md', className }: SquadronTagProps) {
  return (
    <Link
      href={`/squadrons/${squadronId}`}
      data-slot="squadron-tag"
      className={classNames(
        'inline-flex max-w-full items-center gap-1 rounded-sm bg-secondary px-1.5 text-secondary-foreground hover:underline [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0',
        size === 'sm' ? 'h-5.5 text-meta' : 'h-6 text-body',
        className,
      )}
    >
      <Shapes aria-hidden />
      <span className="truncate font-medium">{squadronId}</span>
      {role !== undefined && <span className="shrink-0 text-muted-foreground">· {role}</span>}
    </Link>
  );
}
