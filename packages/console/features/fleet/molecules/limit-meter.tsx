import { Infinity as NoLimit, Send, Ship, type LucideIcon } from 'lucide-react';

import { classNames } from '../../../lib/class-names';
import { meterCaption, meterCount, meterState, resetTime, type MeterState } from '../../../lib/limits';
import { StatusBadge, type LimitState } from '../../../components/molecules/status-badge';

const KINDS: Record<'ships' | 'messages', { label: string; unit: string; Icon: LucideIcon }> = {
  ships: { label: 'Ships', unit: 'ships', Icon: Ship },
  messages: { label: 'Messages today', unit: 'messages', Icon: Send },
};

const FILLS: Record<Exclude<MeterState, 'none'>, string> = {
  below: 'bg-primary',
  at: 'bg-tone-waiting-fg',
  over: 'bg-tone-attention-fg',
};

const BADGES: Partial<Record<MeterState, LimitState>> = { at: 'at-limit', over: 'over-limit' };

interface LimitMeterProps {
  kind: 'ships' | 'messages';
  count: number;
  /** Null when no limit applies. */
  limit: number | null;
  /** When today's message count starts again; messages only. */
  resetsAt?: string;
}

/**
 * A count against its limit (the LimitMeter part, card variant): neutral
 * below the limit; the waiting tone with At limit at it; the attention tone
 * with Over limit over it, when a limit was lowered below use. The signal is
 * always an icon and a word, never colour alone. An unset limit shows No
 * limit, never a blank or a zero.
 */
export function LimitMeter({ kind, count, limit, resetsAt }: LimitMeterProps) {
  const { label, unit, Icon } = KINDS[kind];
  const state = meterState({ count, limit });
  const badge = BADGES[state];
  const caption = meterCaption({ count, limit });
  // A limit of 0 is reached at once: the bar is full, not divided by zero.
  const filled = limit === null ? 0 : limit === 0 ? 1 : Math.min(count / limit, 1);
  return (
    <div data-testid={`limit-meter-${kind}`} data-state={state} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-meta font-medium text-muted-foreground">
          <Icon aria-hidden className="size-(--size-icon-sm)" />
          {label}
        </span>
        {badge === undefined ? null : <StatusBadge status={badge} />}
      </div>
      <p className="flex items-baseline gap-1.5">
        <span className="text-metric font-semibold tabular-nums">{meterCount(count)}</span>
        <span className="text-body text-muted-foreground">{limit === null ? unit : `of ${meterCount(limit)} ${unit}`}</span>
      </p>
      {limit === null ? (
        <p className="inline-flex items-center gap-1.5 text-meta text-muted-foreground">
          <NoLimit aria-hidden className="size-(--size-icon-sm)" />
          No limit
        </p>
      ) : (
        <>
          <span
            role="meter"
            aria-label={`${label}: ${String(count)} of ${String(limit)}`}
            aria-valuenow={count}
            aria-valuemin={0}
            aria-valuemax={limit}
            className="block h-1.5 overflow-hidden rounded-full bg-secondary"
          >
            <span className={classNames('block h-full rounded-full', state === 'none' ? undefined : FILLS[state])} style={{ width: `${String(filled * 100)}%` }} />
          </span>
          <p data-testid={`limit-meter-${kind}-caption`} className="text-caption text-muted-foreground">
            {caption}
            {resetsAt === undefined ? null : ` · resets at ${resetTime(resetsAt)}`}
          </p>
        </>
      )}
    </div>
  );
}
