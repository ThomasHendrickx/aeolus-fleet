import { idSchema, type ShipId } from "@aeolus-fleet/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPrismaHealthSnapshots } from "../src/adapters/prisma/health-snapshots.js";
import type { ShipCaller } from "../src/domain/shared/caller.js";
import { newKey } from "../src/testing/keys.js";
import { unwrap } from "../src/testing/result.js";
import { operatorCaller, secretOf } from "./support/core-fixtures.js";
import { withOperatorLogin } from "./support/operator-login.js";
import {
  createPostgresCore,
  type PostgresCore,
} from "./support/postgres-core.js";

// The stuck reads load only the ships and leases their open deliveries touch
// (performance design, decision 2), never every ship of the fleet.

let core: PostgresCore;
let argo: ShipCaller;

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(
    unwrap(
      await withOperatorLogin(
        core.prisma,
        core.useCases.initialiseFleet({ name: "home fleet" }),
      ),
    ),
  );
});

afterEach(async () => {
  await core.close();
});

async function crewed(
  name: string,
  type: string,
): Promise<{ shipId: ShipId; leaseId: string }> {
  const { shipId, secret } = unwrap(
    await core.useCases.commissionShip(argo, {
      idempotencyKey: newKey(),
      name,
      type,
    }),
  );
  unwrap(
    await core.useCases.claimShip({
      shipId,
      secret: secretOf(secret),
      location: { kind: "CLOUD" },
      harness: "claude-code",
    }),
  );
  const lease = await core.prisma.lease.findFirstOrThrow({
    where: { shipId, endedAt: null },
  });
  return { shipId, leaseId: lease.id };
}

describe("the crews a stuck read touches, on Postgres", () => {
  it("reads the ships by id, by type and of the leases named, with their leases, and no other ship", async () => {
    const scout = await crewed("scout", "reviewer");
    const planner = await crewed("planner", "planner");
    const holder = await crewed("holder", "keeper");
    await crewed("bystander", "keeper");
    const holderLease = await core.prisma.lease.findFirstOrThrow({
      where: { shipId: holder.shipId },
    });

    const crews = await createPrismaHealthSnapshots(core.prisma).crewsTouching(
      argo.fleetId,
      {
        since: new Date(0),
        touched: {
          shipIds: [scout.shipId],
          types: ["planner"],
          leaseIds: [idSchema("lease").parse(holderLease.id)],
        },
      },
    );

    expect(crews.ships.map((ship) => ship.name).toSorted()).toEqual([
      "holder",
      "planner",
      "scout",
    ]);
    expect(crews.leases.map((lease) => lease.leaseId).toSorted()).toEqual(
      [scout.leaseId, planner.leaseId, holder.leaseId].toSorted(),
    );
  });

  it("reads nothing when no open delivery touches a crew", async () => {
    await crewed("scout", "reviewer");

    await expect(
      createPrismaHealthSnapshots(core.prisma).crewsTouching(argo.fleetId, {
        since: new Date(0),
        touched: { shipIds: [], types: [], leaseIds: [] },
      }),
    ).resolves.toEqual({
      ships: [],
      leases: [],
    });
  });
});
