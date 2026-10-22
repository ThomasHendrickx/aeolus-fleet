import { context, metrics, propagation, SpanKind, trace } from '@opentelemetry/api';
import { AggregationTemporality, DataPointType, InMemoryMetricExporter, PeriodicExportingMetricReader, type HistogramMetricData } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { answerConsoleRead, consoleRead } from './console-read';
import { startTelemetry, type Telemetry } from './telemetry';

// Every console read becomes a span and a point in its duration histogram,
// once an OTLP endpoint is set; with none, nothing starts.

const ENDPOINT = { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' };
/** Long enough that only the test's own collect exports. */
const EXPORT_INTERVAL_MS = 3_600_000;

const reads = {
  squadrons: consoleRead(z.undefined(), () => Promise.resolve({ kind: 'answered', data: ['sqd_1'] })),
};
const signedIn = { sessionOf: () => Promise.resolve('live' as const) };

let telemetry: Telemetry | undefined;
let spans: InMemorySpanExporter;
let points: InMemoryMetricExporter;
let metricReader: PeriodicExportingMetricReader;

beforeEach(() => {
  spans = new InMemorySpanExporter();
  points = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  metricReader = new PeriodicExportingMetricReader({ exporter: points, exportIntervalMillis: EXPORT_INTERVAL_MS });
});

afterEach(async () => {
  await telemetry?.shutdown();
  telemetry = undefined;
  trace.disable();
  metrics.disable();
  context.disable();
  propagation.disable();
});

function read(name: string) {
  return answerConsoleRead(new Request(`http://console/api/reads/${name}`), { name, reads, ...signedIn });
}

/** The spans exported so far, once there are any: the SDK exports a span once its resource is known. */
async function finishedSpans() {
  await expect.poll(() => spans.getFinishedSpans()).not.toEqual([]);
  return spans.getFinishedSpans();
}

/** The points of one duration histogram, after a collect. */
async function durationsOf(histogram: string) {
  await metricReader.forceFlush();
  return points
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics))
    .filter((metric): metric is HistogramMetricData => metric.descriptor.name === histogram && metric.dataPointType === DataPointType.HISTOGRAM)
    .flatMap((metric) => metric.dataPoints);
}

function callDurations() {
  return durationsOf('rpc.server.call.duration');
}

/** The root span Next.js opens for each request it serves, as it ends it. */
function nextRequest(attributes: Record<string, string | number>) {
  trace
    .getTracer('next.js')
    .startSpan('GET /inbox', { kind: SpanKind.SERVER, attributes: { 'next.span_type': 'BaseServer.handleRequest', ...attributes } })
    .end();
}

describe('with no OTLP endpoint set', () => {
  it('starts nothing, so a read records nothing', async () => {
    telemetry = await startTelemetry({}, { spanExporter: spans, metricReader });

    await read('squadrons');

    expect(telemetry).toBeUndefined();
    expect(trace.getTracer('any').startSpan('any').isRecording()).toBe(false);
  });

  it('starts nothing while OTEL_SDK_DISABLED is true, even with an endpoint', async () => {
    telemetry = await startTelemetry({ ...ENDPOINT, OTEL_SDK_DISABLED: 'true' }, { spanExporter: spans, metricReader });

    expect(telemetry).toBeUndefined();
  });
});

describe('with an OTLP endpoint set', () => {
  it('records a read as a span named by the read', async () => {
    telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });

    await read('squadrons');

    const finished = await finishedSpans();
    expect(finished.map((span) => span.name)).toEqual(['reads.squadrons']);
    expect(finished[0]?.attributes).toMatchObject({ 'rpc.method': 'reads.squadrons', 'rpc.response.status_code': 'OK' });
  });

  it("records a read as a point in its duration histogram, with how it ended", async () => {
    telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });

    await read('squadrons');

    const durations = await callDurations();
    expect(durations.map((point) => point.value.count)).toEqual([1]);
    expect(durations[0]?.attributes).toMatchObject({ 'rpc.method': 'reads.squadrons', 'rpc.response.status_code': 'OK' });
  });

  it('records a name the console has no read for as one unknown read, so a made-up name adds no series', async () => {
    telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });

    await read('made-up');

    const [duration] = await callDurations();
    expect(duration?.attributes).toMatchObject({ 'rpc.method': 'reads.unknown', 'rpc.response.status_code': '404' });
  });

  it("records each request Next.js serves in the request duration histogram, by its route, method and status", async () => {
    telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });

    nextRequest({ 'http.method': 'GET', 'http.status_code': 200, 'http.route': '/inbox' });

    const requests = await durationsOf('http.server.request.duration');
    expect(requests.map((point) => point.attributes)).toEqual([{ 'http.request.method': 'GET', 'http.route': '/inbox', 'http.response.status_code': 200 }]);
  });

  it('records a request Next.js failed with its error type, and one without a route without one', async () => {
    telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });

    nextRequest({ 'http.method': 'GET', 'http.status_code': 500 });

    const requests = await durationsOf('http.server.request.duration');
    expect(requests.map((point) => point.attributes)).toEqual([{ 'http.request.method': 'GET', 'http.response.status_code': 500, 'error.type': '500' }]);
  });

  it('records no request for any other span', async () => {
    telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });

    await read('squadrons');

    expect(await durationsOf('http.server.request.duration')).toEqual([]);
  });
});
