import type { DataKeyId, FleetId } from "@aeolus-fleet/common";
import { beforeEach, describe, expect, it } from "vitest";

import { hostedFleet, sealFleet } from "../../../test/support/core-fixtures.js";
import {
  createInMemoryCore,
  type InMemoryCore,
} from "../../../test/support/in-memory.js";
import { refusalOf, unwrap } from "../../testing/result.js";
import { err, ok } from "../shared/result.js";
import { withDataKeys, type DataKeysNeeded } from "./data-keys.js";

let core: InMemoryCore;
let fleetId: FleetId;
let companyKey: string;

beforeEach(async () => {
  core = createInMemoryCore("2026-10-29T12:00:00.000Z");
  ({ fleetId } = await hostedFleet(core));
  companyKey = await sealFleet(core, fleetId);
});

function currentDataKeyId(): DataKeyId {
  const current = core.state.dataKeys.find(
    (held) => held.fleetId === fleetId && held.isCurrent,
  );
  expect(current).toBeDefined();
  return current?.id ?? core.ids("dataKey");
}

describe("unwrapping a fleet data keys (decision 0068, B8)", () => {
  it("unwraps a data key the fleet holds, checked against its check value", async () => {
    const id = currentDataKeyId();

    const [dataKey] = unwrap(await core.sealing.dataKeys.unwrap(fleetId, [id]));

    expect(dataKey?.id).toBe(id);
    expect(dataKey?.material).toHaveLength(32);
  });

  it("answers notFound when the fleet does not hold a data key asked for", async () => {
    const unavailable = refusalOf(
      await core.sealing.dataKeys.unwrap(fleetId, [
        currentDataKeyId(),
        core.ids("dataKey"),
      ]),
    );

    expect(unavailable).toEqual({ kind: "keyUnavailable", reason: "notFound" });
  });

  it("answers invalidWrap when the vault gives a key that does not match the stored check value", async () => {
    const id = currentDataKeyId();
    core.state.dataKeys.forEach((held) => {
      held.checkValue = new Uint8Array(held.checkValue.length);
    });

    const unavailable = refusalOf(
      await core.sealing.dataKeys.unwrap(fleetId, [id]),
    );

    expect(unavailable).toEqual({
      kind: "keyUnavailable",
      reason: "invalidWrap",
    });
  });

  it("passes on the reason when the vault cannot open the wrap", async () => {
    await core.keyVault.disable(companyKey);

    const unavailable = refusalOf(
      await core.sealing.dataKeys.unwrap(fleetId, [currentDataKeyId()]),
    );

    expect(unavailable).toEqual({ kind: "keyUnavailable", reason: "disabled" });
  });
});

describe("the data key cache (decision 0068, B11)", () => {
  const FIVE_MINUTES_MS = 5 * 60 * 1000;

  it("serves an unwrapped data key from memory until 5 minutes after its unwrap, also once the company key is disabled", async () => {
    const id = currentDataKeyId();
    unwrap(await core.sealing.dataKeys.unwrap(fleetId, [id]));
    await core.keyVault.disable(companyKey);
    core.clock.advance(FIVE_MINUTES_MS - 1);

    const [dataKey] = unwrap(await core.sealing.dataKeys.unwrap(fleetId, [id]));

    expect(dataKey?.id).toBe(id);
  });

  it("unwraps it again 5 minutes after its unwrap, so a disabled company key then refuses", async () => {
    const id = currentDataKeyId();
    unwrap(await core.sealing.dataKeys.unwrap(fleetId, [id]));
    await core.keyVault.disable(companyKey);
    core.clock.advance(FIVE_MINUTES_MS);

    const unavailable = refusalOf(await core.sealing.dataKeys.unwrap(fleetId, [id]));

    expect(unavailable).toEqual({ kind: "keyUnavailable", reason: "disabled" });
  });
});

describe("the company key's availability (decision 0068, B11)", () => {
  const FIVE_MINUTES_MS = 5 * 60 * 1000;

  function availabilityEvents() {
    return core.state.events
      .filter((event) => event.type === "FleetKeyUnavailable" || event.type === "FleetKeyAvailable")
      .map(({ type, actor, details, occurredAt }) => ({ type, actor, details, occurredAt }));
  }

  function keyAvailability() {
    return core.state.fleetSealings.find((held) => held.fleetId === fleetId)?.keyAvailability;
  }

  it("writes FleetKeyUnavailable with the key vault's reason on the first refusal after a success, and none for the refusals after it", async () => {
    const id = currentDataKeyId();
    unwrap(await core.sealing.dataKeys.unwrap(fleetId, [id]));
    await core.keyVault.disable(companyKey);
    core.clock.advance(FIVE_MINUTES_MS);

    refusalOf(await core.sealing.dataKeys.unwrap(fleetId, [id]));
    core.clock.advance(1000);
    await core.keyVault.refuseGrant(companyKey);
    refusalOf(await core.sealing.dataKeys.unwrap(fleetId, [id]));

    expect(availabilityEvents()).toEqual([
      { type: "FleetKeyUnavailable", actor: { kind: "system" }, details: { reason: "disabled" }, occurredAt: new Date("2026-10-29T12:05:00.000Z") },
    ]);
    expect(keyAvailability()).toEqual({ isAvailable: false, reason: "disabled", since: new Date("2026-10-29T12:05:00.000Z") });
  });

  it("writes FleetKeyAvailable on the first unwrap after a refusal, once", async () => {
    const id = currentDataKeyId();
    await core.keyVault.disable(companyKey);
    refusalOf(await core.sealing.dataKeys.unwrap(fleetId, [id]));
    await core.keyVault.enable(companyKey);
    core.clock.advance(60_000);

    unwrap(await core.sealing.dataKeys.unwrap(fleetId, [id]));
    core.clock.advance(FIVE_MINUTES_MS);
    unwrap(await core.sealing.dataKeys.unwrap(fleetId, [id]));

    expect(availabilityEvents().map(({ type }) => type)).toEqual(["FleetKeyUnavailable", "FleetKeyAvailable"]);
    expect(keyAvailability()).toEqual({ isAvailable: true, since: new Date("2026-10-29T12:01:00.000Z") });
  });

  it("writes no availability event for a wrap that does not open: the company key answered", async () => {
    core.state.dataKeys.forEach((held) => {
      held.checkValue = new Uint8Array(held.checkValue.length);
    });

    refusalOf(await core.sealing.dataKeys.unwrap(fleetId, [currentDataKeyId()]));

    expect(availabilityEvents()).toEqual([]);
    expect(keyAvailability()).toEqual({ isAvailable: true, since: new Date("2026-10-29T12:00:00.000Z") });
  });
});

describe("running work with data keys (decision 0068, B8)", () => {
  it("runs the work once, holding no key, when it meets none", async () => {
    let runs = 0;

    const result = await withDataKeys(
      { sealing: core.sealing, fleetId },
      () => {
        runs += 1;
        return Promise.resolve(ok("done"));
      },
    );

    expect(unwrap(result)).toBe("done");
    expect(runs).toBe(1);
  });

  it("gives up with KEY_UNAVAILABLE after three runs when the work keeps meeting keys it does not hold", async () => {
    let runs = 0;
    const needed: DataKeysNeeded = {
      kind: "dataKeysNeeded",
      dataKeyIds: [core.ids("dataKey")],
    };
    const unwrapped: DataKeyId[][] = [];
    const sealing = {
      ...core.sealing,
      dataKeys: {
        unwrap: (_fleetId: FleetId, ids: readonly DataKeyId[]) => {
          unwrapped.push([...ids]);
          return Promise.resolve(
            ok(ids.map((id) => ({ id, material: new Uint8Array(32) }))),
          );
        },
      },
    };

    const result = await withDataKeys({ sealing, fleetId }, () => {
      runs += 1;
      return Promise.resolve(err(needed));
    });

    expect(refusalOf(result)).toMatchObject({ kind: "KEY_UNAVAILABLE" });
    expect(runs).toBe(3);
    expect(unwrapped).toHaveLength(2);
  });
});
