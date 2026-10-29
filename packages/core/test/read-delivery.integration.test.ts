import type { DeliveryId } from "@aeolus-fleet/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createPrismaClient,
  type PrismaClient,
} from "../src/adapters/prisma/client.js";
import { createReceiverWakeups } from "../src/adapters/prisma/receiver-wakeups.js";
import type { Crew, ShipCaller } from "../src/domain/shared/caller.js";
import { createUseCases, systemClock, type UseCases } from "../src/wiring.js";
import { OPERATOR, operatorCaller, secretOf } from "./support/core-fixtures.js";
import { createMigratedDatabase } from "../src/testing/database.js";
import { newKey } from "../src/testing/keys.js";
import { refusalOf, unwrap } from "../src/testing/result.js";

// A crew reading an acknowledged delivery of its own lease again, on a real
// Postgres: whole, and with the delivery's row and the event log as they were.

let prisma: PrismaClient;
let useCases: UseCases;
let argo: ShipCaller;
let scout: Crew;
let lookout: Crew;

beforeEach(async () => {
  prisma = createPrismaClient(await createMigratedDatabase());
  useCases = createUseCases({
    prisma,
    clock: systemClock,
    wakeups: createReceiverWakeups(),
    receiveWaitMs: 1_000,
  });
  const fleet = unwrap(
    await useCases.initialiseFleet({ name: "home fleet", ...OPERATOR }),
  );
  argo = operatorCaller(fleet);
  scout = await crewedReviewer("scout");
  lookout = await crewedReviewer("lookout");
});

afterEach(async () => {
  await prisma.$disconnect();
});

async function crewedReviewer(name: string): Promise<Crew> {
  const { shipId, secret } = unwrap(
    await useCases.commissionShip(argo, {
      idempotencyKey: newKey(),
      name,
      type: "reviewer",
    }),
  );
  const { crewToken } = unwrap(
    await useCases.claimShip({
      shipId,
      secret: secretOf(secret),
      location: { kind: "CLOUD" },
      harness: "claude-code",
    }),
  );
  return unwrap(await useCases.authenticate.byCrewToken(crewToken));
}

const PAYLOAD = "Look up account 42";

/** A message from the scout to the lookout, push received, handed as number 1 and acknowledged. */
async function acknowledgedByLookout(): Promise<DeliveryId> {
  unwrap(
    await useCases.sendMessage(scout, {
      selector: { kind: "ship", shipId: lookout.shipId },
      payload: PAYLOAD,
      contentType: "text/plain",
      model: "claude-opus-5-5",
      idempotencyKey: newKey(),
    }),
  );
  const [received] = unwrap(
    await useCases.pushReceiveDeliveries(lookout, {}),
  ).deliveries;
  if (!received) {
    throw new Error("The lookout received nothing");
  }
  const { deliveryId } = received;
  unwrap(
    await useCases.handOverDelivery(lookout, { deliveryId, handOverNumber: 1 }),
  );
  unwrap(await useCases.acknowledgeDelivery(lookout, { deliveryId }));
  return deliveryId;
}

function rowOf(deliveryId: DeliveryId) {
  return prisma.$queryRaw<
    unknown[]
  >`SELECT * FROM deliveries WHERE id = ${deliveryId}`;
}

describe("a crew re-reading its delivery on Postgres", () => {
  it("answers it whole, with its sender by name, and its state acknowledged", async () => {
    const deliveryId = await acknowledgedByLookout();

    expect(
      unwrap(await useCases.readDelivery(lookout, { deliveryId })),
    ).toMatchObject({
      deliveryId,
      senderShipId: scout.shipId,
      senderName: "scout",
      payload: PAYLOAD,
      model: "claude-opus-5-5",
      attempts: 1,
      state: "acknowledged",
    });
  });

  it("leaves the delivery row, its state, attempts and clocks, and the event log as they were", async () => {
    const deliveryId = await acknowledgedByLookout();
    const before = await rowOf(deliveryId);
    const eventsBefore = await prisma.event.count();

    unwrap(await useCases.readDelivery(lookout, { deliveryId }));
    unwrap(await useCases.readDelivery(lookout, { deliveryId }));

    expect(await rowOf(deliveryId)).toEqual(before);
    expect(await prisma.event.count()).toBe(eventsBefore);
  });

  it("refuses it once handled, naming its state", async () => {
    const deliveryId = await acknowledgedByLookout();
    unwrap(await useCases.reportHandled(lookout, { deliveryId }));

    expect(
      refusalOf(await useCases.readDelivery(lookout, { deliveryId })),
    ).toEqual({
      kind: "DELIVERY_NOT_ACKNOWLEDGED",
      message: `Delivery ${deliveryId} is handled, not acknowledged: only an acknowledged delivery not yet handled is read again`,
    });
  });

  it("refuses another ship's read of it as not found", async () => {
    const deliveryId = await acknowledgedByLookout();

    expect(
      refusalOf(await useCases.readDelivery(scout, { deliveryId })),
    ).toMatchObject({ kind: "DELIVERY_NOT_FOUND" });
  });
});
