import { metrics, SpanKind, SpanStatusCode, trace, type Attributes } from '@opentelemetry/api';

/**
 * Measures one call the web app's server answers: a server span named by it,
 * and a point in its duration histogram, from which a dashboard reads p95,
 * p99 and the error rate per call, as for core's procedures. Through the
 * OpenTelemetry API alone: until telemetry starts (telemetry.ts), both are
 * no-ops.
 */

export const INSTRUMENTATION_SCOPE = '@aeolus-fleet/console';

/** The semantic conventions' name for an RPC's duration on the server, in seconds. */
const CALL_DURATION = 'rpc.server.call.duration';

/** The semantic conventions' boundaries for a duration on the server, in seconds; 0.1 and 0.5 are a read's p95 and p99 budgets. */
export const SERVER_DURATION_BOUNDARIES_S = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];

const MS_PER_S = 1000;
const FIRST_REFUSAL_STATUS = 400;
const FIRST_SERVER_FAILURE_STATUS = 500;

/** Answers the call inside its span, and records how it ended: OK, or the status it was refused or failed with. */
export function measureCall(call: string, answer: () => Promise<Response>): Promise<Response> {
  const attributes: Attributes = { 'rpc.system': 'aeolus-console', 'rpc.method': call };
  return trace.getTracer(INSTRUMENTATION_SCOPE).startActiveSpan(call, { kind: SpanKind.SERVER, attributes }, async (span) => {
    const startedAt = performance.now();
    let status = FIRST_SERVER_FAILURE_STATUS;
    try {
      const response = await answer();
      status = response.status;
      return response;
    } finally {
      const isServerFailure = status >= FIRST_SERVER_FAILURE_STATUS;
      const ended: Attributes = {
        ...attributes,
        'rpc.response.status_code': status < FIRST_REFUSAL_STATUS ? 'OK' : String(status),
        ...(isServerFailure ? { 'error.type': String(status) } : {}),
      };
      span.setAttributes(ended);
      if (isServerFailure) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      span.end();
      callDurations().record((performance.now() - startedAt) / MS_PER_S, ended);
    }
  });
}

// Asked of the meter provider on each call, not kept: one kept before
// telemetry starts would stay a no-op.
function callDurations() {
  return metrics.getMeter(INSTRUMENTATION_SCOPE).createHistogram(CALL_DURATION, {
    unit: 's',
    description: 'How long each call took on the server, by call and outcome',
    advice: { explicitBucketBoundaries: SERVER_DURATION_BOUNDARIES_S },
  });
}
