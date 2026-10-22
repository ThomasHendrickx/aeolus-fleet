/**
 * The OpenTelemetry Node SDK, loaded only once telemetry is on (telemetry.ts).
 * It reads the OTEL_* settings itself: endpoint, headers, service name,
 * metric export interval. Prisma's part (prisma/telemetry.ts) traces each
 * query under the call that made it, and measures it.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor, SimpleSpanProcessor, type SpanExporter } from '@opentelemetry/sdk-trace-base';

import { prismaInstrumentation, queryDurations } from '../prisma/telemetry.js';
import { INSTRUMENTATION_SCOPE } from './calls.js';
import type { Telemetry, TelemetryExporters } from './telemetry.js';

const DEFAULT_SERVICE_NAME = 'aeolus-core';

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
    // The settings' service name wins; without one, core names itself.
    serviceName: env.OTEL_SERVICE_NAME === undefined ? DEFAULT_SERVICE_NAME : undefined,
    spanProcessors: [spanProcessor, queryDurations(INSTRUMENTATION_SCOPE)],
    // Without a reader, the SDK picks the OTLP one the settings describe.
    metricReaders: exporters === undefined ? undefined : [exporters.metricReader],
    instrumentations: [prismaInstrumentation()],
  });
  sdk.start();
  return { shutdown: () => sdk.shutdown() };
}
