import { context, metrics, propagation, SpanStatusCode, trace } from '@opentelemetry/api';
import { AggregationTemporality, DataPointType, InMemoryMetricExporter, PeriodicExportingMetricReader, type HistogramMetricData } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addAgentShip, crewShip, FLEET_URL, historyUseCases, identityUseCases, initialiseFleet, messagingUseCases, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { buildHttpServer } from '../http/server.js';
import { createFleetEventWakeups, fleetEventWakeupsOf } from '../prisma/fleet-event-wakeups.js';
import { createReceiverWakeups } from '../prisma/receiver-wakeups.js';
import { measureCall } from './calls.js';
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
    consoleOrigin: new URL(FLEET_URL).origin,
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

/** A ping from a ship that may read the fleet, so the call is answered. */
function ping() {
  const fleetId = core.state.fleets[0]?.id ?? expect.unreachable();
  const { shipId } = addAgentShip(core, { fleetId, scopes: ['fleet:read'] });
  const crewToken = crewShip(core, { fleetId, shipId });
  return server.inject({ method: 'GET', url: '/trpc/system.ping', headers: { authorization: `Bearer ${crewToken}` } });
}

/** The spans exported so far, once there are any: the SDK exports a span once its resource is known. */
async function finishedSpans() {
  await expect.poll(() => spans.getFinishedSpans()).not.toEqual([]);
  return spans.getFinishedSpans();
}

/** The points of one duration histogram, after a collect of its own: the exporter keeps every earlier collect, which are cumulative. */
async function durationsOf(histogram: string) {
  points.reset();
  await metricReader.forceFlush();
  return points
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics))
    .filter((metric): metric is HistogramMetricData => metric.descriptor.name === histogram && metric.dataPointType === DataPointType.HISTOGRAM)
    .flatMap((metric) => metric.dataPoints);
}

/** The duration histogram's points for one procedure, after a collect. */
async function callDurations(procedure: string) {
  return (await durationsOf('rpc.server.call.duration')).filter((point) => point.attributes['rpc.method'] === procedure);
}

describe('with no OTLP endpoint set', () => {
  it('starts nothing, so a call records nothing', async () => {
    telemetry = await startTelemetry({}, { spanExporter: spans, metricReader });
    start();

    await ping();

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

    await ping();

    const finished = await finishedSpans();
    expect(finished.map((span) => span.name)).toEqual(['system.ping']);
    expect(finished[0]?.attributes).toMatchObject({ 'rpc.system': 'trpc', 'rpc.method': 'system.ping', 'rpc.response.status_code': 'OK' });
  });

  it('records a call as a point in its procedure duration histogram', async () => {
    telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });
    start();

    await ping();

    const durations = await callDurations('system.ping');
    expect(durations.map((point) => point.value.count)).toEqual([1]);
    expect(durations[0]?.attributes).toMatchObject({ 'rpc.response.status_code': 'OK' });
  });

  it('records a refused REST call under its procedure, with its refusal code, and does not mark it an error', async () => {
    telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });
    start();

    await server.inject({ method: 'GET', url: '/api/v1/ship/whoami' });

    const [span] = await finishedSpans();
    expect(span?.attributes['rpc.response.status_code']).toBe('UNAUTHORIZED');
    expect(span?.status.code).not.toBe(SpanStatusCode.ERROR);
    const [duration] = await callDurations('ship.whoami');
    expect(duration?.attributes).toMatchObject({ 'rpc.response.status_code': 'UNAUTHORIZED' });
    expect(duration?.attributes).not.toHaveProperty('error.type');
  });

  it('records a server failure as an error, so the error rate counts it', async () => {
    telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });
    start(() => Promise.reject(new Error('the database went away')));

    await ping();

    const [span] = await finishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    const [duration] = await callDurations('system.ping');
    expect(duration?.attributes).toMatchObject({ 'rpc.response.status_code': 'INTERNAL_SERVER_ERROR', 'error.type': 'INTERNAL_SERVER_ERROR' });
  });

  it('records each HTTP request in the request duration histogram, by its route, method and status', async () => {
    telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });
    start();

    await ping();

    const requests = await durationsOf('http.server.request.duration');
    expect(requests.map((point) => point.attributes)).toEqual([{ 'http.request.method': 'GET', 'http.route': '/trpc/:path', 'http.response.status_code': 200 }]);
  });

  it('records a request the server failed with its error type', async () => {
    telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });
    start(() => Promise.reject(new Error('the database went away')));

    await ping();

    const [request] = await durationsOf('http.server.request.duration');
    expect(request?.attributes).toMatchObject({ 'http.response.status_code': 500, 'error.type': '500' });
  });

  it('records a request to no route without one', async () => {
    telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });
    start();

    await server.inject({ method: 'GET', url: '/no/such/route' });

    const requests = await durationsOf('http.server.request.duration');
    expect(requests.map((point) => point.attributes)).toEqual([{ 'http.request.method': 'GET', 'http.response.status_code': 404 }]);
  });

  describe('a call that waits for a message', () => {
    const WAIT_MS = 120;
    const OK = { code: 'OK', isServerFailure: false };
    const address = { fleetId: 'flt_1', shipId: 'shp_1', type: 'agent' } as const;

    /** The sum, in seconds, of the points of a histogram recorded for one procedure. */
    async function sumOf(histogram: string, procedure: string) {
      const points = (await durationsOf(histogram)).filter((point) => point.attributes['rpc.method'] === procedure);
      return { count: points.reduce((total, point) => total + point.value.count, 0), seconds: points.reduce((total, point) => total + (point.value.sum ?? 0), 0) };
    }

    it('leaves the wait for a receiver out of the call duration and records it apart', async () => {
      telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });
      const watch = createReceiverWakeups().watch(address);

      await measureCall('ship.receive', async () => ({ value: await watch.next(WAIT_MS), outcome: OK }));
      watch.stop();

      const call = await sumOf('rpc.server.call.duration', 'ship.receive');
      const wait = await sumOf('rpc.server.call.wait.duration', 'ship.receive');
      expect(call.count).toBe(1);
      expect(call.seconds).toBeLessThan(WAIT_MS / 2 / 1000);
      expect(wait.count).toBe(1);
      expect(wait.seconds).toBeGreaterThanOrEqual((WAIT_MS - 20) / 1000);
    });

    it('leaves the wait for the fleet news out of the call duration too', async () => {
      telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });
      const watch = fleetEventWakeupsOf(createFleetEventWakeups()).watch('flt_1');

      await measureCall('fleet.follow', async () => ({ value: await watch.next(WAIT_MS), outcome: OK }));
      watch.stop();

      const call = await sumOf('rpc.server.call.duration', 'fleet.follow');
      const wait = await sumOf('rpc.server.call.wait.duration', 'fleet.follow');
      expect(call.seconds).toBeLessThan(WAIT_MS / 2 / 1000);
      expect(wait.seconds).toBeGreaterThanOrEqual((WAIT_MS - 20) / 1000);
    });

    it('records no wait for a call that did not wait', async () => {
      telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });
      start();

      await ping();

      expect(await sumOf('rpc.server.call.wait.duration', 'system.ping')).toEqual({ count: 0, seconds: 0 });
    });
  });

  describe('a wake stream', () => {
    /** The points of a counter, after a collect of its own, by their attributes. */
    async function countsOf(counter: string) {
      points.reset();
      await metricReader.forceFlush();
      return points
        .getMetrics()
        .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics))
        .filter((metric) => metric.descriptor.name === counter && metric.dataPointType === DataPointType.SUM)
        .flatMap((metric) => metric.dataPoints.map((point) => ({ attributes: point.attributes, value: point.value })));
    }

    /** Opens a stream at the REST door and reads up to its first blank line: the open wake. */
    async function openStream(address: string, closing: AbortController) {
      const fleetId = core.state.fleets[0]?.id ?? expect.unreachable();
      const { shipId } = addAgentShip(core, { fleetId });
      const crewToken = crewShip(core, { fleetId, shipId });
      const response = await fetch(`${address}/api/v1/ship/wakeups`, { headers: { authorization: `Bearer ${crewToken}` }, signal: closing.signal });
      const reader = (response.body ?? expect.unreachable()).pipeThrough(new TextDecoderStream()).getReader();
      let read = '';
      const nextWake = async () => {
        while (!read.includes('\n\n')) {
          read += (await reader.read()).value ?? '';
        }
        read = read.slice(read.indexOf('\n\n') + 2);
      };
      await nextWake();
      return { nextWake };
    }

    it('counts the streams open and the wakes sent by reason, apart from every duration histogram', async () => {
      telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });
      start();
      const address = await server.listen({ host: '127.0.0.1', port: 0 });
      const closing = new AbortController();
      const stream = await openStream(address, closing);

      core.wakeStreams.wake('notice');
      await stream.nextWake();

      await expect(countsOf('aeolus.wake_stream.open')).resolves.toEqual([{ attributes: {}, value: 1 }]);
      await expect(countsOf('aeolus.wake_stream.wakes')).resolves.toEqual([
        { attributes: { reason: 'open' }, value: 1 },
        { attributes: { reason: 'notice' }, value: 1 },
      ]);
      closing.abort();
      await expect.poll(async () => countsOf('aeolus.wake_stream.open')).toEqual([{ attributes: {}, value: 0 }]);
      expect(await callDurations('ship.wakeups')).toEqual([]);
      const requests = await durationsOf('http.server.request.duration');
      expect(requests.filter((point) => point.attributes['http.route'] === '/api/v1/ship/wakeups')).toEqual([]);
    });
  });

  describe('a fleet events stream', () => {
    it('stays out of every duration histogram', async () => {
      telemetry = await startTelemetry(ENDPOINT, { spanExporter: spans, metricReader });
      start();
      const address = await server.listen({ host: '127.0.0.1', port: 0 });
      const fleetId = core.state.fleets[0]?.id ?? expect.unreachable();
      const { shipId } = addAgentShip(core, { fleetId, scopes: ['fleet:read'] });
      const crewToken = crewShip(core, { fleetId, shipId });
      const closing = new AbortController();
      const response = await fetch(`${address}/api/v1/fleet/events`, { headers: { authorization: `Bearer ${crewToken}` }, signal: closing.signal });
      const reader = (response.body ?? expect.unreachable()).pipeThrough(new TextDecoderStream()).getReader();
      let read = '';
      while (!read.includes('\n\n')) {
        read += (await reader.read()).value ?? '';
      }

      closing.abort();

      // The stream's request is over once the server holds no connection for it.
      await expect.poll(async () => new Promise<number>((resolve) => server.server.getConnections((_error, count) => { resolve(count); }))).toBe(0);
      const requests = await durationsOf('http.server.request.duration');
      expect(requests.filter((point) => point.attributes['http.route'] === '/api/v1/fleet/events')).toEqual([]);
      expect(await callDurations('fleet.events')).toEqual([]);
    });
  });
});
