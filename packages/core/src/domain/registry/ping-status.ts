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
 * did, and undeliverable once it was handed out again and again and never
 * acknowledged (it is in Needs attention too). A ping the operator dismissed,
 * or one abandoned with a retired ship, shows none.
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
      return { state: 'undeliverable', sentAt, answeredAt: null };
    case 'dismissed':
    case 'abandoned':
      return null;
  }
}
