import { z } from 'zod';

/** Output of `system.ping`: the server's clock and how many fleets its database holds. */
export const pingOutputSchema = z.object({
  /** ISO 8601 in UTC. */
  serverTime: z.iso.datetime(),
  fleetCount: z.int().nonnegative(),
});

export type PingOutput = z.infer<typeof pingOutputSchema>;
