import type { Measurement } from './measurement.ts';

/** A read of the run: what it measured, or why it could not be measured. */
export interface ReadReport {
  name: string;
  measured: Measurement | { notMeasured: string };
}
