import type { Ping } from '../../core/shared/ping.js';

/** The use cases procedures can call. Wired once at startup. */
export interface UseCases {
  ping: Ping;
}

export interface Context {
  useCases: UseCases;
}
