import { z } from 'zod';

import type { Baseline } from './baseline.ts';

const baselineSchema = z.record(z.string(), z.object({ p95Ms: z.number(), p99Ms: z.number(), errorRate: z.number() }));

/** S1's baseline as the run is given it: each read's p95, p99 and error rate by its name. A baseline of no read is refused. */
export function baselineOf(json: string): Baseline {
  const baseline = baselineSchema.parse(JSON.parse(json));
  if (Object.keys(baseline).length === 0) {
    throw new Error('The baseline holds no read');
  }
  return baseline;
}
