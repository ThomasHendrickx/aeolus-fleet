import { idSchema, type FleetId, type MessageId } from "@aeolus-fleet/common";
import { beforeEach, describe, expect, it } from "vitest";

import {
  historyScenario,
  type HistoryScenario,
} from "../../../test/support/history-scenario.js";
import type { InMemoryState } from "../../../test/support/in-memory.js";
import { createCloseHealthSnapshots } from "./close-health-snapshots.js";
import { createPruneHistory } from "./prune-history.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

let scene: HistoryScenario;
let failures: { fleetId: FleetId; error: unknown }[];

beforeEach(async () => {
  scene = await historyScenario();
  failures = [];
});

function retainFor(days: number | null): void {
  scene.core.state.fleetLimitSettings.push({
    fleetId: scene.fleetId,
    ships: { kind: "default" },
    dailyMessages: { kind: "default" },
    schedulesPerShip: { kind: "default" },
    minimumScheduleInterval: { kind: "default" },
    retention: { kind: "fleet", days },
  });
}

/** The 30 second pass as it runs: the snapshot close, then the pruning pass. */
async function pass(
  options: { batch?: number; budgetMs?: number } = {},
): Promise<void> {
  const { core } = scene;
  await createCloseHealthSnapshots({
    fleets: core.fleets,
    uow: core.uow,
    clock: core.clock,
  })();
  await createPruneHistory({
    fleets: core.fleets,
    uow: core.uow,
    clock: core.clock,
    ids: core.ids,
    ...options,
  })((fleetId, error) => failures.push({ fleetId, error }));
}

/** A message the scout sends the planner, which the planner receives and acknowledges: finished. */
async function aFinishedMessage(): Promise<MessageId> {
  const messageId = await scene.send(scene.scout, {
    to: { kind: "ship", shipId: scene.planner.shipId },
  });
  await scene.receive(scene.planner);
  await scene.ack(scene.planner, messageId);
  return messageId;
}

function isKept(messageId: MessageId): boolean {
  return scene.core.state.messages.some((message) => message.id === messageId);
}

function eventsOf(messageId: MessageId) {
  return scene.core.state.events.filter(
    (event) => event.messageId === messageId,
  );
}

function pruned() {
  return scene.core.state.events.filter(
    (event) => event.type === "HistoryPruned",
  );
}

function keptFrom(): Date | null {
  return (
    scene.core.state.fleetPrunes.find((row) => row.fleetId === scene.fleetId)
      ?.keptFrom ?? null
  );
}

describe("the pruning pass", () => {
  it("lets a finished message older than the retention go, with its deliveries and their events", async () => {
    retainFor(30);
    const messageId = await aFinishedMessage();
    scene.core.clock.advance(31 * DAY_MS);

    await pass();

    expect(isKept(messageId)).toBe(false);
    expect(
      scene.core.state.deliveries.filter(
        (delivery) => delivery.messageId === messageId,
      ),
    ).toEqual([]);
    expect(eventsOf(messageId)).toEqual([]);
  });

  it("keeps a finished message younger than the retention", async () => {
    retainFor(30);
    const messageId = await aFinishedMessage();
    scene.core.clock.advance(29 * DAY_MS);

    await pass();

    expect(isKept(messageId)).toBe(true);
  });

  it("keeps a message still on its way, whatever its age", async () => {
    retainFor(30);
    const messageId = await scene.send(scene.scout, {
      to: { kind: "ship", shipId: scene.planner.shipId },
    });
    scene.core.clock.advance(300 * DAY_MS);

    await pass();

    expect(isKept(messageId)).toBe(true);
  });

  it("lets nothing go in a fleet kept for good", async () => {
    retainFor(null);
    const messageId = await aFinishedMessage();
    scene.core.clock.advance(300 * DAY_MS);

    await pass();

    expect(isKept(messageId)).toBe(true);
    expect(pruned()).toEqual([]);
  });

  it("follows the installation's default retention", async () => {
    scene.core.state.installationSettings.push({
      defaultShipLimit: null,
      defaultDailyMessageLimit: null,
      defaultSchedulesPerShipLimit: null,
      defaultMinimumScheduleInterval: null,
      defaultRetentionDays: 7,
      fleetCap: null,
    });
    const messageId = await aFinishedMessage();
    scene.core.clock.advance(8 * DAY_MS);

    await pass();

    expect(isKept(messageId)).toBe(false);
  });

  it("writes HistoryPruned, by the system, with the cutoff and how many rows of each kind went", async () => {
    retainFor(30);
    const messageId = await aFinishedMessage();
    const events = eventsOf(messageId).length;
    scene.core.clock.advance(31 * DAY_MS);

    await pass();

    expect(pruned()).toEqual([
      expect.objectContaining({
        actor: { kind: "system" },
        details: {
          cutoff: "2026-10-02T09:01:03.000Z",
          messages: 1,
          deliveries: 1,
          events,
          overdueDeliveries: 0,
        },
      }),
    ]);
  });

  it("writes no HistoryPruned when nothing went", async () => {
    retainFor(30);
    await aFinishedMessage();

    await pass();

    expect(pruned()).toEqual([]);
  });

  it("moves the fleet's kept from to the cutoff once nothing older is left", async () => {
    retainFor(30);
    await aFinishedMessage();
    scene.core.clock.advance(31 * DAY_MS);

    await pass();

    expect(keptFrom()?.toISOString()).toBe("2026-10-02T09:01:03.000Z");
  });

  it("runs once an hour: a pass within the hour of the last lets nothing go, one an hour after it does", async () => {
    retainFor(30);
    const messageId = await aFinishedMessage();
    scene.core.clock.advance(31 * DAY_MS);
    scene.core.state.fleetPrunes.push({
      fleetId: scene.fleetId,
      prunedAt: new Date(scene.core.clock.now().getTime() - HOUR_MS / 2),
      keptFrom: null,
    });

    await pass();
    const isKeptWithinTheHour = isKept(messageId);
    scene.core.clock.advance(HOUR_MS / 2);
    await pass();

    expect(isKeptWithinTheHour).toBe(true);
    expect(isKept(messageId)).toBe(false);
  });

  it("prunes in batches until nothing older than the cutoff is left", async () => {
    retainFor(30);
    const messageIds = [
      await aFinishedMessage(),
      await aFinishedMessage(),
      await aFinishedMessage(),
      await aFinishedMessage(),
      await aFinishedMessage(),
    ];
    scene.core.clock.advance(31 * DAY_MS);

    await pass({ batch: 2 });

    expect(messageIds.filter(isKept)).toEqual([]);
    expect(pruned().map((event) => event.details.messages)).toEqual([2, 2, 1]);
  });

  it("goes past the messages it keeps to the finished ones after them", async () => {
    retainFor(30);
    const open = await scene.send(scene.scout, {
      to: { kind: "ship", shipId: scene.lookout.shipId },
    });
    const alsoOpen = await scene.send(scene.scout, {
      to: { kind: "ship", shipId: scene.lookout.shipId },
    });
    const finished = await aFinishedMessage();
    scene.core.clock.advance(31 * DAY_MS);

    await pass({ batch: 2 });

    expect([open, alsoOpen].map(isKept)).toEqual([true, true]);
    expect(isKept(finished)).toBe(false);
  });

  it("leaves the rest to the next hour once its time budget is spent, its kept from unmoved", async () => {
    retainFor(30);
    const messageIds = [
      await aFinishedMessage(),
      await aFinishedMessage(),
      await aFinishedMessage(),
    ];
    scene.core.clock.advance(31 * DAY_MS);

    await pass({ batch: 2, budgetMs: 0 });

    expect(messageIds.filter(isKept)).toHaveLength(1);
    expect(keptFrom()).toBeNull();
  });

  it("skips a fleet whose prune lock another server holds", async () => {
    retainFor(30);
    const messageId = await aFinishedMessage();
    scene.core.clock.advance(31 * DAY_MS);
    scene.core.state.historyPruneLocks.push(scene.fleetId);

    await pass();

    expect(isKept(messageId)).toBe(true);
    expect(keptFrom()).toBeNull();
  });

  it("leaves a message another transaction holds for the next pass", async () => {
    retainFor(30);
    const held = await aFinishedMessage();
    const free = await aFinishedMessage();
    scene.core.clock.advance(31 * DAY_MS);
    scene.core.state.lockedMessages.push(held);

    await pass();

    expect(isKept(held)).toBe(true);
    expect(isKept(free)).toBe(false);
  });

  it("prunes nothing before the fleet has a stuck snapshot to bound its cutoff", async () => {
    retainFor(30);
    const messageId = await aFinishedMessage();
    scene.core.clock.advance(31 * DAY_MS);
    const { core } = scene;

    await createPruneHistory({
      fleets: core.fleets,
      uow: core.uow,
      clock: core.clock,
      ids: core.ids,
    })();

    expect(isKept(messageId)).toBe(true);
  });

  it("lets the mic and participant events of a meeting ended before the cutoff go, and keeps the meeting", async () => {
    retainFor(30);
    const { core } = scene;
    const meetingId = idSchema("meeting").parse(core.ids("meeting"));
    const meeting: InMemoryState["meetings"][number] = {
      id: meetingId,
      fleetId: scene.fleetId,
      title: null,
      ownerShipId: scene.scout.shipId,
      moderatorShipId: scene.scout.shipId,
      openedByShipId: scene.scout.shipId,
      idempotencyKey: "open-1",
      requestHash: "hash",
      participants: [],
      openedAt: core.clock.now(),
      endedAt: core.clock.now(),
      micHolderShipId: null,
      micPattern: "moderator",
      micRequests: [],
    };
    core.state.meetings.push(meeting);
    const at = core.clock.now();
    core.state.events.push(
      {
        id: core.ids("event"),
        fleetId: scene.fleetId,
        type: "ParticipantAdded",
        occurredAt: at,
        actor: { kind: "system" },
        shipId: scene.planner.shipId,
        details: { meetingId },
      },
      {
        id: core.ids("event"),
        fleetId: scene.fleetId,
        type: "MicGiven",
        occurredAt: at,
        actor: { kind: "system" },
        shipId: scene.planner.shipId,
        details: { meetingId },
      },
      {
        id: core.ids("event"),
        fleetId: scene.fleetId,
        type: "MeetingEnded",
        occurredAt: at,
        actor: { kind: "system" },
        details: { meetingId },
      },
    );
    scene.core.clock.advance(31 * DAY_MS);

    await pass();

    expect(
      core.state.events
        .filter((event) => event.details.meetingId === meetingId)
        .map((event) => event.type),
    ).toEqual(["MeetingEnded"]);
    expect(core.state.meetings.map((held) => held.id)).toContain(meetingId);
  });
});
