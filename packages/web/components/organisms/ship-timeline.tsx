import type { MessageId, ShipId, TimelineEntry } from '@aeolus-fleet/common';
import {
  Anchor,
  Archive,
  ArrowDownLeft,
  ArrowUpRight,
  Flag,
  KeyRound,
  LockKeyhole,
  LogIn,
  LogOut,
  MailCheck,
  MailMinus,
  MailX,
  PackageX,
  RotateCw,
  ShieldAlert,
  Undo2,
  type LucideIcon,
} from 'lucide-react';

import { classNames } from '../../lib/class-names';
import { fullDateTime, relativeTime } from '../../lib/relative-time';
import { timelineSentence, type TimelineIcon, type TimelineTone } from '../../lib/timeline-sentence';
import { Button } from '../atoms/button';
import { InlineError } from '../molecules/inline-error';
import { LoadingSkeleton } from '../molecules/loading-skeleton';
import { Sentence } from '../molecules/sentence';

/** Tile icons, named for what happened. StatusBadge's icons stay its own (docs/design/conventions.md). */
const ICONS: Record<TimelineIcon, LucideIcon> = {
  received: ArrowDownLeft,
  sent: ArrowUpRight,
  claimed: LogIn,
  released: LogOut,
  prompt: KeyRound,
  commissioned: Flag,
  acknowledged: MailCheck,
  returned: Undo2,
  undeliverable: MailX,
  secret: LockKeyhole,
  fleet: Anchor,
  password: ShieldAlert,
  retired: Archive,
  abandoned: PackageX,
  dismissed: MailMinus,
};

const TONES: Record<TimelineTone, string> = {
  waiting: 'border-tone-waiting-border bg-tone-waiting-bg text-tone-waiting-fg',
  active: 'border-tone-active-border bg-tone-active-bg text-tone-active-fg',
  ok: 'border-tone-ok-border bg-tone-ok-bg text-tone-ok-fg',
  attention: 'border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg',
  ended: 'border-tone-ended-border bg-tone-ended-bg text-tone-ended-fg',
};

const ROW = 'flex w-full gap-3 px-3.5 py-3 text-left';

interface ShipTimelineProps {
  /** The ship whose page this is: sentences speak from its point of view. */
  shipId: ShipId;
  /** Newest first. */
  entries: readonly TimelineEntry[];
  state: 'ready' | 'loading' | 'error';
  onRetry?: () => void;
  /** The time relative times are measured from. */
  now: Date;
  /** Opens the message a row is about. */
  onOpenMessage: (messageId: MessageId) => void;
}

function Row({
  entry,
  shipId,
  now,
  onOpenMessage,
}: Pick<ShipTimelineProps, 'shipId' | 'now' | 'onOpenMessage'> & { entry: TimelineEntry }) {
  const { parts, tone, icon } = timelineSentence(entry, shipId);
  const Icon = ICONS[icon];
  const at = new Date(entry.occurredAt);
  const content = (
    <>
      <span
        aria-hidden
        className={classNames(
          'flex size-7 shrink-0 items-center justify-center rounded-md border [&_svg]:size-(--size-icon-sm)',
          TONES[tone],
        )}
      >
        <Icon />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <Sentence parts={parts} className="text-body text-foreground max-sm:text-body-touch" />
        <time dateTime={entry.occurredAt} title={fullDateTime(at)} className="text-meta text-muted-foreground tabular-nums">
          {relativeTime(at, now)}
        </time>
      </span>
    </>
  );
  const { message } = entry;
  return (
    <li data-testid="ship-timeline-entry" data-type={entry.type} className="border-b border-border last:border-b-0">
      {message ? (
        <button
          type="button"
          className={classNames(ROW, 'transition-colors duration-(--duration-fast) hover:bg-accent')}
          onClick={() => {
            onOpenMessage(message.id);
          }}
        >
          {content}
        </button>
      ) : (
        <div className={ROW}>{content}</div>
      )}
    </li>
  );
}

/**
 * Every change to a ship, newest first (docs/design/png/ShipTimeline.png):
 * messages in and out, claims, releases, prompts. Each row: a tone tile with
 * its icon, one sentence with the parties as ShipName, and the time. A row
 * about a message opens it.
 */
export function ShipTimeline({ shipId, entries, state, onRetry, now, onOpenMessage }: ShipTimelineProps) {
  if (state === 'loading') {
    return <LoadingSkeleton variant="list" rows={4} label="Loading the timeline" />;
  }
  if (state === 'error') {
    return (
      <div data-testid="ship-timeline" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
        <InlineError title="Couldn’t load the timeline" description="The rest of the page is current. Try again in a moment." />
        {onRetry ? (
          <Button size="sm" icon={<RotateCw aria-hidden />} onClick={onRetry} className="self-start">
            Try again
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div data-testid="ship-timeline" className="overflow-hidden rounded-lg border border-border bg-card">
      <ol aria-label="Timeline">
        {entries.map((entry) => (
          <Row key={entry.id} entry={entry} shipId={shipId} now={now} onOpenMessage={onOpenMessage} />
        ))}
      </ol>
      {entries.length <= 1 ? (
        <p className="border-t border-border px-3.5 py-3 text-center text-meta text-muted-foreground first:border-t-0">
          Nothing else yet. Claims, releases and messages appear here as they happen.
        </p>
      ) : null}
    </div>
  );
}
