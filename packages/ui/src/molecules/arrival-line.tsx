import { CircleCheck } from 'lucide-react';

import { classNames } from '../class-names.js';

interface ArrivalLineProps {
  appLabel: string;
  fleetName: string;
  className?: string;
}

/**
 * The page's line once another fleet opened from the Apps and fleets panel
 * (docs/design/app-navigation, section 4): "Console is open in Harbour.",
 * announced, at the top of the page.
 */
export function ArrivalLine({ appLabel, fleetName, className }: ArrivalLineProps) {
  return (
    <p role="status" data-testid="arrival-line" className={classNames('flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2.5 text-body text-foreground [&_svg]:size-(--size-icon) [&_svg]:shrink-0', className)}>
      <CircleCheck aria-hidden />
      {`${appLabel} is open in ${fleetName}.`}
    </p>
  );
}
