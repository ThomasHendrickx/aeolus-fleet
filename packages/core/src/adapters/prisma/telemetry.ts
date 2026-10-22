/**
 * Prisma's part in telemetry (telemetry/sdk.ts): its own instrumentation,
 * which traces each operation and the SQL it runs under the call that made
 * it, and a span processor that records each operation's duration as a point
 * in the query duration histogram, by its name.
 */
import { metrics, type Attributes } from '@opentelemetry/api';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { PrismaInstrumentation } from '@prisma/instrumentation';

/** The span Prisma's instrumentation opens for one operation, such as `Ship.findMany` or `$queryRaw`. */
const PRISMA_OPERATION_SPAN = 'prisma:client:operation';

/** The semantic conventions' name for a database operation's duration on the client, in seconds. */
const QUERY_DURATION = 'db.client.operation.duration';

/** The semantic conventions' boundaries, in seconds. */
const QUERY_DURATION_BOUNDARIES_S = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10];

const NS_PER_S = 1_000_000_000;

export function prismaInstrumentation(): PrismaInstrumentation {
  return new PrismaInstrumentation();
}

/** Records each Prisma operation's duration as it ends, under the given instrumentation scope. */
export function queryDurations(scope: string): SpanProcessor {
  return {
    onStart: () => undefined,
    onEnd: (span: ReadableSpan) => {
      if (span.name !== PRISMA_OPERATION_SPAN) {
        return;
      }
      const [seconds, nanoseconds] = span.duration;
      const operation = span.attributes.name;
      const attributes: Attributes = { 'db.system.name': 'postgresql', ...(typeof operation === 'string' ? { 'db.operation.name': operation } : {}) };
      // Asked of the meter provider on each operation, as for calls (telemetry/calls.ts).
      metrics
        .getMeter(scope)
        .createHistogram(QUERY_DURATION, { unit: 's', description: 'How long each database operation took', advice: { explicitBucketBoundaries: QUERY_DURATION_BOUNDARIES_S } })
        .record(seconds + nanoseconds / NS_PER_S, attributes);
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}
