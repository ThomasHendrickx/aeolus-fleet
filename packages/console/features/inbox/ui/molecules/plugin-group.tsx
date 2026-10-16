import type { DeliveryId } from '@aeolus-fleet/common';
import { Check, ChevronDown, Server } from 'lucide-react';

import { classNames } from '../../../../lib/class-names';
import type { MessageEntry } from '../../../../lib/inbox-entry';
import { clockTime, fullDateTime } from '../../../../lib/relative-time';
import { counted } from '../../../../lib/sentence';
import { Button } from '../../../../components/atoms/button';
import { InboxRow } from './inbox-row';

interface PluginGroupProps {
  /** Newest first. */
  messages: readonly MessageEntry[];
  isExpanded: boolean;
  onToggle: () => void;
  selectedId: DeliveryId | undefined;
  onSelect: (deliveryId: DeliveryId) => void;
  /** Marks each open message of the group done; none where nothing can be marked done. */
  onDoneAll?: () => void;
  isPending?: boolean;
  now: Date;
}

/**
 * The messages of plugin ships (a trierarch, squadrons, the trierarch or
 * networking plugin) folded into one row (#849): who sent them, the newest
 * time, how many, and their headlines in a muted line. Unfolded, each is a
 * row of its own, and Done marks every open one done.
 */
export function PluginGroup({ messages, isExpanded, onToggle, selectedId, onSelect, onDoneAll, isPending = false, now }: PluginGroupProps) {
  const [newest] = messages;
  if (newest === undefined) {
    return null;
  }
  const senders = [...new Set(messages.map(({ sender }) => sender.name))].join(', ');
  const sentAt = new Date(newest.sentAt);
  return (
    <li data-testid="inbox-plugin-group">
      <div className="flex items-stretch border-b border-border">
        <button
          type="button"
          aria-expanded={isExpanded}
          data-testid="inbox-plugin-group-toggle"
          onClick={onToggle}
          className="flex min-w-0 grow items-start gap-2 py-3 pr-2 pl-7 text-left transition-colors duration-(--duration-fast) outline-none hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <span className="flex min-w-0 grow flex-col gap-1">
            <span className="flex min-w-0 items-baseline gap-2 text-meta text-muted-foreground max-sm:text-body">
              <Server aria-hidden className="size-(--size-icon-sm) shrink-0 self-center" />
              <span className="min-w-0 truncate">{senders}</span>
              <time dateTime={newest.sentAt} title={fullDateTime(sentAt)} className="ml-auto shrink-0 tabular-nums">
                {clockTime(sentAt)}
              </time>
            </span>
            <span className="text-body font-medium text-foreground max-sm:text-body-touch">
              {counted(messages.length, { one: 'message from a plugin ship', many: 'messages from plugin ships' })}
            </span>
            {isExpanded ? null : (
              <span className="line-clamp-2 text-meta text-muted-foreground max-sm:text-body">{messages.map(({ text }) => text.headline).join(' · ')}</span>
            )}
          </span>
          <ChevronDown aria-hidden className={classNames('mt-5 size-(--size-icon) shrink-0 text-muted-foreground transition-transform', isExpanded ? 'rotate-180' : undefined)} />
        </button>
        {isExpanded && onDoneAll !== undefined ? (
          <span className="flex shrink-0 items-start py-3 pr-3">
            <Button size="sm" icon={<Check aria-hidden />} isLoading={isPending} onClick={onDoneAll} data-testid="inbox-plugin-group-done">
              Done
            </Button>
          </span>
        ) : null}
      </div>
      {isExpanded ? (
        <ul aria-label="Messages from plugin ships">
          {messages.map((message) => (
            <InboxRow key={message.deliveryId} entry={message} isSelected={message.deliveryId === selectedId} onSelect={onSelect} now={now} isNested />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
