'use client';

import { useFleetLimits } from '../../lib/fleet-limits';
import { useHostedAccountUrl } from '../../lib/hosted-account';
import { hasLimits } from '../../lib/limits';
import { LimitMeter } from '../molecules/limit-meter';

/**
 * The fleet's limits on the overview, when any applies (fleet.limits): ships
 * used of the ship limit, and messages sent today of the daily limit with when
 * it resets, as meters; a limit not set shows No limit beside one that is.
 * View limits opens the hosted account when the console knows it. With no
 * limit at all, as on a self-hosted installation, nothing shows.
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
    </section>
  );
}
