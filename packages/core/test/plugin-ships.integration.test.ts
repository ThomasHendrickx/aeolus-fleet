import type { FleetId, ShipId } from "@aeolus-fleet/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createReadReachOf } from "../src/domain/registry/read-reach.js";
import { createPrismaUnitOfWork } from "../src/adapters/prisma/unit-of-work.js";
import type { ShipCaller } from "../src/domain/shared/caller.js";
import { operatorCaller, secretOf } from "./support/core-fixtures.js";
import {
  createPostgresCore,
  type PostgresCore,
} from "./support/postgres-core.js";
import { unwrap } from "../src/testing/result.js";
import { newKey } from "../src/testing/keys.js";
import { withOperatorLogin } from "./support/operator-login.js";

// Plugin ships on a real Postgres (decision 0050): a plugin ship reads every
// ship by its kind, whatever the rules, until a retire of the ship ends it,
// each with its event in the same transaction; a release ends nothing.

let core: PostgresCore;
let fleetId: FleetId;
let argo: ShipCaller;
let plugin: ShipCaller;
let pluginId: ShipId;

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(
    await withOperatorLogin(
      core.prisma,
      core.useCases.initialiseFleet({ name: "home fleet" }),
    ),
  );
  fleetId = fleet.fleetId;
  argo = operatorCaller(fleet);
  const commissioned = unwrap(
    await core.useCases.commissionShip(argo, {
      idempotencyKey: newKey(),
      name: "squadrons",
      type: "squadrons",
      kind: "plugin",
      scopes: ["fleet:read"],
    }),
  );
  pluginId = commissioned.shipId;
  plugin = await crewed(commissioned);
  // Rules that give the plugin's ship nothing to read.
  const networking = unwrap(
    await core.useCases.commissionShip(argo, {
      idempotencyKey: newKey(),
      name: "networking",
      type: "networking",
      scopes: ["fleet:network"],
    }),
  );
  const networkingCaller = await crewed(networking);
  const { savedAgainstVersion } = unwrap(
    await core.useCases.saveNetworkRulesDraft(networkingCaller, {
      rules: [
        { verb: "send", from: [], to: [] },
        { verb: "manage", from: [], to: [] },
      ],
    }),
  );
  unwrap(
    await core.useCases.applyNetworkRules(networkingCaller, {
      version: savedAgainstVersion,
    }),
  );
});

afterEach(async () => {
  await core.close();
});

async function crewed(ship: {
  shipId: ShipId;
  secret: string | null;
}): Promise<ShipCaller> {
  const { crewToken } = unwrap(
    await core.useCases.claimShip({
      shipId: ship.shipId,
      secret: secretOf(ship.secret),
      location: { kind: "CLOUD" },
      harness: "claude-code",
    }),
  );
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

async function readsOf(caller: ShipCaller) {
  return (
    await createReadReachOf({ uow: createPrismaUnitOfWork(core.prisma) })(
      caller,
    )
  ).kind;
}

async function eventsAbout(type: string) {
  return (
    await core.prisma.event.findMany({
      where: { fleetId, shipId: pluginId, type },
      orderBy: { seq: "asc" },
    })
  ).map(({ actorShipId, details }) => ({ actorShipId, details }));
}

describe("a plugin ship on Postgres", () => {
  it("reads every ship by its kind once argo commissioned it, with PluginConnected caused by argo", async () => {
    await expect(readsOf(plugin)).resolves.toBe("every");
    await expect(eventsAbout("PluginConnected")).resolves.toEqual([
      { actorShipId: argo.shipId, details: {} },
    ]);
  });

  it("reads every ship again once crewed after argo released it, with no PluginDisconnected", async () => {
    unwrap(await core.useCases.releaseShip(argo, { shipId: pluginId }));
    const { secret } = unwrap(
      await core.useCases.getStartingPrompt(argo, { shipId: pluginId }),
    );

    await expect(
      readsOf(await crewed({ shipId: pluginId, secret })),
    ).resolves.toBe("every");
    await expect(eventsAbout("PluginDisconnected")).resolves.toEqual([]);
  });

  it("ends with the retire of its ship, with PluginDisconnected", async () => {
    unwrap(await core.useCases.retireShip(argo, { shipId: pluginId }));

    await expect(eventsAbout("PluginDisconnected")).resolves.toEqual([
      { actorShipId: argo.shipId, details: { why: "retired" } },
    ]);
  });
});
