/** Server-only plugin boundary. Mount only on a separate internal listener, never a public cookie endpoint. */
import { createHash, timingSafeEqual } from 'node:crypto';

import type { FleetId, ShipId } from './ids/index.js';
import { pluginCallContextSchema, type PluginCallContext, type PluginRefusalCode } from './schemas/plugin-call.js';
import type { z } from 'zod';
import type { pluginCallAnswerSchema } from './schemas/plugin-call.js';

type Answer = z.infer<typeof pluginCallAnswerSchema>;

/** Plugin storage must atomically reserve the tuple durably before returning true, through expiresAt. */
export interface PluginDispatchReservations {
  reserve(context: PluginCallContext): Promise<boolean>;
}

export interface PluginBoundaryOptions {
  pluginShipId: ShipId;
  /** Current and, during rotation, next deployment secret. Never actor credentials. */
  secrets: readonly string[];
  now(): Date;
  serves(fleetId: FleetId): Promise<boolean>;
  reservations: PluginDispatchReservations;
  /** Only deliberately exposed operations. Each validates input, scopes and storage in its own transaction. */
  procedures: Readonly<Record<string, (context: PluginCallContext) => Promise<Answer>>>;
}

export interface PluginBoundaryRequest {
  body: unknown;
  secret: string | undefined;
  /** Derived by the receiving server's listener/network policy, never a request field or forwarded header. */
  isInternal: boolean;
  /** True on any public cookie endpoint, even when a secret header is supplied. */
  isPublic: boolean;
}

function refusal(code: PluginRefusalCode): Answer {
  return { error: { data: { code } } };
}

/** Hash to fixed-size buffers so even unequal-length supplied secrets use a constant-time comparison. */
function matches(secret: string, accepted: readonly string[]): boolean {
  const hash = (value: string) => createHash('sha256').update(value).digest();
  const supplied = hash(secret);
  let found = 0;
  for (const candidate of accepted) {
    found |= Number(timingSafeEqual(supplied, hash(candidate)));
  }
  return found !== 0;
}

export function createPluginBoundary(options: PluginBoundaryOptions) {
  return async (request: PluginBoundaryRequest): Promise<Answer> => {
    if (request.isPublic || !request.isInternal || request.secret === undefined || !matches(request.secret, options.secrets)) {
      return refusal('UNAUTHORIZED');
    }
    const parsed = pluginCallContextSchema.safeParse(request.body);
    if (!parsed.success) return refusal('BAD_REQUEST');
    const context = parsed.data;
    const remaining = Date.parse(context.expiresAt) - options.now().getTime();
    if (context.pluginShipId !== options.pluginShipId || remaining <= 0 || remaining > 30_000) return refusal('UNAUTHORIZED');
    if (!(await options.serves(context.fleetId))) return refusal('PRECONDITION_FAILED');
    // Own properties only: names such as constructor and toString never expose inherited code.
    const procedure = Object.hasOwn(options.procedures, context.procedure) ? options.procedures[context.procedure] : undefined;
    if (procedure === undefined) return refusal('NOT_FOUND');
    try {
      if (!(await options.reservations.reserve(context))) return refusal('CONFLICT');
      // Storage admission may wait for another transaction. Its wait cannot extend this dispatch.
      if (Date.parse(context.expiresAt) <= options.now().getTime()) return refusal('UNAUTHORIZED');
      return await procedure(context);
    } catch {
      // No input, secret, credentials or upstream diagnostic crosses the boundary.
      return refusal('INTERNAL_SERVER_ERROR');
    }
  };
}
