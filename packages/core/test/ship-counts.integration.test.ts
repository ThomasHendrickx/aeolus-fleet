import type { CrewStatus, ShipId } from "@aeolus-fleet/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ShipCaller } from "../src/domain/shared/caller.js";
import { newKey } from "../src/testing/keys.js";
import { unwrap } from "../src/testing/result.js";
import { operatorCaller, secretOf } from "./support/core-fixtures.js";
import { aCrewSettings } from "./support/crew-fixtures.js";
import { withOperatorLogin } from "./support/operator-login.js";
import {
  createPostgresCore,
  type PostgresCore,
} from "./support/postgres-core.js";

// The ship counts on Postgres (performance design, decision 2): one statement
// counts each kind's ships by the listing's rules, with no ship's row read.

const MINUTE_MS = 60 * 1000;

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

async function commission(
  name: string,
): Promise<{ shipId: ShipId; secret: string }> {
  core.clock.advance(MINUTE_MS);
  const { shipId, secret } = unwrap(
    await core.useCases.commissionShip(argo, {
      idempotencyKey: newKey(),
      name,
      type: "reviewer",
    }),
  );
  return { shipId, secret: secretOf(secret) };
}

async function claim(ship: { shipId: ShipId; secret: string }): Promise<void> {
  core.clock.advance(MINUTE_MS);
  unwrap(
    await core.useCases.claimShip({
      ...ship,
      location: { kind: "CLOUD" },
      harness: "claude-code",
    }),
  );
}

/** A crew request a trierarch holds with the status given, as the plugin's assign and the trierarch's report leave it. */
async function heldBy(
  shipId: ShipId,
  held: { trierarch: ShipId; status: CrewStatus },
): Promise<void> {
  unwrap(
    await core.useCases.requestCrew(argo, {
      shipId,
      settings: aCrewSettings(),
    }),
  );
  await core.prisma.crewRequest.update({
    where: { fleetId_shipId: { fleetId: argo.fleetId, shipId } },
    data: { assignedTo: held.trierarch, status: held.status },
  });
}

describe("the ship counts on Postgres", () => {
  it("counts each kind active, crewed, awaiting crew, retired and needing crew, and names the longest wait", async () => {
    const crewed = await commission("crewed");
    await claim(crewed);
    const waiting = await commission("waiting");
    const waitingSince = core.clock.now();
    const retired = await commission("retired");
    unwrap(await core.useCases.retireShip(argo, { shipId: retired.shipId }));
    const asking = await commission("asking");
    unwrap(
      await core.useCases.requestCrew(argo, {
        shipId: asking.shipId,
        settings: aCrewSettings(),
      }),
    );
    const byHand = await commission("by-hand");
    unwrap(
      await core.useCases.requestCrew(argo, {
        shipId: byHand.shipId,
        settings: aCrewSettings(),
      }),
    );
    const prompt = unwrap(
      await core.useCases.getStartingPrompt(argo, { shipId: byHand.shipId }),
    );
    await claim({ shipId: byHand.shipId, secret: secretOf(prompt.secret) });
    const trierarch = await commission("mac-studio");
    await heldBy((await commission("crewing")).shipId, {
      trierarch: trierarch.shipId,
      status: "crewing",
    });
    await heldBy((await commission("running")).shipId, {
      trierarch: trierarch.shipId,
      status: "running",
    });

    await expect(core.useCases.countShips(argo)).resolves.toEqual([
      {
        kind: "operator",
        active: 1,
        crewed: 1,
        awaitingCrew: 0,
        retired: 0,
        needsCrew: { withTrierarchs: 0, withoutTrierarchs: 0 },
        longestWait: null,
      },
      {
        kind: "agent",
        active: 7,
        crewed: 2,
        awaitingCrew: 5,
        retired: 1,
        needsCrew: { withTrierarchs: 2, withoutTrierarchs: 1 },
        longestWait: {
          id: waiting.shipId,
          name: "waiting",
          awaitingCrewSince: waitingSince,
        },
      },
    ]);
  });

  it("counts only the ships the filter selects, through the fleet snapshot filter", async () => {
    const scout = await commission("scout");
    await claim(scout);
    await commission("lookout");
    const keeper = await commission("keeper");
    unwrap(await core.useCases.retireShip(argo, { shipId: keeper.shipId }));

    await expect(
      core.useCases.countShips(argo, {
        filter: { status: ["crewed", "retired"], type: ["reviewer"] },
      }),
    ).resolves.toEqual([
      {
        kind: "agent",
        active: 1,
        crewed: 1,
        awaitingCrew: 0,
        retired: 1,
        needsCrew: { withTrierarchs: 0, withoutTrierarchs: 0 },
        longestWait: null,
      },
    ]);
  });

  it("counts a kind whose ships the filter selects are all retired", async () => {
    const keeper = await commission("archivist");
    unwrap(await core.useCases.retireShip(argo, { shipId: keeper.shipId }));

    await expect(
      core.useCases.countShips(argo, {
        filter: { status: ["retired"], query: "archivist" },
      }),
    ).resolves.toEqual([
      {
        kind: "agent",
        active: 0,
        crewed: 0,
        awaitingCrew: 0,
        retired: 1,
        needsCrew: { withTrierarchs: 0, withoutTrierarchs: 0 },
        longestWait: null,
      },
    ]);
  });

  it("counts a ship whose crew left as awaiting crew since its last lease ended", async () => {
    const scout = await commission("scout");
    await claim(scout);
    core.clock.advance(MINUTE_MS);
    unwrap(await core.useCases.releaseShip(argo, { shipId: scout.shipId }));
    const releasedAt = core.clock.now();

    await expect(core.useCases.countShips(argo)).resolves.toContainEqual(
      expect.objectContaining({
        kind: "agent",
        longestWait: {
          id: scout.shipId,
          name: "scout",
          awaitingCrewSince: releasedAt,
        },
      }),
    );
  });
});
