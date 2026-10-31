import type { DeliveryId, InboxFilter } from '@aeolus-fleet/common';
import type { ReactNode } from 'react';

import { classNames } from '@aeolus-fleet/ui';
import { Badge } from '../../../../components/atoms/badge';
import { Tabs, TabsCount, TabsList, TabsTrigger } from '../../../../components/atoms/tabs';
import type { InboxView } from '../../services/inbox-view';
import { InboxRow } from '../molecules/inbox-row';
import { PluginGroup } from '../molecules/plugin-group';

const SEGMENTS: readonly { value: InboxFilter; label: string; isDesktopOnly: boolean }[] = [
  { value: 'open', label: 'Open', isDesktopOnly: false },
  { value: 'done', label: 'Done', isDesktopOnly: false },
  { value: 'all', label: 'All', isDesktopOnly: true },
];

export interface InboxListProps {
  view: InboxView;
  segment: InboxFilter;
  onSegmentChange: (segment: InboxFilter) => void;
  /** Counts for the segments; undefined hides a count. */
  counts: Partial<Record<InboxFilter, number>>;
  /** "1 h 7 min": how long the oldest open question waits, under Open. */
  waiting: string | undefined;
  selectedId: DeliveryId | undefined;
  onSelect: (deliveryId: DeliveryId) => void;
  isPluginGroupExpanded: boolean;
  onTogglePluginGroup: () => void;
  /** Marks every open plugin-ship message done; none where nothing can be marked done. */
  onPluginGroupDone?: () => void;
  isPluginGroupPending?: boolean;
  /** What ends the list while older messages follow: Load more. */
  more?: ReactNode;
  now: Date;
}

function Segments({ segment, onSegmentChange, counts }: Pick<InboxListProps, 'segment' | 'onSegmentChange' | 'counts'>) {
  return (
    <Tabs
      value={segment}
      onValueChange={(next: unknown) => {
        const chosen = SEGMENTS.find((each) => each.value === next);
        if (chosen) {
          onSegmentChange(chosen.value);
        }
      }}
    >
      <TabsList aria-label="Show" className="w-full">
        {SEGMENTS.map(({ value, label, isDesktopOnly }) => (
          <TabsTrigger key={value} value={value} data-testid={`inbox-filter-${value}`} className={classNames('grow', isDesktopOnly ? 'max-sm:hidden' : undefined)}>
            {label}
            {counts[value] === undefined || (value !== 'open' && counts[value] === 0) ? null : <TabsCount>{counts[value]}</TabsCount>}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function SectionTitle({ title, count, isPrimary, meta }: { title: string; count: number; isPrimary: boolean; meta?: string }) {
  return (
    <h2 className="flex items-center gap-2 px-4 pt-4 pb-2 text-meta font-semibold text-foreground max-sm:px-1 max-sm:text-body-touch">
      {title}
      <Badge variant={isPrimary ? 'count' : 'count-neutral'}>{count}</Badge>
      {meta === undefined ? null : <span className="ml-auto font-normal text-muted-foreground">{meta}</span>}
    </h2>
  );
}

/**
 * The list side of argo's inbox (#849): the segments (Open and Done on the
 * phone, with All on desktop), then Questions, open ones oldest first with
 * how long the oldest waits; Messages, newest first; and the messages of
 * plugin ships folded into one row at the end.
 */
export function InboxList({
  view,
  segment,
  onSegmentChange,
  counts,
  waiting,
  selectedId,
  onSelect,
  isPluginGroupExpanded,
  onTogglePluginGroup,
  onPluginGroupDone,
  isPluginGroupPending,
  more,
  now,
}: InboxListProps) {
  const rows = (entries: InboxView['questions'] | InboxView['messages'], label: string) => (
    <ul aria-label={label} className="max-sm:overflow-hidden max-sm:rounded-lg max-sm:border max-sm:border-border max-sm:bg-card">
      {entries.map((entry) => (
        <InboxRow key={entry.deliveryId} entry={entry} isSelected={entry.deliveryId === selectedId} onSelect={onSelect} now={now} />
      ))}
    </ul>
  );
  return (
    <div data-slot="inbox-list" className="flex flex-col">
      <div className="p-2.5 max-sm:p-0 max-sm:pb-1">
        <Segments segment={segment} onSegmentChange={onSegmentChange} counts={counts} />
      </div>
      {view.questions.length === 0 ? null : (
        <section aria-label="Questions" data-testid="inbox-questions">
          <SectionTitle title="Questions" count={view.questions.length} isPrimary={segment === 'open'} meta={segment === 'open' && waiting !== undefined ? `Oldest waits ${waiting}` : undefined} />
          {rows(view.questions, 'Questions to argo')}
        </section>
      )}
      {view.messages.length + view.pluginMessages.length === 0 ? null : (
        <section aria-label="Messages" data-testid="inbox-messages">
          <SectionTitle title="Messages" count={view.messages.length + view.pluginMessages.length} isPrimary={false} />
          <ul aria-label="Messages to argo" className="max-sm:overflow-hidden max-sm:rounded-lg max-sm:border max-sm:border-border max-sm:bg-card">
            {view.messages.map((entry) => (
              <InboxRow key={entry.deliveryId} entry={entry} isSelected={entry.deliveryId === selectedId} onSelect={onSelect} now={now} />
            ))}
            <PluginGroup
              messages={view.pluginMessages}
              isExpanded={isPluginGroupExpanded}
              onToggle={onTogglePluginGroup}
              selectedId={selectedId}
              onSelect={onSelect}
              onDoneAll={onPluginGroupDone}
              isPending={isPluginGroupPending}
              now={now}
            />
          </ul>
        </section>
      )}
      {more}
    </div>
  );
}
