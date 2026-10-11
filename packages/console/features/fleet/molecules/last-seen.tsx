import { Signal, SignalLow, SignalMedium } from 'lucide-react';

import { classNames } from '../../../lib/class-names';
import { seenSignal, type SeenSignal } from '../lib/last-seen';
import { lastSeen } from '../../../lib/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/atoms/tooltip';

const SIGNALS: Record<SeenSignal, { Icon: typeof Signal; tone: string }> = {
  fresh: { Icon: Signal, tone: 'text-tone-ok-fg' },
  while: { Icon: SignalMedium, tone: 'text-muted-foreground' },
  long: { Icon: SignalLow, tone: 'text-tone-waiting-fg' },
};

/**
 * When the fleet last heard from a ship's session, as an icon only
 * (docs/design/png/LastSeen.png): full signal under 1 minute, medium up to 15
 * minutes, low after. The shape says it, colour only supports it. "Last seen
 * 25 s ago" is the accessible name and the desktop Tooltip. Nothing for a ship
 * without a session.
 */
export function LastSeen({ seenAt, now, testId }: { seenAt: string | null; now: Date; testId?: string }) {
  if (seenAt === null) {
    return null;
  }
  const at = new Date(seenAt);
  const signal = seenSignal(at, now);
  const { Icon, tone } = SIGNALS[signal];
  const words = lastSeen(at, now);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={words}
            data-testid={testId}
            data-signal={signal}
            className={classNames('inline-flex [&_svg]:size-(--size-icon) max-sm:[&_svg]:size-4', tone)}
          />
        }
      >
        <Icon aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{words}</TooltipContent>
    </Tooltip>
  );
}
