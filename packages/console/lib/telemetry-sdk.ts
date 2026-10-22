import { NodeSDK } from '@opentelemetry/sdk-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

import type { Telemetry, TelemetryExporters } from './telemetry';

/**
 * The OpenTelemetry Node SDK, loaded only once telemetry is on (telemetry.ts).
 * It reads every OTEL_* setting itself: endpoint, protocol, headers, service
 * name, metric export interval.
 */

const DEFAULT_SERVICE_NAME = 'aeolus-console';

export function startSdk(env: Readonly<Record<string, string | undefined>>, exporters?: TelemetryExporters): Telemetry {
  const sdk = new NodeSDK({
    // The settings' service name wins; without one, the console names itself.
    serviceName: env.OTEL_SERVICE_NAME === undefined ? DEFAULT_SERVICE_NAME : undefined,
    // Without these, the SDK picks the OTLP exporters the settings describe.
    spanProcessors: exporters === undefined ? undefined : [new SimpleSpanProcessor(exporters.spanExporter)],
    metricReaders: exporters === undefined ? undefined : [exporters.metricReader],
  });
  sdk.start();
  return { shutdown: () => sdk.shutdown() };
}
