import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { AggregationTemporality, DataPointType, InMemoryMetricExporter, PeriodicExportingMetricReader, type HistogramMetricData, type SumMetricData } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { startTelemetry, type Telemetry } from '../src/adapters/telemetry/telemetry.js';
import { createApp } from '../src/app.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { unwrap } from '../src/testing/result.js';
import { FLEET_URL, operatorCaller } from './support/core-fixtures.js';
import { createPostgresCore, createTestClock } from './support/postgres-core.js';

// The database queries a call makes, on a real Postgres: each is traced under
// the call's span and measured in the query duration histogram.

/** Long enough that only the test's own collect exports. */
const EXPORT_INTERVAL_MS = 3_600_000;
const CONSOLE = new URL(FLEET_URL).origin;

let server: FastifyInstance;
let telemetry: Telemetry | undefined;
const spans = new InMemorySpanExporter();
const points = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const metricReader = new PeriodicExportingMetricReader({ exporter: points, exportIntervalMillis: EXPORT_INTERVAL_MS });

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  telemetry = await startTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' }, { spanExporter: spans, metricReader });
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, clock: createTestClock('2026-10-22T12:00:00.000Z'), logger: false });
  // A sign-in the database refuses: it looks the operator up, and finds none.
  await server.inject({
    method: 'POST',
    url: '/trpc/console.signIn',
    headers: { origin: CONSOLE, 'content-type': 'application/json' },
    payload: { email: 'nobody@example.com', password: 'not a password' },
  });
});

afterAll(async () => {
  await server.close();
  await telemetry?.shutdown();
  trace.disable();
  metrics.disable();
  context.disable();
  propagation.disable();
});

it('traces each query under the span of the call that made it', async () => {
  await expect.poll(() => spans.getFinishedSpans().some((span) => span.name === 'console.signIn')).toBe(true);

  const finished = spans.getFinishedSpans();
  const call = finished.find((span) => span.name === 'console.signIn');
  const queries = finished.filter((span) => span.name === 'prisma:client:operation');
  expect(queries).not.toEqual([]);
  expect(queries.every((query) => query.parentSpanContext?.spanId === call?.spanContext().spanId)).toBe(true);
});

it('records each query as a point in the query duration histogram, by its operation', async () => {
  await metricReader.forceFlush();

  const queryDurations = points
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics))
    .filter((metric): metric is HistogramMetricData => metric.descriptor.name === 'db.client.operation.duration' && metric.dataPointType === DataPointType.HISTOGRAM)
    .flatMap((metric) => metric.dataPoints);
  expect(queryDurations).not.toEqual([]);
  expect(queryDurations.every((point) => point.attributes['db.system.name'] === 'postgresql' && typeof point.attributes['db.operation.name'] === 'string')).toBe(true);
});

it('the counter adds one per failed read', async () => {
  const core = await createPostgresCore();
  try {
    const fleet = unwrap(await core.useCases.initialiseFleet({ name: 'metric fleet' }));
    const argo = operatorCaller(fleet);
    const { shipId: pluginShipId } = unwrap(await core.useCases.commissionShip(argo, {
      name: 'plugin-for-metrics', type: 'trierarch-plugin', kind: 'plugin', idempotencyKey: 'metric-plugin',
    }));
    const read = { pluginShipId, read: 'guard.get' };
    const failure = { ...read, outcome: 'failed', reason: 'timeout' } as const;

    unwrap(await core.useCases.recordPluginRead(argo, failure));
    unwrap(await core.useCases.recordPluginRead(argo, failure));
    unwrap(await core.useCases.recordPluginRead(argo, { ...read, outcome: 'good' }));
    await metricReader.forceFlush();

    const counter = points.getMetrics().at(-1)?.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((metric): metric is SumMetricData => metric.descriptor.name === 'aeolus.plugin_read.failed' && metric.dataPointType === DataPointType.SUM);
    expect(counter?.descriptor.unit).toBe('{read}');
    expect(counter?.dataPoints.map(({ value, attributes }) => ({ value, attributes }))).toEqual([
      { value: 2, attributes: { plugin: 'trierarch-plugin', read: 'guard.get', reason: 'timeout' } },
    ]);
  } finally {
    await core.close();
  }
});
