import { context, metrics, propagation, SpanStatusCode, trace } from '@opentelemetry/api';
import { AggregationTemporality, DataPointType, InMemoryMetricExporter, PeriodicExportingMetricReader, type HistogramMetricData } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FLEET_URL, historyUseCases, identityUseCases, initialiseFleet, messagingUseCases, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { buildHttpServer } from '../http/server.js';
import { startTelemetry, type Telemetry } from './telemetry.js';

// Every call through the doors becomes a span and a point in its procedure's
// duration histogram, once an OTLP endpoint is set; with none, nothing starts.

const ENDPOINT = { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' };
/** Long enough that only the test's own collect exports. */
const EXPORT_INTERVAL_MS = 3_600_000;

let core: InMemoryCore;
let server: FastifyInstance;
let telemetry: Telemetry | undefined;
let spans: InMemorySpanExporter;
let points: InMemoryMetricExporter;
let metricReader: PeriodicExportingMetricReader;

function start(ping: () => Promise<{ serverTime: Date; fleetCount: number }> = () => Promise.resolve({ serverTime: core.clock.now(), fleetCount: 1 })) {
  server = buildHttpServer({
    fleetUrl: FLEET_URL,
    useCases: { ...identityUseCases(core), ...registryUseCases(core), ...messagingUseCases(core), ...historyUseCases(core), ping },
    checkDatabase: () => Promise.resolve(),
    latestMigration: () => Promise.resolve(null),
    clock: core.clock,
    logger: false,
  });
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-22T12:00:00.000Z');
  await initialiseFleet(core);
  spans = new InMemorySpanExporter();
  points = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  metricReader = new PeriodicExportingMetricReader({ exporter: points, exportIntervalMillis: EXPORT_INTERVAL_MS });
});

afterEach(async () => {
  await server.close();
  await telemetry?.shutdown();
  telemetry = undefined;
  trace.disable();
  metrics.disable();
  context.disable();
  propagation.disable();
});

/** The duration histogram's points for one procedure, after a collect. */
async function callDurations(procedure: string) {
  await metricReader.forceFlush();
  const histograms = points
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics))
    .filter((metric): metric is HistogramMetricData => metric.descriptor.name === 'rpc.server.call.duration' && metric.dataPointType === DataPointType.HISTOGRAM);
  return histograms.flatMap((metric) => metric.dataPoints).filter((point) => point.attributes['rpc.method'] === procedure);
}

describe('with no OTLP endpoint set', () => {
  it('starts nothing, so a call records nothing', async () => {
    telemetry = await startTelemetry({}, { spanExporter: spans, metricReader });
    start();

    await server.inject({ method: 'GET', url: '/trpc/system.ping' });

    expect(telemetry).toBeUndefined();
    expect(trace.getTracer('any').startSpan('any').isRecording()).toBe(false);
    expect(spans.getFinishedSpans()).toEqual([]);
  });

  it('starts nothing while OTEL_SDK_DISABLED is true, even with an endpoint', async () => {
    telemetry = await startTelemetry({ ...ENDPOINT, OTEL_SDK_DISABLED: 'true' }, { spanExporter: spans, metricReader });

    expect(telemetry).toBeUndefined();
  });
});

describe('with an OTLP endpoint set', () => {
  it.each([
    ['OTEL_EXPORTER_OTLP_ENDPOINT', ENDPOINT],
    ['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:4318/v1/traces' }],
    ['OTEL_EXPORTER_OTLP_METRICS_ENDPOINT', { OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://127.0.0.1:4318/v1/metrics' }],
  ])('starts with %s alone', async (_name, env) => {
    telemetry = await startTelemetry(env, { spanExporter: spans, metricReader });

    expect(telemetry).toBeDefined();
  });

  it('records a call as a span named by its procedure', async () => {
    telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });
    start();

    await server.inject({ method: 'GET', url: '/trpc/system.ping' });

    expect(spans.getFinishedSpans()).toEqual([
      expect.objectContaining({ name: 'system.ping', attributes: expect.objectContaining({ 'rpc.system': 'trpc', 'rpc.method': 'system.ping', 'rpc.response.status_code': 'OK' }) }),
    ]);
  });

  it('records a call as a point in its procedure duration histogram', async () => {
    telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });
    start();

    await server.inject({ method: 'GET', url: '/trpc/system.ping' });

    expect(await callDurations('system.ping')).toEqual([expect.objectContaining({ attributes: expect.objectContaining({ 'rpc.response.status_code': 'OK' }), value: expect.objectContaining({ count: 1 }) })]);
  });

  it('records a refused call with its refusal code, and does not mark it an error', async () => {
    telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });
    start();

    await server.inject({ method: 'GET', url: '/trpc/whoami' });

    const [span] = spans.getFinishedSpans();
    expect(span?.attributes['rpc.response.status_code']).toBe('UNAUTHORIZED');
    expect(span?.status.code).not.toBe(SpanStatusCode.ERROR);
    expect(await callDurations('whoami')).toEqual([expect.objectContaining({ attributes: expect.objectContaining({ 'rpc.response.status_code': 'UNAUTHORIZED' }) })]);
  });

  it('records a server failure as an error, so the error rate counts it', async () => {
    telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });
    start(() => Promise.reject(new Error('the database went away')));

    await server.inject({ method: 'GET', url: '/trpc/system.ping' });

    const [span] = spans.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(await callDurations('system.ping')).toEqual([
      expect.objectContaining({ attributes: expect.objectContaining({ 'rpc.response.status_code': 'INTERNAL_SERVER_ERROR', 'error.type': 'INTERNAL_SERVER_ERROR' }) }),
    ]);
  });
});
