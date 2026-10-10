/**
 * The networking plugin's API: one tRPC router, which the console's server
 * calls with the console's session cookie, as squadrons' (decision 0035).
 * Every procedure but the installation's is the operator's: the cookie must
 * be a signed-in console session of a fleet at the fleet's URL, and the
 * procedure works on that fleet. A fleet the networking plugin does not serve
 * (switched off) gets only `connection.status`; only `connection` works
 * before the networking plugin is connected to the fleet. The installation
 * procedures take the installation token instead (decision 0021).
 */
import { timingSafeEqual } from 'node:crypto';

import { idempotencyKeySchema, idSchema, networkRuleSchema, registerNetworkPluginInputSchema, setNetworkRulesInputSchema, WHILE_UNAVAILABLE, type FleetId, type NetworkRule } from '@aeolus-fleet/common';
import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { Connect } from '../../core/connection/connect.js';
import type { ReadConnection } from '../../core/connection/read-connection.js';
import type { DeleteFleet } from '../../core/installation/delete-fleet.js';
import type { InstallationMode } from '../../core/installation/ports.js';
import type { ReadFleet } from '../../core/installation/read-fleet.js';
import type { IsServed } from '../../core/installation/served.js';
import type { SetFleetEnabled } from '../../core/installation/set-fleet-enabled.js';
import type { ReadNetwork } from '../../core/network/read-network.js';
import type { SaveDeclaration } from '../../core/network/save-declaration.js';
import type { SaveRules } from '../../core/network/save-rules.js';
import type { AuthenticateOperator } from '../../core/operator/authenticate-operator.js';

export interface Context {
  /** The Cookie header the console's server forwarded. */
  cookie: string | undefined;
  authenticateOperator: AuthenticateOperator;
  /** Whether the networking plugin is connected to the fleet. */
  isConnected: (fleetId: FleetId) => Promise<boolean>;
  isServed: IsServed;
  /** The fleet's connection as the networking plugin holds it, without asking the fleet: what a fleet that is off reads. */
  heldConnection: ReadConnection;
  /** The installation token header the caller sent, if any. */
  installationTokenSent: string | undefined;
  installation: { mode: InstallationMode; token: string | undefined };
  setFleetEnabled: SetFleetEnabled;
  readFleet: ReadFleet;
  deleteFleet: DeleteFleet;
  readConnection: ReadConnection;
  connect: Connect;
  readNetwork: ReadNetwork;
  saveRules: SaveRules;
  saveDeclaration: SaveDeclaration;
}

/** What a caller reads of a failure: nothing of it, so no crew token, secret or query ever leaves; the log holds it whole. */
export const INTERNAL_ERROR_MESSAGE = 'Internal error';

const t = initTRPC.context<Context>().create({
  isDev: false,
  errorFormatter: ({ shape, error }) => (error.code === 'INTERNAL_SERVER_ERROR' ? { ...shape, message: INTERNAL_ERROR_MESSAGE } : shape),
});

const operatorProcedure = t.procedure.use(async ({ ctx, next }) => {
  const operator = await ctx.authenticateOperator(ctx.cookie);
  if (!operator.isOk) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: operator.error.message });
  }
  return next({ ctx: { fleetId: operator.value.fleetId, scopes: operator.value.scopes } });
});

/**
 * What changes the fleet needs the session's ship to hold fleet:manage: the
 * operator does, a viewer session (fleet:read only, decision 0022) does not,
 * so it is served reads only. Checked before the input is read.
 */
function managing(procedure: typeof operatorProcedure) {
  return procedure.use(({ ctx, next }) => {
    if (!ctx.scopes.includes('fleet:manage')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Needs fleet:manage: a viewer session only reads' });
    }
    return next();
  });
}

/** Whether the token sent is the installation token, compared in constant time. */
function isInstallationToken(sent: string | undefined, token: string): boolean {
  const expected = Buffer.from(token);
  const given = Buffer.from(sent ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The installation's procedures (decision 0021): with no installation token
 * configured they do not exist (NOT_FOUND); with one, the caller presents it
 * in `x-aeolus-installation-token` or is refused (UNAUTHORIZED).
 */
const installationProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (ctx.installation.mode === 'open' || ctx.installation.token === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'No such procedure' });
  }
  if (!isInstallationToken(ctx.installationTokenSent, ctx.installation.token)) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'The installation token is missing or wrong' });
  }
  return next();
});

/** Refuses a fleet the networking plugin does not serve: while it is off, FORBIDDEN. */
async function refuseUnlessServed(ctx: { fleetId: FleetId; isServed: IsServed }): Promise<void> {
  if (!(await ctx.isServed(ctx.fleetId))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'The networking plugin is off for this fleet' });
  }
}

/** The operator's procedures that need the networking plugin to serve their fleet. */
const servedProcedure = operatorProcedure.use(async ({ ctx, next }) => {
  await refuseUnlessServed(ctx);
  return next();
});

/**
 * The network's procedures are argo's alone (Thomas on #260): the session's
 * ship must hold fleet:network, as argo does and a viewer (fleet:read only,
 * decision 0022) does not. Checked before anything else; then the networking
 * plugin must serve the fleet and be connected to it (PRECONDITION_FAILED
 * until then).
 */
const argoProcedure = operatorProcedure.use(async ({ ctx, next }) => {
  if (!ctx.scopes.includes('fleet:network')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only argo sees and edits the network rules' });
  }
  await refuseUnlessServed(ctx);
  if (!(await ctx.isConnected(ctx.fleetId))) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'The networking plugin is not connected to this fleet: connect it in the console' });
  }
  return next();
});

/** The refusals of connecting, as the API states them. */
const CONNECT_CODES = {
  ALREADY_CONNECTED: 'CONFLICT',
  SECRET_REFUSED: 'BAD_REQUEST',
  OTHER_FLEET: 'BAD_REQUEST',
  MISSING_SCOPES: 'BAD_REQUEST',
} as const satisfies Record<string, TRPCError['code']>;

/** What the network answers: the rules, none for all-to-all, and what the plugin declares for while it is unavailable. */
const ruleListSchema = z.array(networkRuleSchema).nullable();
const declarationSchema = z.object({ whileUnavailable: z.enum(WHILE_UNAVAILABLE), notRespondingAfterSeconds: z.int() });

/** A rule list as the API answers it: fresh arrays, none kept as none. */
function listOf(rules: readonly NetworkRule[] | null): NetworkRule[] | null {
  return rules?.map((rule) => ({ from: [...rule.from], to: [...rule.to] })) ?? null;
}

/** What a save did at the fleet: supplied, or waiting for the fleet to answer; `not-connected` and `unregistered` only in a race with a disconnect or a switch. */
const supplySchema = z.enum(['supplied', 'unregistered', 'not-connected', 'waiting']);

/** The refusals of deleting a fleet, as the API states them: retried with the same request id once the fleet answers. */
const DELETE_CODES = {
  REQUEST_ID_USED: 'CONFLICT',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<string, TRPCError['code']>;

/** The connection as the console reads it: whether the networking plugin serves the fleet, and its connection. */
const connectionStatusOutputSchema = z.object({
  enabled: z.boolean(),
  state: z.enum(['not-connected', 'connected']),
  ship: z.object({ shipId: z.string(), name: z.string() }).nullable(),
  lastShipId: z.string().nullable(),
});

export const networkingPluginRouter = t.router({
  connection: t.router({
    /** Whether the networking plugin is connected to the operator's fleet, as which ship, and the ship it was last connected as. */
    status: operatorProcedure.output(connectionStatusOutputSchema).query(async ({ ctx }) => {
      // A fleet that is off is read from what the networking plugin holds: it asks its fleet nothing then.
      const isServed = await ctx.isServed(ctx.fleetId);
      const connection = isServed ? await ctx.readConnection(ctx.fleetId) : await ctx.heldConnection(ctx.fleetId);
      return { enabled: isServed, ...connection };
    }),
    /**
     * Connects the networking plugin with its ship's secret, which the
     * console's server hands over server to server: it registers with it and
     * keeps only the crew token. Only while not connected, and while the
     * networking plugin serves the fleet.
     */
    connect: managing(servedProcedure)
      .input(z.object({ shipId: idSchema('ship'), secret: z.string().min(1) }))
      .output(connectionStatusOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const connected = await ctx.connect({ operatorFleetId: ctx.fleetId, ...input });
        if (!connected.isOk) {
          throw new TRPCError({ code: CONNECT_CODES[connected.error.kind], message: connected.error.message });
        }
        // Answered as connection.status answers: connect works only while the networking plugin serves the fleet.
        return { enabled: true, ...connected.value };
      }),
  }),
  network: t.router({
    /** The fleet's network as argo edits it: the rules and what the plugin declares for while it is unavailable. */
    get: argoProcedure
      .output(z.object({ rules: ruleListSchema, declaration: declarationSchema }))
      .query(async ({ ctx }) => {
        const { rules, declaration } = await ctx.readNetwork(ctx.fleetId);
        return { rules: listOf(rules), declaration };
      }),
    /** Saves argo's rules, the whole list or none for all-to-all, and supplies them to the fleet at once. */
    setRules: argoProcedure
      .input(setNetworkRulesInputSchema)
      .output(z.object({ rules: ruleListSchema, supply: supplySchema }))
      .mutation(async ({ ctx, input }) => {
        const saved = await ctx.saveRules({ fleetId: ctx.fleetId, rules: input.rules });
        if (!saved.isOk) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: saved.error.message });
        }
        return { rules: listOf(saved.value.rules), supply: saved.value.supply };
      }),
    /** Saves what the plugin declares for while it is unavailable, and registers again with it at once. */
    setDeclaration: argoProcedure
      .input(registerNetworkPluginInputSchema)
      .output(z.object({ declaration: declarationSchema, supply: supplySchema }))
      .mutation(({ ctx, input }) => ctx.saveDeclaration({ fleetId: ctx.fleetId, declaration: input })),
  }),
  installation: t.router({
    /** Switches the networking plugin on or off for a fleet; off keeps everything of it. A replayed request id answers its first answer. */
    setEnabled: installationProcedure
      .input(z.strictObject({ requestId: idempotencyKeySchema, fleetId: idSchema('fleet'), enabled: z.boolean() }))
      .output(z.object({ fleetId: z.string(), enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const set = await ctx.setFleetEnabled({ requestId: input.requestId, fleetId: input.fleetId, isEnabled: input.enabled });
        if (!set.isOk) {
          throw new TRPCError({ code: 'CONFLICT', message: set.error.message });
        }
        return { fleetId: set.value.fleetId, enabled: set.value.isEnabled };
      }),
    /** Whether the networking plugin serves the fleet, and whether it is connected to it. */
    get: installationProcedure
      .input(z.strictObject({ fleetId: idSchema('fleet') }))
      .output(z.object({ enabled: z.boolean(), connected: z.boolean() }))
      .query(async ({ ctx, input }) => {
        const fleet = await ctx.readFleet({ fleetId: input.fleetId });
        return { enabled: fleet.isEnabled, connected: fleet.isConnected };
      }),
    /**
     * Unregisters from the fleet, then forgets everything the networking
     * plugin holds of it. Refused while the fleet does not answer. A replayed
     * request id answers its first answer.
     */
    delete: installationProcedure
      .input(z.strictObject({ requestId: idempotencyKeySchema, fleetId: idSchema('fleet') }))
      .output(z.strictObject({}))
      .mutation(async ({ ctx, input }) => {
        const deleted = await ctx.deleteFleet(input);
        if (!deleted.isOk) {
          throw new TRPCError({ code: DELETE_CODES[deleted.error.kind], message: deleted.error.message });
        }
        return {};
      }),
  }),
});

export type NetworkingPluginRouter = typeof networkingPluginRouter;
