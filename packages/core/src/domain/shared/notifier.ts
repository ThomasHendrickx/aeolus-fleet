import type { DeliveryId, FleetId } from '@aeolus-fleet/common';

import type { Recipient } from './selector.js';

/** Which delivery is pending, and for whom: never its payload. */
export interface DeliveryNotice {
  fleetId: FleetId;
  deliveryId: DeliveryId;
  recipient: Recipient;
}

/**
 * Outbound port: wakes whoever waits to receive a delivery, when a send stores
 * it or a lease end returns it to pending. Sent as part of the caller's unit
 * of work: it reaches listeners only once that commits, and never when it
 * rolls back, so nobody is woken for a delivery that is not pending.
 */
export interface Notifier {
  deliveryPending(notice: DeliveryNotice): Promise<void>;
}
