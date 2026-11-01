import { HARBOUR_STATES } from '@aeolus-fleet/common/rules';
import { Ship } from 'lucide-react';
import type { ReactNode } from 'react';

import { classNames } from '@aeolus-fleet/ui';
import { Skeleton } from '../../../../components/atoms/skeleton';
import type { Harbour } from '../../services/harbour';
import { HARBOUR_STATE_LOOK } from './harbour-state';

function NumberCard({ value, word, icon, testId, className, valueClassName }: { value: number | undefined; word: string; icon: ReactNode; testId: string; className?: string; valueClassName?: string }) {
  return (
    <div data-testid={testId} className={classNames('flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2.5 max-sm:items-center max-sm:px-1.5 max-sm:py-2', className)}>
      {value === undefined ? (
        <Skeleton className="h-8 w-10 max-sm:h-6.5" />
      ) : (
        <span className={classNames('text-metric font-semibold tabular-nums text-foreground max-sm:text-[22px] max-sm:leading-6.5', valueClassName)}>{value}</span>
      )}
      <span className="inline-flex items-center gap-1.5 text-meta text-muted-foreground max-sm:gap-0.75 max-sm:text-[11px] [&_svg]:size-3.5 max-sm:[&_svg]:size-3">
        {icon}
        {word}
      </span>
    </div>
  );
}

/**
 * Harbour's numbers (docs/design/fleet-overview): the ships, then Alert,
 * Waiting, Working and Idle, each with its status icon and word; only Alert
 * is filled in its tone. One row of five on desktop and on phone. While the
 * fleet is read, each number shows as the shape that is coming.
 */
export function HarbourNumbers({ counts }: { counts: Harbour['counts'] | undefined }) {
  return (
    <div className="grid grid-cols-5 gap-3 max-sm:gap-1.5" data-testid="harbour-numbers">
      <NumberCard value={counts?.ships} word="Ships" icon={<Ship aria-hidden />} testId="harbour-number-ships" />
      {HARBOUR_STATES.map((state) => {
        const { word, Icon, text, fill } = HARBOUR_STATE_LOOK[state];
        return (
          <NumberCard
            key={state}
            value={counts?.[state]}
            word={word}
            icon={<Icon aria-hidden className={text} />}
            testId={`harbour-number-${state}`}
            className={state === 'alert' ? fill : undefined}
            valueClassName={text}
          />
        );
      })}
    </div>
  );
}
