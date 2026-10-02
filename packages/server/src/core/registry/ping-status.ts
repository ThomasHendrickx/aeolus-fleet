import type { PingState } from '@aeolus-fleet/common';

import type { ShipFacts } from './ports.js';

/** How a ship's last ping stands, as the console shows it. Observation only (ADR 0016). */
export interface PingStatus {
  state: PingState;
  sentAt: Date;
  /** When pong answered it; null until then, and for a ping acknowledged with a plain ack. */
  answeredAt: Date | null;
}

/**
 * The status of a ship's last ping: waiting while its delivery is pending or
 * in flight, answered once pong acknowledged it, received when a plain ack
 * did. A ping that went undeliverable, or was dismissed or abandoned, shows
 * none: it is in Needs attention, not waiting.
 */
export function pingStatusOf(lastPing: ShipFacts['lastPing']): PingStatus | null {
  if (lastPing === null) {
    return null;
  }
  const { sentAt, deliveryState, answeredWithPongAt } = lastPing;
  switch (deliveryState) {
    case 'pending':
    case 'delivered':
      return { state: 'waiting', sentAt, answeredAt: null };
    case 'acknowledged':
      return answeredWithPongAt === null
        ? { state: 'received', sentAt, answeredAt: null }
        : { state: 'answered', sentAt, answeredAt: answeredWithPongAt };
    case 'undeliverable':
    case 'dismissed':
    case 'abandoned':
      return null;
  }
}
