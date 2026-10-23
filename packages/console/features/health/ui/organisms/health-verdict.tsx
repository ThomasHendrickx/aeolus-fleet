import type { Health } from '@aeolus-fleet/common';

import { StatusBadge } from '../../../../components/molecules/status-badge';
import { shortDateTime } from '../../../../lib/relative-time';
import { marksOf, trendSentence, verdictOf } from '../../services/health-view';
import { StuckTrend } from '../molecules/stuck-trend';

/**
 * The answer to "is delivery working" (mock-up A): Stuck with how many
 * deliveries in how many places, since when and whether that rose or fell in
 * a day, or Delivering; beside it the 7-day trend with its marks.
 */
export function HealthVerdict({ health }: { health: Pick<Health, 'stuck' | 'stuckPerHour'> }) {
  const verdict = verdictOf(health);
  return (
    <section
      aria-label="Verdict"
      data-testid="health-verdict"
      data-verdict={verdict.kind}
      className="grid gap-6 rounded-lg border border-border bg-card p-4 shadow-sm lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] max-sm:gap-4 max-sm:rounded-xl"
    >
      <div className="flex flex-col items-start gap-3">
        <StatusBadge status={verdict.kind} />
        {verdict.kind === 'stuck' ? (
          <>
            <p className="text-section font-semibold text-foreground">
              <span className="text-metric tabular-nums max-sm:text-title-touch" data-testid="health-stuck-count">
                {verdict.count}
              </span>{' '}
              {verdict.count === 1 ? 'delivery' : 'deliveries'} stuck in {verdict.places} {verdict.places === 1 ? 'place' : 'places'}
            </p>
            <p className="text-body text-muted-foreground max-sm:text-body-touch">
              Stuck since {shortDateTime(new Date(verdict.since))}. {trendSentence(verdict)}
            </p>
            <p className="text-meta text-muted-foreground">Nothing is lost: each one is stored and moves on as soon as its cause is gone.</p>
          </>
        ) : (
          <>
            <p className="text-section font-semibold text-foreground">Delivering. Nothing is stuck.</p>
            <p className="text-body text-muted-foreground max-sm:text-body-touch">Every delivery waits only on its ship to take it.</p>
          </>
        )}
      </div>
      <StuckTrend perHour={health.stuckPerHour} marks={marksOf(health)} />
    </section>
  );
}
