'use client';

import { useFleetLimits } from '../../../lib/fleet-limits';
import { useHostedAccountUrl } from '../../../lib/hosted-account';
import { hasLimits, retentionLine } from '../../../lib/limits';
import { LimitMeter } from '../ui/molecules/limit-meter';

/**
 * The fleet's limits on the overview, when any applies (fleet.limits): ships
 * used of the ship limit, and messages sent today of the daily limit with when
 * it resets, as meters; a limit not set shows No limit beside one that is.
 * Under the meters, how long the fleet keeps its finished history, or that it
 * keeps it for good. View limits opens the hosted account when the console
 * knows it. With no limit and no retention at all, as on a self-hosted
 * installation, nothing shows.
 */
export function FleetLimits() {
  const limits = useFleetLimits().data;
  const accountUrl = useHostedAccountUrl();
  if (!hasLimits(limits)) {
    return null;
  }
  return (
    <section aria-labelledby="overview-limits-title" data-testid="overview-limits" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 id="overview-limits-title" className="text-body font-semibold">
          Limits
        </h2>
        {accountUrl === undefined ? null : (
          <a href={accountUrl} data-testid="overview-limits-view" className="text-meta font-medium text-primary underline underline-offset-2">
            View limits
          </a>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <LimitMeter kind="ships" count={limits.ships.count} limit={limits.ships.limit} />
        <LimitMeter kind="messages" count={limits.dailyMessages.count} limit={limits.dailyMessages.limit} resetsAt={limits.dailyMessages.resetsAt} />
      </div>
      <p data-testid="overview-limits-retention" className="text-meta text-muted-foreground">
        {retentionLine(limits.retention)}
      </p>
    </section>
  );
}
