/**
 * Measures one HTTP request: a point in the request duration histogram, by
 * its route, method and status. A tRPC batch is one request for several
 * procedures, each of them measured as a call too (calls.ts). Through the
 * OpenTelemetry API alone, as calls are.
 */
import { metrics, type Attributes } from '@opentelemetry/api';

import { INSTRUMENTATION_SCOPE, MS_PER_S, SERVER_DURATION_BOUNDARIES_S } from './calls.js';

/** The semantic conventions' name for an HTTP request's duration on the server, in seconds. */
const REQUEST_DURATION = 'http.server.request.duration';

const FIRST_SERVER_FAILURE_STATUS = 500;

export interface AnsweredRequest {
  method: string;
  /** The route template that matched, such as `/trpc/:path`; undefined when none did. */
  route: string | undefined;
  statusCode: number;
  durationMs: number;
}

export function measureRequest(request: AnsweredRequest): void {
  const attributes: Attributes = {
    'http.request.method': request.method,
    ...(request.route === undefined ? {} : { 'http.route': request.route }),
    'http.response.status_code': request.statusCode,
    ...(request.statusCode >= FIRST_SERVER_FAILURE_STATUS ? { 'error.type': String(request.statusCode) } : {}),
  };
  metrics
    .getMeter(INSTRUMENTATION_SCOPE)
    .createHistogram(REQUEST_DURATION, {
      unit: 's',
      description: 'How long each HTTP request took on the server, by route, method and status',
      advice: { explicitBucketBoundaries: SERVER_DURATION_BOUNDARIES_S },
    })
    .record(request.durationMs / MS_PER_S, attributes);
}
