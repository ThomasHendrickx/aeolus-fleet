import type { FleetId } from '@aeolus-fleet/common';

import type { InstallationFleetFacts } from './ports.js';

/** How far back an installation's fleet counts its messages. */
export const MESSAGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** A fleet as the installation describes it: its facts, with its messages of the last 7 days. */
export interface InstallationFleet {
  fleetId: FleetId;
  name: string;
  operatorEmail: string;
  createdAt: Date;
  shipCount: number;
  messagesLast7Days: number;
  lastActivityAt: Date | null;
  storage: number;
}

/** The start of the message window for a read at `now`: 7 days before it, counted inclusive. */
export function messageWindowStart(now: Date): Date {
  return new Date(now.getTime() - MESSAGE_WINDOW_MS);
}

export function installationFleet(facts: InstallationFleetFacts): InstallationFleet {
  const { messagesSince, ...rest } = facts;
  return { ...rest, messagesLast7Days: messagesSince };
}
