/** What a run of one read measured. */
export interface Measurement {
  samples: number;
  p95Ms: number;
  p99Ms: number;
  errorRate: number;
}
