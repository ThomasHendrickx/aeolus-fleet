import { context, metrics, propagation, trace } from '@opentelemetry/api';
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

/** The duration histogram's points, after a collect. */
async function callDurations() {
  await metricReader.forceFlush();
  return points
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics))
    .filter((metric): metric is HistogramMetricData => metric.descriptor.name === 'rpc.server.call.duration' && metric.dataPointType === DataPointType.HISTOGRAM)
    .flatMap((metric) => metric.dataPoints);
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
});
