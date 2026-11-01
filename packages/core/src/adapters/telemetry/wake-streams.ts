/**
 * Measures the wake streams (long-poll design, W1) apart from the calls: how
 * many streams are open, and how many wakes they sent, by reason. A stream
 * lasts as long as its crew keeps it, so it has no duration and stays out of
 * the call and request duration histograms. Through the OpenTelemetry API
 * alone, as calls are.
 */
import { metrics } from '@opentelemetry/api';

import type { WakeReason } from '../../domain/messaging/watch-wakeups.js';
import { INSTRUMENTATION_SCOPE } from './calls.js';

const STREAMS_OPEN = 'aeolus.wake_stream.open';
const WAKES_SENT = 'aeolus.wake_stream.wakes';

// Asked of the meter provider each time, not kept: one kept before telemetry
// starts would stay a no-op.
function streamsOpen() {
  return metrics.getMeter(INSTRUMENTATION_SCOPE).createUpDownCounter(STREAMS_OPEN, { unit: '{stream}', description: 'How many wake streams are open' });
}

/** Counts a stream open until `streamClosed`. */
export function streamOpened(): void {
  streamsOpen().add(1);
}

export function streamClosed(): void {
  streamsOpen().add(-1);
}

/** Counts a wake a stream sent, by its reason. */
export function wakeSent(reason: WakeReason): void {
  metrics.getMeter(INSTRUMENTATION_SCOPE).createCounter(WAKES_SENT, { unit: '{wake}', description: 'How many wakes the wake streams sent, by reason' }).add(1, { reason });
}
