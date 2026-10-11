import { z } from 'zod';

/** Output of `system.ping`: the server's clock and how many fleets its database holds. */
export const pingOutputSchema = z.object({
  /** ISO 8601 in UTC. */
  serverTime: z.iso.datetime(),
  fleetCount: z.int().nonnegative(),
});

export type PingOutput = z.infer<typeof pingOutputSchema>;

/** Output of `system.version`: the versions the server process runs and the latest migration applied to its database (null before the first). */
export const systemVersionOutputSchema = z.object({
  server: z.string(),
  common: z.string(),
  migration: z.string().nullable(),
});

export type SystemVersionOutput = z.infer<typeof systemVersionOutputSchema>;
