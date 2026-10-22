import { metrics, type Attributes } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor, SimpleSpanProcessor, type ReadableSpan, type SpanExporter, type SpanProcessor } from '@opentelemetry/sdk-trace-base';

import { INSTRUMENTATION_SCOPE, SERVER_DURATION_BOUNDARIES_S } from './call-telemetry';
import type { Telemetry, TelemetryExporters } from './telemetry';

/**
 * The OpenTelemetry Node SDK, loaded only once telemetry is on (telemetry.ts).
 * It reads the OTEL_* settings itself: endpoint, headers, service name,
 * metric export interval. Next.js traces every request it serves; each of
 * those root spans also becomes a point in the request duration histogram.
 */

const DEFAULT_SERVICE_NAME = 'aeolus-console';

/** The attribute and value Next.js marks the root span of each request with. */
const NEXT_SPAN_TYPE = 'next.span_type';
const NEXT_REQUEST_SPAN = 'BaseServer.handleRequest';

/** The semantic conventions' name for an HTTP request's duration on the server, in seconds. */
const REQUEST_DURATION = 'http.server.request.duration';

const FIRST_SERVER_FAILURE_STATUS = 500;
const NS_PER_S = 1_000_000_000;

/** The request's method, route and status, under the semantic conventions' names, from what Next.js put on its span. */
function requestAttributes(span: ReadableSpan): Attributes {
  const { 'http.method': method, 'http.route': route, 'http.status_code': status } = span.attributes;
  return {
    ...(typeof method === 'string' ? { 'http.request.method': method } : {}),
    ...(typeof route === 'string' ? { 'http.route': route } : {}),
    ...(typeof status === 'number' ? { 'http.response.status_code': status } : {}),
    ...(typeof status === 'number' && status >= FIRST_SERVER_FAILURE_STATUS ? { 'error.type': String(status) } : {}),
  };
}

/** Records each request Next.js served as its root span ends. */
function requestDurations(): SpanProcessor {
  return {
    onStart: () => undefined,
    onEnd: (span) => {
      if (span.attributes[NEXT_SPAN_TYPE] !== NEXT_REQUEST_SPAN) {
        return;
      }
      const [seconds, nanoseconds] = span.duration;
      // Asked of the meter provider on each request, as for calls (call-telemetry.ts).
      metrics
        .getMeter(INSTRUMENTATION_SCOPE)
        .createHistogram(REQUEST_DURATION, {
          unit: 's',
          description: 'How long each HTTP request took on the server, by route, method and status',
          advice: { explicitBucketBoundaries: SERVER_DURATION_BOUNDARIES_S },
        })
        .record(seconds + nanoseconds / NS_PER_S, requestAttributes(span));
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}

/**
 * The OTLP span exporter for the protocol the settings name, http/protobuf
 * unless they say otherwise, as the specification has it. Each reads its
 * endpoint and headers from the settings itself.
 */
async function otlpSpanExporter(env: Readonly<Record<string, string | undefined>>): Promise<SpanExporter> {
  const protocol = (env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? env.OTEL_EXPORTER_OTLP_PROTOCOL)?.trim();
  if (protocol === 'grpc') {
    return new (await import('@opentelemetry/exporter-trace-otlp-grpc')).OTLPTraceExporter();
  }
  if (protocol === 'http/json') {
    return new (await import('@opentelemetry/exporter-trace-otlp-http')).OTLPTraceExporter();
  }
  return new (await import('@opentelemetry/exporter-trace-otlp-proto')).OTLPTraceExporter();
}

export async function startSdk(env: Readonly<Record<string, string | undefined>>, exporters?: TelemetryExporters): Promise<Telemetry> {
  const spanProcessor = exporters === undefined ? new BatchSpanProcessor(await otlpSpanExporter(env)) : new SimpleSpanProcessor(exporters.spanExporter);
  const sdk = new NodeSDK({
    // The settings' service name wins; without one, the console names itself.
    serviceName: env.OTEL_SERVICE_NAME === undefined ? DEFAULT_SERVICE_NAME : undefined,
    spanProcessors: [spanProcessor, requestDurations()],
    // Without a reader, the SDK picks the OTLP one the settings describe.
    metricReaders: exporters === undefined ? undefined : [exporters.metricReader],
  });
  sdk.start();
  return { shutdown: () => sdk.shutdown() };
}
