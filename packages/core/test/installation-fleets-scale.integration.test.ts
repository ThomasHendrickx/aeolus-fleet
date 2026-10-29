import type { FleetId } from "@aeolus-fleet/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { Prisma } from "../src/adapters/prisma/generated/client.js";
import { installationFleetsStatement } from "../src/adapters/prisma/installation.js";
import { messageWindow } from "../src/domain/registry/installation-fleet.js";
import { unwrap } from "../src/testing/result.js";
import { withOperatorLogin } from "./support/operator-login.js";
import {
  createPostgresCore,
  type PostgresCore,
} from "./support/postgres-core.js";

// The installation's figures on a fleet as busy as the scale fleet: on
// staging, counting the messages of the last 7 times 24 hours took 110 ms of
// the read, 189,323 index entries each checked against the heap, as the
// newest week is not yet all-visible. The whole UTC days after the window's
// first come from message_days, which each send adds to; only the first,
// partial day is counted from the messages. The plan is asserted, not a time.

/** About the scale fleet's messages a day. */
const MESSAGES_PER_DAY = 27_000;
const DAYS = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const SPACING_MS = DAY_MS / MESSAGES_PER_DAY;

let core: PostgresCore;
let fleetId: FleetId;
let start: Date;

/** One message every `SPACING_MS` over the days up to now, each counted on its UTC day as a send counts it. */
async function seedMessages(): Promise<void> {
  await core.prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    VALUES ('shp_' || lpad('1', 26, '0'), ${fleetId}, 'scout', 'agent', ${start}, 'agent', '{}')`;
  await core.prisma.$executeRaw`
    INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_ship_id, payload, content_type, idempotency_key, request_hash, created_at)
    SELECT 'msg_' || lpad(i::text, 26, '0'), ${fleetId}, 'shp_' || lpad('1', 26, '0'), 'ship', 'shp_' || lpad('1', 26, '0'), 'hello', 'text/plain', 'key' || i, 'hash',
           ${start}::timestamptz + i * ${SPACING_MS}::float8 * interval '1 millisecond'
    FROM generate_series(1, ${DAYS * MESSAGES_PER_DAY}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO message_days (fleet_id, day, messages, payload_bytes)
    SELECT fleet_id, (created_at AT TIME ZONE 'UTC')::date, count(*), 5 * count(*) FROM messages WHERE fleet_id = ${fleetId} GROUP BY 1, 2
    ON CONFLICT (fleet_id, day) DO UPDATE SET messages = message_days.messages + EXCLUDED.messages, payload_bytes = message_days.payload_bytes + EXCLUDED.payload_bytes`;
  await core.prisma.$executeRaw`ANALYZE`;
}

beforeAll(async () => {
  core = await createPostgresCore();
  fleetId = unwrap(
    await withOperatorLogin(
      core.prisma,
      core.useCases.initialiseFleet({ name: "home fleet" }),
    ),
  ).fleetId;
  start = new Date(core.clock.now().getTime() - DAYS * DAY_MS);
  await seedMessages();
}, 300_000);

afterAll(async () => {
  await core.close();
});

describe("the installation's figures of a busy fleet", () => {
  it("count the messages of the last 7 times 24 hours", async () => {
    const window = messageWindow(core.clock.now());

    const [row] = z
      .array(z.object({ messagesSince: z.coerce.number() }))
      .parse(
        await core.prisma.$queryRaw(
          installationFleetsStatement(fleetId, window),
        ),
      );

    // The seed's messages sent at or after the window's start: the last 7 of its 8 days, to the spacing.
    const first = Math.ceil(
      (window.since.getTime() - start.getTime()) / SPACING_MS,
    );
    expect(row?.messagesSince).toBe(DAYS * MESSAGES_PER_DAY - first + 1);
  });

  it("read from the messages at most the first, partial day of the window", async () => {
    const plan = (
      await core.prisma.$queryRaw<{ "QUERY PLAN": string }[]>(
        Prisma.sql`EXPLAIN ${installationFleetsStatement(fleetId, messageWindow(core.clock.now()))}`,
      )
    )
      .map((row) => row["QUERY PLAN"])
      .join("\n");

    const messageRows = [
      ...plan.matchAll(/Scan\b[^\n]* on messages\b[^\n]*?rows=(\d+)/g),
    ].map((match) => Number(match[1]));
    expect(messageRows.length).toBeGreaterThan(0);
    expect(Math.max(...messageRows)).toBeLessThanOrEqual(MESSAGES_PER_DAY);
  });
});
