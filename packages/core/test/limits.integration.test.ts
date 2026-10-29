import { SCOPES, type FleetId, type ShipId } from "@aeolus-fleet/common";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createPrismaClient,
  type PrismaClient,
} from "../src/adapters/prisma/client.js";
import { createApp } from "../src/app.js";
import type { ShipCaller } from "../src/domain/shared/caller.js";
import type { AppRouter } from "../src/index.js";
import { createUseCases, type UseCases } from "../src/wiring.js";
import { agentCaller, FLEET_URL, OPERATOR } from "./support/core-fixtures.js";
import { createMigratedDatabase } from "../src/testing/database.js";
import { newKey } from "../src/testing/keys.js";
import { createTestClock } from "./support/postgres-core.js";
import { unwrap } from "../src/testing/result.js";
import { withOperatorLogin } from "./support/operator-login.js";
import { NO_INSTALLATION_SETTINGS } from "../src/domain/registry/limits.js";

// Limits as fleet settings, from HTTP to Postgres and back: the installation
// sets them, the console reads them, and commission, send, schedule and
// create are refused exactly at them, however many race for the last place.

const INSTALLATION_TOKEN = "aeolus_installation_test_0123456789abcdef";
const MODEL = "claude-opus-5-5";
const clock = createTestClock("2026-10-04T12:00:00.000Z");

let database: PrismaClient;
let core: UseCases;
let server: FastifyInstance;
let address: string;
let homeFleet: FleetId;
let homeArgo: ShipId;

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  core = createUseCases({ prisma: database, clock });
  ({ fleetId: homeFleet, operatorShipId: homeArgo } = unwrap(
    await withOperatorLogin(
      database,
      core.initialiseFleet({ name: "home fleet" }),
    ),
  ));
  server = createApp({
    databaseUrl,
    publicUrl: FLEET_URL,
    clock,
    logger: false,
    installationToken: INSTALLATION_TOKEN,
  });
  address = await server.listen({ host: "127.0.0.1", port: 0 });
});

beforeEach(async () => {
  await installation().settings.set.mutate({
    ...NO_INSTALLATION_SETTINGS,
    defaultShipLimit: null,
    defaultDailyMessageLimit: null,
    fleetCap: null,
  });
});

afterAll(async () => {
  await server.close();
  await database.$disconnect();
});

function installation() {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${address}/trpc`,
        headers: { "x-aeolus-installation-token": INSTALLATION_TOKEN },
      }),
    ],
  }).installation;
}

function argoOf(fleet: {
  fleetId: FleetId;
  operatorShipId: ShipId;
}): ShipCaller {
  return {
    fleetId: fleet.fleetId,
    shipId: fleet.operatorShipId,
    kind: "operator",
    scopes: [...SCOPES],
  };
}

/** A fleet of its own for a test, created through the installation. */
async function newFleet(name: string) {
  return installation().fleets.create.mutate({
    requestId: newKey(),
    name,
    operatorEmail: `${name}@example.com`,
  });
}

/** A crewed agent ship of the fleet, as a caller of the use cases and as a tRPC client with its crew token. */
async function crewedScout(fleet: {
  fleetId: FleetId;
  operatorShipId: ShipId;
}) {
  const { shipId, secret } = unwrap(
    await core.commissionShip(argoOf(fleet), {
      idempotencyKey: newKey(),
      name: "scout",
      type: "reviewer",
    }),
  );
  const { crewToken } = unwrap(
    await core.claimShip({
      shipId,
      secret: secret ?? "",
      location: { kind: "CLOUD" },
      harness: "claude-code",
    }),
  );
  const asScout = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${address}/trpc`,
        headers: { authorization: `Bearer ${crewToken}` },
      }),
    ],
  });
  return { scout: agentCaller({ fleetId: fleet.fleetId, shipId }), asScout };
}

/** A once schedule to argo, a day ahead of the test clock. */
function aSchedule() {
  return {
    selector: { kind: "ship" as const, name: "argo" },
    payload: "Check in",
    model: MODEL,
    idempotencyKey: newKey(),
    timing: { kind: "once" as const, at: new Date("2026-10-05T12:00:00.000Z") },
  };
}

/** The tRPC error code and message a call fails with; undefined when it succeeds. */
async function refusalOf(
  call: Promise<unknown>,
): Promise<{ code: string | undefined; message: string } | undefined> {
  try {
    await call;
  } catch (error) {
    if (error instanceof TRPCClientError) {
      return {
        code: z.object({ code: z.string() }).safeParse(error.data).data?.code,
        message: error.message,
      };
    }
    throw error;
  }
  return undefined;
}

describe("the installation's settings", () => {
  it("are no limit and no retention until set, and keep what is set", async () => {
    await expect(installation().settings.get.query()).resolves.toEqual({
      ...NO_INSTALLATION_SETTINGS,
      defaultShipLimit: null,
      defaultDailyMessageLimit: null,
      defaultRetentionDays: null,
      fleetCap: null,
    });
    const settings = {
      defaultShipLimit: 10,
      defaultDailyMessageLimit: 1000,
      defaultSchedulesPerShipLimit: 20,
      defaultMinimumScheduleInterval: 300,
      defaultRetentionDays: 30,
      fleetCap: 50,
    };

    await installation().settings.set.mutate(settings);

    await expect(installation().settings.get.query()).resolves.toEqual(
      settings,
    );
  });

  it("refuse a default retention of 0 days as a bad request", async () => {
    await expect(
      installation().settings.set.mutate({
        ...NO_INSTALLATION_SETTINGS,
        defaultRetentionDays: 0,
      }),
    ).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
  });
});

describe("a fleet's limits", () => {
  it("follow the defaults until set for the fleet, and go back to them", async () => {
    const { fleetId } = await newFleet("limited");
    await installation().settings.set.mutate({
      ...NO_INSTALLATION_SETTINGS,
      defaultShipLimit: 10,
      defaultDailyMessageLimit: 1000,
      defaultRetentionDays: 30,
      fleetCap: null,
    });

    await expect(
      installation().fleets.setLimits.mutate({
        fleetId,
        ships: { kind: "fleet", limit: 25 },
        dailyMessages: { kind: "fleet", limit: null },
        schedulesPerShip: { kind: "fleet", limit: 3 },
        minimumScheduleInterval: { kind: "fleet", limit: 600 },
        retention: { kind: "fleet", days: 7 },
      }),
    ).resolves.toEqual({
      fleetId,
      ships: { setting: { kind: "fleet", limit: 25 }, applies: 25 },
      dailyMessages: { setting: { kind: "fleet", limit: null }, applies: null },
      schedulesPerShip: { setting: { kind: "fleet", limit: 3 }, applies: 3 },
      minimumScheduleInterval: {
        setting: { kind: "fleet", limit: 600 },
        applies: 600,
      },
      retention: { setting: { kind: "fleet", days: 7 }, applies: 7 },
    });
    await expect(
      installation().fleets.get.query({ fleetId }),
    ).resolves.toMatchObject({
      limits: {
        schedulesPerShip: { applies: 3 },
        minimumScheduleInterval: { applies: 600 },
      },
    });
    await installation().fleets.setLimits.mutate({
      fleetId,
      ships: { kind: "default" },
      retention: { kind: "default" },
    });
    await expect(
      installation().fleets.limits.query({ fleetId }),
    ).resolves.toMatchObject({
      ships: { setting: { kind: "default" }, applies: 10 },
      retention: { setting: { kind: "default" }, applies: 30 },
    });
  });

  it("keep a fleet's own retention of none while the default keeps 30 days", async () => {
    const { fleetId } = await newFleet("kept");
    await installation().settings.set.mutate({
      ...NO_INSTALLATION_SETTINGS,
      defaultRetentionDays: 30,
    });

    await installation().fleets.setLimits.mutate({
      fleetId,
      retention: { kind: "fleet", days: null },
    });

    await expect(
      installation().fleets.get.query({ fleetId }),
    ).resolves.toMatchObject({
      limits: {
        retention: { setting: { kind: "fleet", days: null }, applies: null },
      },
    });
  });

  it("refuse a fleet's retention of 0 days as a bad request", async () => {
    const { fleetId } = await newFleet("unkept");

    await expect(
      installation().fleets.setLimits.mutate({
        fleetId,
        retention: { kind: "fleet", days: 0 },
      }),
    ).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
  });

  it("are read by the console with what each counts", async () => {
    await installation().settings.set.mutate({
      ...NO_INSTALLATION_SETTINGS,
      defaultShipLimit: 10,
      defaultDailyMessageLimit: 1000,
      defaultRetentionDays: 30,
      fleetCap: null,
    });
    const signedIn = await fetch(`${address}/trpc/console.signIn`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: new URL(FLEET_URL).origin,
      },
      body: JSON.stringify(OPERATOR),
    });
    const cookie = signedIn.headers.get("set-cookie")?.split(";")[0] ?? "";
    const console = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: `${address}/trpc`, headers: { cookie } })],
    });

    const limits = await console.fleet.limits.query();

    expect(limits.ships.limit).toBe(10);
    expect(limits.ships.count).toBe(
      await database.ship.count({
        where: { fleetId: homeFleet, retiredAt: null },
      }),
    );
    expect(limits.dailyMessages).toMatchObject({
      limit: 1000,
      resetsAt: "2026-10-05T00:00:00.000Z",
    });
    expect(limits.retention).toEqual({ days: 30, keptFrom: null });
  });

  it("are read with where the fleet's finished history begins once a pruning pass let older history go", async () => {
    await installation().settings.set.mutate({
      ...NO_INSTALLATION_SETTINGS,
      defaultShipLimit: null,
      defaultDailyMessageLimit: null,
      defaultRetentionDays: 30,
      fleetCap: null,
    });
    await database.$executeRaw`UPDATE fleets SET kept_from = ${new Date("2026-09-04T11:00:00.000Z")} WHERE id = ${homeFleet}`;

    await expect(
      core.readFleetLimits(
        argoOf({ fleetId: homeFleet, operatorShipId: homeArgo }),
      ),
    ).resolves.toMatchObject({
      retention: { days: 30, keptFrom: new Date("2026-09-04T11:00:00.000Z") },
    });
  });
});

describe("the limits at their boundary", () => {
  it("commission ships up to the limit, argo included, however many race, and refuse the rest saying so", async () => {
    const fleet = await newFleet("shipyard");
    await installation().fleets.setLimits.mutate({
      fleetId: fleet.fleetId,
      ships: { kind: "fleet", limit: 4 },
    });

    const results = await Promise.all(
      Array.from({ length: 6 }, (_unused, index) =>
        core.commissionShip(argoOf(fleet), {
          idempotencyKey: newKey(),
          name: `ship-${String(index)}`,
          type: "reviewer",
        }),
      ),
    );

    expect(results.filter((result) => result.isOk)).toHaveLength(3);
    expect(
      results.flatMap((result) => (result.isOk ? [] : [result.error])),
    ).toEqual(
      Array.from({ length: 3 }, () => ({
        kind: "SHIP_LIMIT_REACHED",
        message:
          "The fleet is at its limit of 4 ships, so it takes no new one.",
      })),
    );
    await expect(
      database.ship.count({
        where: { fleetId: fleet.fleetId, retiredAt: null },
      }),
    ).resolves.toBe(4);
  });

  it("take sends up to the daily limit however many race, store nothing more, and refuse over HTTP saying so", async () => {
    const fleet = await newFleet("busy");
    await installation().fleets.setLimits.mutate({
      fleetId: fleet.fleetId,
      dailyMessages: { kind: "fleet", limit: 3 },
    });
    const argo = argoOf(fleet);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        core.sendMessage(argo, {
          selector: { kind: "ship", name: "argo" },
          payload: "Note",
          idempotencyKey: newKey(),
        }),
      ),
    );

    expect(results.filter((result) => result.isOk)).toHaveLength(3);
    await expect(
      database.message.count({ where: { fleetId: fleet.fleetId } }),
    ).resolves.toBe(3);
    const { shipId, secret } = unwrap(
      await core.commissionShip(argo, {
        idempotencyKey: newKey(),
        name: "scout",
        type: "reviewer",
      }),
    );
    const { crewToken } = unwrap(
      await core.claimShip({
        shipId,
        secret: secret ?? "",
        location: { kind: "CLOUD" },
        harness: "claude-code",
      }),
    );
    const asScout = createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: `${address}/trpc`,
          headers: { authorization: `Bearer ${crewToken}` },
        }),
      ],
    });
    await expect(
      refusalOf(
        asScout.ship.send.mutate({
          selector: { kind: "ship", name: "argo" },
          payload: "Done",
          model: MODEL,
          idempotencyKey: newKey(),
        }),
      ),
    ).resolves.toEqual({
      code: "FORBIDDEN",
      message:
        "The fleet reached its limit of 3 messages today (UTC), so nothing was stored. Sending works again after 00:00 UTC.",
    });
    await expect(
      database.message.count({ where: { fleetId: fleet.fleetId } }),
    ).resolves.toBe(3);
  });

  it("refuse a send once the day's counted messages are at the daily limit, and read that count", async () => {
    const fleet = await newFleet("counted");
    await installation().fleets.setLimits.mutate({
      fleetId: fleet.fleetId,
      dailyMessages: { kind: "fleet", limit: 3 },
    });
    // Today counted at the limit, with no message rows behind it.
    await database.$executeRaw`INSERT INTO message_days (fleet_id, day, messages, payload_bytes) VALUES (${fleet.fleetId}, '2026-10-04', 3, 12)`;

    const refused = await core.sendMessage(argoOf(fleet), {
      selector: { kind: "ship", name: "argo" },
      payload: "Note",
      idempotencyKey: newKey(),
    });

    expect(refused).toMatchObject({
      isOk: false,
      error: { kind: "MESSAGE_LIMIT_REACHED" },
    });
    await expect(core.readFleetLimits(argoOf(fleet))).resolves.toMatchObject({
      dailyMessages: { limit: 3, count: 3 },
    });
  });

  it("create fleets up to the cap however many race, and refuse the rest", async () => {
    const hosted = await database.fleet.count();
    await installation().settings.set.mutate({
      ...NO_INSTALLATION_SETTINGS,
      defaultShipLimit: null,
      defaultDailyMessageLimit: null,
      fleetCap: hosted + 2,
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, (_unused, index) =>
        refusalOf(
          installation().fleets.create.mutate({
            requestId: newKey(),
            name: `capped-${String(index)}`,
            operatorEmail: `capped-${String(index)}@example.com`,
          }),
        ),
      ),
    );

    expect(results.filter((result) => result === undefined)).toHaveLength(2);
    expect(results.filter((result) => result !== undefined)).toEqual(
      Array.from({ length: 3 }, () => ({
        code: "FORBIDDEN",
        message: `The installation is at its cap of ${String(hosted + 2)} fleets, so it creates no new one.`,
      })),
    );
    await expect(database.fleet.count()).resolves.toBe(hosted + 2);
  });

  it("make a ship's schedules up to the schedules per ship limit however many race, and refuse the rest saying so", async () => {
    const fleet = await newFleet("scheduled");
    await installation().fleets.setLimits.mutate({
      fleetId: fleet.fleetId,
      schedulesPerShip: { kind: "fleet", limit: 3 },
    });
    const { scout } = await crewedScout(fleet);

    const results = await Promise.all(
      Array.from({ length: 6 }, () => core.scheduleMessage(scout, aSchedule())),
    );

    expect(results.filter((result) => result.isOk)).toHaveLength(3);
    expect(
      results.flatMap((result) => (result.isOk ? [] : [result.error])),
    ).toEqual(
      Array.from({ length: 3 }, () => ({
        kind: "SCHEDULE_LIMIT_REACHED",
        message:
          "The ship holds its fleet's limit of 3 schedules, active or paused: cancel one to make another",
      })),
    );
    await expect(
      database.schedule.count({ where: { fleetId: fleet.fleetId } }),
    ).resolves.toBe(3);
  });

  it("count a ship's paused schedules and not its cancelled ones, and refuse one more over HTTP saying so", async () => {
    const fleet = await newFleet("paused");
    await installation().fleets.setLimits.mutate({
      fleetId: fleet.fleetId,
      schedulesPerShip: { kind: "fleet", limit: 2 },
    });
    const { scout, asScout } = await crewedScout(fleet);
    const paused = unwrap(await core.scheduleMessage(scout, aSchedule()));
    unwrap(await core.pauseSchedule(scout, paused));
    unwrap(
      await core.cancelSchedule(
        scout,
        unwrap(await core.scheduleMessage(scout, aSchedule())),
      ),
    );
    unwrap(await core.scheduleMessage(scout, aSchedule()));

    await expect(
      refusalOf(
        asScout.ship.schedule.mutate({
          ...aSchedule(),
          timing: { kind: "once", at: "2026-10-05T12:00:00.000Z" },
        }),
      ),
    ).resolves.toEqual({
      code: "FORBIDDEN",
      message:
        "The ship holds its fleet's limit of 2 schedules, active or paused: cancel one to make another",
    });
  });

  it("take a repeat of the minimum schedule interval and refuse a shorter one over HTTP saying so", async () => {
    const fleet = await newFleet("interval");
    await installation().fleets.setLimits.mutate({
      fleetId: fleet.fleetId,
      minimumScheduleInterval: { kind: "fleet", limit: 3600 },
    });
    const { asScout } = await crewedScout(fleet);
    const repeat = (every: string) =>
      asScout.ship.schedule.mutate({
        ...aSchedule(),
        timing: { kind: "every", every },
      });

    expect((await repeat("PT1H")).scheduleId).toMatch(/^sch_/);
    await expect(refusalOf(repeat("PT30M"))).resolves.toEqual({
      code: "FORBIDDEN",
      message:
        "The fleet's send times of a repeating schedule are at least 3600 seconds apart: every PT30M is 1800 seconds",
    });
  });

  it("change nothing while none is set", async () => {
    const argo: ShipCaller = {
      fleetId: homeFleet,
      shipId: homeArgo,
      kind: "operator",
      scopes: [...SCOPES],
    };

    const sends = await Promise.all(
      Array.from({ length: 5 }, () =>
        core.sendMessage(argo, {
          selector: { kind: "ship", name: "argo" },
          payload: "Note",
          idempotencyKey: newKey(),
        }),
      ),
    );

    expect(sends.every((result) => result.isOk)).toBe(true);
  });
});
