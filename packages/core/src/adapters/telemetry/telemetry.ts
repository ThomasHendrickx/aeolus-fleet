/**
 * OpenTelemetry for core: a trace and a duration point for every call, and
 * the database queries it makes, sent over OTLP. Only the standard OTEL_*
 * settings switch it on: with no OTLP endpoint set, nothing starts and the
 * SDK is never loaded, so a self-hosted fleet sends nothing anywhere.
 */
import type { MetricReader } from '@opentelemetry/sdk-metrics';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';

export interface Telemetry {
  /** Sends what is still buffered, then stops. */
  shutdown(): Promise<void>;
}

/** Where a test reads what would be sent; without them, the OTEL_* settings choose the exporters. */
export interface TelemetryExporters {
  spanExporter: SpanExporter;
  metricReader: MetricReader;
}

/** Any one of them switches telemetry on; the SDK reads them, and the rest of the OTEL_* settings, itself. */
const ENDPOINT_SETTINGS = ['OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT'] as const;

/** On when an OTLP endpoint is set, unless OTEL_SDK_DISABLED says true, as the specification has it. */
export function isTelemetryOn(env: Readonly<Record<string, string | undefined>>): boolean {
  const isDisabled = env.OTEL_SDK_DISABLED?.trim().toLowerCase() === 'true';
  return !isDisabled && ENDPOINT_SETTINGS.some((name) => (env[name]?.trim() ?? '') !== '');
}

/** Starts telemetry when the settings switch it on; undefined, having loaded nothing, when they do not. */
export async function startTelemetry(env: Readonly<Record<string, string | undefined>>, exporters?: TelemetryExporters): Promise<Telemetry | undefined> {
  if (!isTelemetryOn(env)) {
    return undefined;
  }
  const { startSdk } = await import('./sdk.js');
  return startSdk(env, exporters);
}
