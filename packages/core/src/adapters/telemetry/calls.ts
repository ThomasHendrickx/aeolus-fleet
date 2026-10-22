/**
 * Measures one call: a server span named by its procedure, and a point in the
 * procedure's duration histogram, from which a dashboard reads p95, p99 and
 * the error rate per procedure. Through the OpenTelemetry API alone: until
 * telemetry starts (telemetry.ts), both are no-ops.
 */
import { metrics, SpanKind, SpanStatusCode, trace, type Attributes } from '@opentelemetry/api';

export const INSTRUMENTATION_SCOPE = '@aeolus-fleet/core';

/** The semantic conventions' name for an RPC's duration on the server, in seconds. */
const CALL_DURATION = 'rpc.server.call.duration';

/** The semantic conventions' boundaries, in seconds; 0.1 and 0.5 are a read's p95 and p99 budgets. */
const CALL_DURATION_BOUNDARIES_S = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];

const MS_PER_S = 1000;

/** How a call ended: OK or its refusal code, and whether the server failed rather than refused. */
export interface CallOutcome {
  code: string;
  isServerFailure: boolean;
}

/** Runs the call inside its span, so the queries it makes nest under it, and records how it ended. */
export function measureCall<T>(procedure: string, call: () => Promise<{ value: T; outcome: CallOutcome }>): Promise<T> {
  const tracer = trace.getTracer(INSTRUMENTATION_SCOPE);
  const attributes: Attributes = { 'rpc.system': 'trpc', 'rpc.method': procedure };
  return tracer.startActiveSpan(procedure, { kind: SpanKind.SERVER, attributes }, async (span) => {
    const startedAt = performance.now();
    try {
      const { value, outcome } = await call();
      const ended: Attributes = {
        ...attributes,
        'rpc.response.status_code': outcome.code,
        ...(outcome.isServerFailure ? { 'error.type': outcome.code } : {}),
      };
      span.setAttributes(ended);
      if (outcome.isServerFailure) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      callDurations().record((performance.now() - startedAt) / MS_PER_S, ended);
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
    description: 'How long each call took on the server, by procedure and outcome',
    advice: { explicitBucketBoundaries: CALL_DURATION_BOUNDARIES_S },
  });
}
