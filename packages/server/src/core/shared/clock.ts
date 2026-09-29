/** Outbound port: the current time. Injected so tests control it. */
export interface Clock {
  now(): Date;
}
