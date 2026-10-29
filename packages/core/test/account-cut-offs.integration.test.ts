import { accountIdSchema, createIdGenerator } from "@aeolus-fleet/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPrismaClient,
  type PrismaClient,
} from "../src/adapters/prisma/client.js";
import {
  createPrismaAccountCutOffs,
  createPrismaHostedFleets,
} from "../src/adapters/prisma/identity.js";
import { createMigratedDatabase } from "../src/testing/database.js";

// The installation's cut-off accounts and its hosted fleets on a real
// Postgres (decision 0058): kept for every fleet, until they can be forgotten.

const newId = createIdGenerator();
const TEN = new Date("2026-10-19T10:00:00.000Z");
const TEN_FIVE = new Date("2026-10-19T10:05:00.000Z");
const TEN_ELEVEN = new Date("2026-10-19T10:11:00.000Z");
const TEN_SIXTEEN = new Date("2026-10-19T10:16:00.000Z");

let database: PrismaClient;

beforeAll(async () => {
  database = createPrismaClient(await createMigratedDatabase());
});

afterAll(async () => {
  await database.$disconnect();
});

function anAccount() {
  return accountIdSchema.parse(`acc-${newId("event")}`);
}

describe("the Postgres cut-off accounts", () => {
  it("answer when an account was cut off while the cut-off is kept", async () => {
    const cutOffs = createPrismaAccountCutOffs(database);
    const accountId = anAccount();

    await cutOffs.record({ accountId, cutOffAt: TEN, forgetAt: TEN_ELEVEN });

    expect(await cutOffs.cutOffAt(accountId, TEN_FIVE)).toEqual(TEN);
  });

  it("answer nothing once the cut-off is no longer kept", async () => {
    const cutOffs = createPrismaAccountCutOffs(database);
    const accountId = anAccount();

    await cutOffs.record({ accountId, cutOffAt: TEN, forgetAt: TEN_ELEVEN });

    expect(await cutOffs.cutOffAt(accountId, TEN_ELEVEN)).toBeUndefined();
  });

  it("keep the later of two cut-offs of one account", async () => {
    const cutOffs = createPrismaAccountCutOffs(database);
    const accountId = anAccount();

    await cutOffs.record({
      accountId,
      cutOffAt: TEN_FIVE,
      forgetAt: TEN_SIXTEEN,
    });
    await cutOffs.record({ accountId, cutOffAt: TEN, forgetAt: TEN_ELEVEN });

    expect(await cutOffs.cutOffAt(accountId, TEN_ELEVEN)).toEqual(TEN_FIVE);
  });

  it("forget every cut-off kept no longer than the moment given, and keep the others", async () => {
    const cutOffs = createPrismaAccountCutOffs(database);
    const [ended, kept] = [anAccount(), anAccount()];
    await cutOffs.record({
      accountId: ended,
      cutOffAt: TEN,
      forgetAt: TEN_ELEVEN,
    });
    await cutOffs.record({
      accountId: kept,
      cutOffAt: TEN_FIVE,
      forgetAt: TEN_SIXTEEN,
    });

    await cutOffs.forget(TEN_ELEVEN);

    expect(
      await database.accountCutOff.count({ where: { accountId: ended } }),
    ).toBe(0);
    expect(await cutOffs.cutOffAt(kept, TEN_ELEVEN)).toEqual(TEN_FIVE);
  });
});

describe("the Postgres hosted fleets", () => {
  it("know a fleet this installation hosts", async () => {
    const fleetId = newId("fleet");
    await database.fleet.create({
      data: { id: fleetId, name: "acme", createdAt: TEN },
    });

    expect(await createPrismaHostedFleets(database).isHosted(fleetId)).toBe(
      true,
    );
  });

  it("know no fleet it does not host", async () => {
    expect(
      await createPrismaHostedFleets(database).isHosted(newId("fleet")),
    ).toBe(false);
  });
});
