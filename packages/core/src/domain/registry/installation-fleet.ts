import type { FleetId } from '@aeolus-fleet/common';

import type { Health } from '../shared/health.js';
import { fleetLimitsOf, type FleetLimit, type FleetRetention, type InstallationSettings } from './limits.js';
import type { FleetHealth, InstallationFleetFacts, InstallationFleetWindow } from './ports.js';

/** How far back an installation's fleet counts its messages, and over how many UTC days. */
export const MESSAGE_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MESSAGE_WINDOW_MS = MESSAGE_WINDOW_DAYS * DAY_MS;

/**
 * A fleet as the installation describes it (docs/blueprint.md,
 * "Installation"): its facts and measures, its messages today and per UTC day
 * of the last 7 days, today last, the limits that apply to it and its health.
 */
export interface InstallationFleet {
  fleetId: FleetId;
  name: string;
  operatorEmail: string;
  createdAt: Date;
  shipCount: number;
  messagesLast7Days: number;
  lastActivityAt: Date | null;
  storage: number;
  messagesToday: number;
  messagesPerDay: { date: string; count: number }[];
  limits: { ships: FleetLimit; dailyMessages: FleetLimit; schedulesPerShip: FleetLimit; minimumScheduleInterval: FleetLimit; retention: FleetRetention };
  /** Its 0041 figures, and where its deliveries are stuck (decision 0042). */
  health: FleetHealth & Health;
}

/** The UTC days a read at `now` counts messages over: the last 7, today last, as YYYY-MM-DD. */
function utcDays(now: Date): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: MESSAGE_WINDOW_DAYS }, (_unused, index) => new Date(today - (MESSAGE_WINDOW_DAYS - 1 - index) * DAY_MS).toISOString().slice(0, 10));
}

/** What a read at `now` counts over: the last 7 times 24 hours, and the last 7 UTC days from the first one's start. */
export function messageWindow(now: Date): InstallationFleetWindow {
  const [firstDay = now.toISOString().slice(0, 10)] = utcDays(now);
  return { since: new Date(now.getTime() - MESSAGE_WINDOW_MS), firstDay: new Date(`${firstDay}T00:00:00.000Z`) };
}

export function installationFleet(facts: InstallationFleetFacts, read: { now: Date; installation: InstallationSettings; health: Health }): InstallationFleet {
  const { messagesSince, messagesPerUtcDay, limitSettings, health, ...rest } = facts;
  const messagesPerDay = utcDays(read.now).map((date) => ({ date, count: messagesPerUtcDay.find((day) => day.date === date)?.count ?? 0 }));
  const { ships, dailyMessages, schedulesPerShip, minimumScheduleInterval, retention } = fleetLimitsOf({ fleetId: facts.fleetId, settings: limitSettings, installation: read.installation });
  return {
    ...rest,
    health: { ...health, ...read.health },
    messagesLast7Days: messagesSince,
    messagesToday: messagesPerDay.at(-1)?.count ?? 0,
    messagesPerDay,
    limits: { ships, dailyMessages, schedulesPerShip, minimumScheduleInterval, retention },
  };
}
