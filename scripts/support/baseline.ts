/** S1's figures of each read, by its name. */
export type Baseline = Readonly<Record<string, { p95Ms: number; p99Ms: number; errorRate: number }>>;
