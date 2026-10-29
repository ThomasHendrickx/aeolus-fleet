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
