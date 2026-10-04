import type { FleetLimitsOutput } from '@aeolus-fleet/common';

const COUNT = new Intl.NumberFormat('en-US');

/** A count as the console writes it: 1,000. */
function counted(value: number): string {
  return COUNT.format(value);
}

/** When the daily message count starts again, as the console words it: 00:00 UTC. */
export function resetTime(resetsAt: string): string {
  return `${new Date(resetsAt).toISOString().slice(11, 16)} UTC`;
}

/** Where a count stands against its limit (the LimitMeter part): below it, at it, over it (a limit lowered below use), or no limit. */
export type MeterState = 'below' | 'at' | 'over' | 'none';

/** A count against its limit, as fleet.limits gives it: the limit null when none applies. */
export interface Metered {
  count: number;
  limit: number | null;
}

export function meterState({ count, limit }: Metered): MeterState {
  if (limit === null) {
    return 'none';
  }
  return count < limit ? 'below' : count === limit ? 'at' : 'over';
}

/** The line under a meter: what is left, that the limit is reached, or how far over it the count is; nothing without a limit. */
export function meterCaption(metered: Metered): string | undefined {
  const { count, limit } = metered;
  if (limit === null) {
    return undefined;
  }
  const state = meterState(metered);
  return state === 'below' ? `${counted(limit - count)} left` : state === 'at' ? 'Limit reached' : `${counted(count - limit)} over the limit`;
}

/** Whether any limit applies to the fleet: without one, the console shows no meters. */
export function hasLimits(limits: FleetLimitsOutput | undefined): limits is FleetLimitsOutput {
  return limits !== undefined && (limits.ships.limit !== null || limits.dailyMessages.limit !== null);
}

/** A count as the meters write it: 1,000. */
export function meterCount(value: number): string {
  return counted(value);
}

/** The ship limit the fleet is at, or none while it has room or no limit applies. */
export function shipLimitReached(limits: FleetLimitsOutput | undefined): number | undefined {
  const ships = limits?.ships;
  return ships?.limit != null && ships.count >= ships.limit ? ships.limit : undefined;
}

/** The daily message limit the fleet reached, with when it resets, or none while it has room or no limit applies. */
export function messageLimitReached(limits: FleetLimitsOutput | undefined): { limit: number; resetsAt: string } | undefined {
  const messages = limits?.dailyMessages;
  return messages?.limit != null && messages.count >= messages.limit ? { limit: messages.limit, resetsAt: messages.resetsAt } : undefined;
}

/** The notice in Commission at the ship limit (canvas 12.1). */
export function shipLimitNotice(limit: number): { title: string; description: string } {
  return {
    title: 'Your fleet is at its ship limit',
    description: `This fleet can have ${counted(limit)} ships, so it can’t take a new one. Limits are listed on your account.`,
  };
}

/** The overview's notice once today's message limit is reached (canvas 12.2). */
export function messageLimitNotice(reached: { limit: number; resetsAt: string }): { title: string; description: string } {
  return {
    title: 'Your fleet reached today’s message limit',
    description: `It sent ${counted(reached.limit)} messages today, its daily limit. New messages are refused until the limit resets at ${resetTime(reached.resetsAt)}.`,
  };
}

/** Compose's notice when the daily limit refused the message (canvas 12.3). */
export function composeRefusedNotice(reached: { limit: number; resetsAt: string }): { title: string; description: string } {
  return {
    title: 'This message wasn’t sent',
    description: `Your fleet reached its limit of ${counted(reached.limit)} messages today. Sending works again after the limit resets at ${resetTime(reached.resetsAt)}.`,
  };
}
