import {
  AlarmClock,
  Bot,
  CircleQuestionMark,
  Clock,
  Eye,
  HeartCrack,
  Loader,
  Monitor,
  Radio,
  RotateCcw,
  Server,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';

import { classNames } from '../../../lib/class-names';
import type { DeliveryStepState } from '../lib/delivery-history';
import type { WayIcon, WayLine, WayTone } from '../lib/message-way';
import { StatusBadge } from '../../../components/molecules/status-badge';

const ICONS: Record<WayIcon, LucideIcon> = {
  fleet: Server,
  computer: Monitor,
  watcher: Eye,
  agent: Bot,
  time: Clock,
  clock: AlarmClock,
  busy: Loader,
  restart: RotateCcw,
  silent: WifiOff,
  died: HeartCrack,
  ping: Radio,
  unknown: CircleQuestionMark,
};

const TONES: Record<WayTone, string> = {
  neutral: 'text-muted-foreground',
  waiting: 'text-tone-waiting-fg',
  active: 'text-tone-active-fg',
  attention: 'text-tone-attention-fg',
};

/**
 * Where a message stands on its way (#756): its StatusBadge, then short
 * lines, each an icon and a few words in its tone: who holds it and since
 * when, then what the clocks and the session's side say. Status never by
 * colour alone: every line carries its words.
 */
export function WayLines({ status, lines }: { status: DeliveryStepState; lines: readonly WayLine[] }) {
  return (
    <div data-testid="message-way" className="flex flex-col gap-1.5">
      <div>
        <StatusBadge status={status} />
      </div>
      <ul aria-label="Where it stands" className="flex flex-col gap-1">
        {lines.map((line) => {
          const Icon = ICONS[line.icon];
          return (
            <li key={line.text} data-testid="message-way-line" className={classNames('flex items-center gap-1.5 text-meta max-sm:text-body-touch', TONES[line.tone])}>
              <Icon aria-hidden className="size-3.5 shrink-0" />
              <span>{line.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
