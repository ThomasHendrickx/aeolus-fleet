/**
 * Measures one call: a server span named by its procedure, and a point in the
 * procedure's duration histogram, from which a dashboard reads p95, p99 and
 * the error rate per procedure. Through the OpenTelemetry API alone: until
 * telemetry starts (telemetry.ts), both are no-ops.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import { metrics, SpanKind, SpanStatusCode, trace, type Attributes } from '@opentelemetry/api';

export const INSTRUMENTATION_SCOPE = '@aeolus-fleet/core';

/** The semantic conventions' name for an RPC's duration on the server, in seconds. */
const CALL_DURATION = 'rpc.server.call.duration';

/** The time a call spent waiting for a message, which its duration leaves out, in seconds. */
const CALL_WAIT_DURATION = 'rpc.server.call.wait.duration';

/** What one running call has waited so far, in milliseconds. */
interface CallClock {
  procedure: string;
  waitedMs: number;
}

const runningCall = new AsyncLocalStorage<CallClock>();

/** The semantic conventions' boundaries for a duration on the server, in seconds; 0.1 and 0.5 are a read's p95 and p99 budgets. */
export const SERVER_DURATION_BOUNDARIES_S = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];

/** Boundaries for a wait, in seconds: up to the 25 s a call waits at most. */
const WAIT_DURATION_BOUNDARIES_S = [0.1, 0.5, 1, 2.5, 5, 10, 15, 20, 25, 30];

export const MS_PER_S = 1000;

/** How a call ended: OK or its refusal code, and whether the server failed rather than refused. */
export interface CallOutcome {
  code: string;
  isServerFailure: boolean;
}

/**
 * Runs a wait for a message (a receive, an inbox check or a follow holding
 * the call open until a delivery or news comes, or its time passes). The wait
 * belongs to the call that waits, not to its duration: it is taken off the
 * call's duration and recorded in the wait histogram. Outside a call it is
 * only run.
 */
export async function measureWait<T>(wait: () => Promise<T>): Promise<T> {
  const call = runningCall.getStore();
  if (call === undefined) {
    return wait();
  }
  const startedAt = performance.now();
  try {
    return await wait();
  } finally {
    const waitedMs = performance.now() - startedAt;
    call.waitedMs += waitedMs;
    waitDurations().record(waitedMs / MS_PER_S, { 'rpc.system': 'trpc', 'rpc.method': call.procedure });
  }
}

/** Runs the call inside its span, so the queries it makes nest under it, and records how it ended. */
export function measureCall<T>(procedure: string, call: () => Promise<{ value: T; outcome: CallOutcome }>): Promise<T> {
  const tracer = trace.getTracer(INSTRUMENTATION_SCOPE);
  const attributes: Attributes = { 'rpc.system': 'trpc', 'rpc.method': procedure };
  return tracer.startActiveSpan(procedure, { kind: SpanKind.SERVER, attributes }, async (span) => {
    const startedAt = performance.now();
    const clock: CallClock = { procedure, waitedMs: 0 };
    try {
      const { value, outcome } = await runningCall.run(clock, call);
      const ended: Attributes = {
        ...attributes,
        'rpc.response.status_code': outcome.code,
        ...(outcome.isServerFailure ? { 'error.type': outcome.code } : {}),
      };
      span.setAttributes(ended);
      if (outcome.isServerFailure) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      callDurations().record(Math.max(0, performance.now() - startedAt - clock.waitedMs) / MS_PER_S, ended);
      return value;
    } finally {
      span.end();
    }
  });
}

// Asked of the meter provider on each call, not kept: one kept before
// telemetry starts would stay a no-op.
function callDurations() {
  return metrics.getMeter(INSTRUMENTATION_SCOPE).createHistogram(CALL_DURATION, {
    unit: 's',
    description: 'How long each call worked on the server, by procedure and outcome; the time it waited for a message is left out',
    advice: { explicitBucketBoundaries: SERVER_DURATION_BOUNDARIES_S },
  });
}

function waitDurations() {
  return metrics.getMeter(INSTRUMENTATION_SCOPE).createHistogram(CALL_WAIT_DURATION, {
    unit: 's',
    description: 'How long each call waited for a message, by procedure',
    advice: { explicitBucketBoundaries: WAIT_DURATION_BOUNDARIES_S },
  });
}
