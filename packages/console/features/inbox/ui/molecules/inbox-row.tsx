import type { DeliveryId } from '@aeolus-fleet/common';
import { CircleCheck, CircleDashed, CircleSlash, Replace } from 'lucide-react';

import { classNames } from '../../../../lib/class-names';
import type { InboxEntry } from '../../../../lib/inbox-entry';
import { clockTime, duration, fullDateTime, shortDateTime } from '../../../../lib/relative-time';
import { Badge } from '../../../../components/atoms/badge';

const DAY_MS = 24 * 60 * 60 * 1_000;

/** "14:30" today, "28 Sep, 14:30" before. */
function listTime(at: Date, now: Date): string {
  return now.getTime() - at.getTime() < DAY_MS ? clockTime(at) : shortDateTime(at);
}

/** Unread while open and never opened; a question stays unread-looking until answered or opened. */
function isUnread(entry: InboxEntry): boolean {
  return entry.readAt === null && entry.state !== 'acknowledged';
}

function QuestionLine({ entry, now }: { entry: Extract<InboxEntry, { kind: 'question' }>; now: Date }) {
  const { question, stale } = entry;
  const pick = question.options.find(({ key }) => key === question.pick.option);
  if (question.answer !== null) {
    const answered = question.options.find(({ key }) => key === question.answer?.option);
    return (
      <span data-answered className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0">
        <CircleCheck aria-hidden />
        <span className="truncate">{answered === undefined ? 'Answered with a note' : `Answered: ${String(answered.key)}. ${answered.label}`}</span>
      </span>
    );
  }
  if (stale !== null) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0">
        {stale.kind === 'withdrawn' ? <CircleSlash aria-hidden /> : <Replace aria-hidden />}
        <span className="truncate">{stale.kind === 'withdrawn' ? 'Withdrawn' : 'Replaced'}</span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground max-sm:text-body [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0">
      {/* A check would read as answered (#870): the pick is only a suggestion until argo answers. */}
      <CircleDashed aria-hidden />
      <span className="min-w-0 truncate">
        Not answered, {entry.sender.name}’s pick: <span className="font-medium text-foreground">{pick === undefined ? String(question.pick.option) : `${String(pick.key)}. ${pick.label}`}</span>
      </span>
      <Badge variant="outline" className="ml-auto shrink-0 tabular-nums" data-testid="inbox-row-waiting">
        {duration(new Date(entry.sentAt), now)}
      </Badge>
    </span>
  );
}

interface InboxRowProps {
  entry: InboxEntry;
  isSelected: boolean;
  onSelect: (deliveryId: DeliveryId) => void;
  now: Date;
  /** Inside the unfolded plugin-ship group: indented. */
  isNested?: boolean;
}

/**
 * One row of argo's inbox (#849): the ship by name (no id suffix), the time,
 * and the headline in two lines. A question adds the asker's pick and how
 * long it has waited, or how it ended; a message one muted line of its body.
 * The dot and the weight say unread.
 */
export function InboxRow({ entry, isSelected, onSelect, now, isNested = false }: InboxRowProps) {
  const sentAt = new Date(entry.sentAt);
  const isUnreadRow = isUnread(entry);
  const headline = entry.kind === 'question' ? entry.question.title : entry.text.headline;
  return (
    <li>
      <button
        type="button"
        data-testid={entry.kind === 'question' ? 'inbox-question-row' : 'inbox-row'}
        data-delivery-id={entry.deliveryId}
        aria-current={isSelected ? 'true' : undefined}
        onClick={() => {
          onSelect(entry.deliveryId);
        }}
        className={classNames(
          'relative flex w-full min-w-0 flex-col gap-1 border-b border-border py-3 pr-4 pl-7 text-left transition-colors duration-(--duration-fast) outline-none hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=true]:bg-accent max-sm:py-3.5',
          isNested ? 'pl-10' : undefined,
        )}
      >
        {isUnreadRow ? <span aria-hidden className={classNames('absolute top-[1.15rem] size-2 rounded-full bg-primary', isNested ? 'left-5' : 'left-2.5')} /> : null}
        <span className="flex min-w-0 items-baseline gap-2">
          <span className={classNames('min-w-0 truncate text-meta text-foreground max-sm:text-body', isUnreadRow ? 'font-medium' : 'text-muted-foreground')}>{entry.sender.name}</span>
          <time dateTime={entry.sentAt} title={fullDateTime(sentAt)} className="ml-auto shrink-0 text-meta text-muted-foreground tabular-nums">
            {listTime(sentAt, now)}
          </time>
        </span>
        <span
          className={classNames(
            'line-clamp-2 text-body text-foreground [overflow-wrap:anywhere] max-sm:text-body-touch',
            isUnreadRow ? 'font-semibold' : 'font-medium',
            entry.kind === 'question' && entry.stale !== null ? 'text-muted-foreground line-through' : undefined,
          )}
        >
          {headline === '' ? 'No text' : headline}
        </span>
        {entry.kind === 'question' ? (
          <QuestionLine entry={entry} now={now} />
        ) : entry.text.summary === '' ? null : (
          <span className="truncate text-meta text-muted-foreground max-sm:text-body">{entry.text.summary}</span>
        )}
        {isUnreadRow ? <span className="sr-only">Unread</span> : null}
      </button>
    </li>
  );
}
