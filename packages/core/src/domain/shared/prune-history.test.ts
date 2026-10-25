import { idSchema, QUESTION_CONTENT_TYPE, type ConsoleSessionId, type FleetId, type MessageId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import type { InMemoryState } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import type { ReachRefusal } from '../registry/reach-refusal.js';
import { createCloseHealthSnapshots } from './close-health-snapshots.js';
import { createPruneHistory } from './prune-history.js';

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
    ships: { kind: 'default' },
    dailyMessages: { kind: 'default' },
    schedulesPerShip: { kind: 'default' },
    minimumScheduleInterval: { kind: 'default' },
    retention: { kind: 'fleet', days },
  });
}

/** The 30 second pass as it runs: the snapshot close, then the pruning pass. */
async function pass(options: { batch?: number; budgetMs?: number } = {}): Promise<void> {
  const { core } = scene;
  await createCloseHealthSnapshots({ fleets: core.fleets, uow: core.uow, clock: core.clock })();
  await createPruneHistory({ fleets: core.fleets, uow: core.uow, clock: core.clock, ids: core.ids, ...options })((fleetId, error) => failures.push({ fleetId, error }));
}

/** A message the scout sends the planner, which the planner receives and acknowledges: finished. */
async function aFinishedMessage(): Promise<MessageId> {
  const messageId = await scene.send(scene.scout, { to: { kind: 'ship', shipId: scene.planner.shipId } });
  await scene.receive(scene.planner);
  await scene.ack(scene.planner, messageId);
  return messageId;
}

function isKept(messageId: MessageId): boolean {
  return scene.core.state.messages.some((message) => message.id === messageId);
}

function eventsOf(messageId: MessageId) {
  return scene.core.state.events.filter((event) => event.messageId === messageId);
}

function pruned() {
  return scene.core.state.events.filter((event) => event.type === 'HistoryPruned');
}

function keptFrom(): Date | null {
  return scene.core.state.fleetPrunes.find((row) => row.fleetId === scene.fleetId)?.keptFrom ?? null;
}

describe('the pruning pass', () => {
  it('lets a finished message older than the retention go, with its deliveries and their events', async () => {
    retainFor(30);
    const messageId = await aFinishedMessage();
    scene.core.clock.advance(31 * DAY_MS);

    await pass();

    expect(isKept(messageId)).toBe(false);
    expect(scene.core.state.deliveries.filter((delivery) => delivery.messageId === messageId)).toEqual([]);
    expect(eventsOf(messageId)).toEqual([]);
    expect(failures).toEqual([]);
  });

  it('keeps a finished message younger than the retention', async () => {
    retainFor(30);
    const messageId = await aFinishedMessage();
    scene.core.clock.advance(29 * DAY_MS);

    await pass();

    expect(isKept(messageId)).toBe(true);
  });

  it('keeps a message still on its way, whatever its age', async () => {
    retainFor(30);
    const messageId = await scene.send(scene.scout, { to: { kind: 'ship', shipId: scene.planner.shipId } });
    scene.core.clock.advance(300 * DAY_MS);

    await pass();

    expect(isKept(messageId)).toBe(true);
  });

  it('lets nothing go in a fleet kept for good', async () => {
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

  it('writes HistoryPruned, by the system, with the cutoff and how many rows of each kind went', async () => {
    retainFor(30);
    const messageId = await aFinishedMessage();
    const events = eventsOf(messageId).length;
    scene.core.clock.advance(31 * DAY_MS);

    await pass();

    expect(pruned()).toEqual([
      expect.objectContaining({ actor: { kind: 'system' }, details: { cutoff: '2026-10-02T09:01:03.000Z', messages: 1, deliveries: 1, events, overdueDeliveries: 0 } }),
    ]);
  });

  it('writes no HistoryPruned when nothing went', async () => {
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

    expect(keptFrom()?.toISOString()).toBe('2026-10-02T09:01:03.000Z');
  });

  it('runs once an hour: a pass within the hour of the last lets nothing go, one an hour after it does', async () => {
    retainFor(30);
    const messageId = await aFinishedMessage();
    scene.core.clock.advance(31 * DAY_MS);
    scene.core.state.fleetPrunes.push({ fleetId: scene.fleetId, prunedAt: new Date(scene.core.clock.now().getTime() - HOUR_MS / 2), keptFrom: null });

    await pass();
    const isKeptWithinTheHour = isKept(messageId);
    scene.core.clock.advance(HOUR_MS / 2);
    await pass();

    expect(isKeptWithinTheHour).toBe(true);
    expect(isKept(messageId)).toBe(false);
  });

  it('keeps a message acknowledged after the newest snapshot until the snapshot folds the acknowledgement (R7)', async () => {
    retainFor(30);
    const { core } = scene;
    const messageId = await scene.send(scene.scout, { to: { kind: 'ship', shipId: scene.planner.shipId } });
    await scene.receive(scene.planner);
    scene.core.clock.advance(31 * DAY_MS);
    await pass();
    await scene.ack(scene.planner, messageId);
    scene.core.clock.advance(HOUR_MS);

    await createPruneHistory({ fleets: core.fleets, uow: core.uow, clock: core.clock, ids: core.ids })();
    const isKeptBeforeTheFold = isKept(messageId);
    scene.core.clock.advance(HOUR_MS);
    await pass();
    const latest = await core.healthSnapshots.latest(scene.fleetId);

    expect(isKeptBeforeTheFold).toBe(true);
    expect(isKept(messageId)).toBe(false);
    expect(latest?.fold.deliveries.filter((delivery) => delivery.messageId === messageId)).toEqual([]);
  });

  it('prunes in batches until nothing older than the cutoff is left', async () => {
    retainFor(30);
    const messageIds = [await aFinishedMessage(), await aFinishedMessage(), await aFinishedMessage(), await aFinishedMessage(), await aFinishedMessage()];
    scene.core.clock.advance(31 * DAY_MS);

    await pass({ batch: 2 });

    expect(messageIds.filter(isKept)).toEqual([]);
    expect(pruned().map((event) => event.details.messages)).toEqual([2, 2, 1]);
  });

  it('goes past the messages it keeps to the finished ones after them', async () => {
    retainFor(30);
    const open = await scene.send(scene.scout, { to: { kind: 'ship', shipId: scene.lookout.shipId } });
    const alsoOpen = await scene.send(scene.scout, { to: { kind: 'ship', shipId: scene.lookout.shipId } });
    const finished = await aFinishedMessage();
    scene.core.clock.advance(31 * DAY_MS);

    await pass({ batch: 2 });

    expect([open, alsoOpen].map(isKept)).toEqual([true, true]);
    expect(isKept(finished)).toBe(false);
  });

  it('leaves the rest to the next hour once its time budget is spent, its kept from unmoved', async () => {
    retainFor(30);
    const messageIds = [await aFinishedMessage(), await aFinishedMessage(), await aFinishedMessage()];
    scene.core.clock.advance(31 * DAY_MS);

    await pass({ batch: 2, budgetMs: 0 });

    expect(messageIds.filter(isKept)).toHaveLength(1);
    expect(keptFrom()).toBeNull();
  });

  it('skips a fleet whose prune lock another server holds', async () => {
    retainFor(30);
    const messageId = await aFinishedMessage();
    scene.core.clock.advance(31 * DAY_MS);
    scene.core.state.historyPruneLocks.push(scene.fleetId);

    await pass();

    expect(isKept(messageId)).toBe(true);
    expect(keptFrom()).toBeNull();
  });

  it('leaves a message another transaction holds for the next pass', async () => {
    retainFor(30);
    const held = await aFinishedMessage();
    const free = await aFinishedMessage();
    scene.core.clock.advance(31 * DAY_MS);
    scene.core.state.lockedMessages.push(held);

    await pass();

    expect(isKept(held)).toBe(true);
    expect(isKept(free)).toBe(false);
  });

  it('prunes nothing before the fleet has a stuck snapshot to bound its cutoff', async () => {
    retainFor(30);
    const messageId = await aFinishedMessage();
    scene.core.clock.advance(31 * DAY_MS);
    const { core } = scene;

    await createPruneHistory({ fleets: core.fleets, uow: core.uow, clock: core.clock, ids: core.ids })();

    expect(isKept(messageId)).toBe(true);
  });

  it('lets the mic and participant events of a meeting ended before the cutoff go, and keeps the meeting', async () => {
    retainFor(30);
    const { core } = scene;
    const meetingId = idSchema('meeting').parse(core.ids('meeting'));
    const at = core.clock.now();
    const meeting: InMemoryState['meetings'][number] = {
      id: meetingId,
      fleetId: scene.fleetId,
      title: null,
      ownerShipId: scene.scout.shipId,
      moderatorShipId: scene.scout.shipId,
      openedByShipId: scene.scout.shipId,
      idempotencyKey: 'open-1',
      requestHash: 'hash',
      participants: [],
      openedAt: at,
      endedAt: at,
      micHolderShipId: null,
      micPattern: 'moderator',
      micRequests: [],
    };
    core.state.meetings.push(meeting);
    core.state.events.push(
      { id: core.ids('event'), fleetId: scene.fleetId, type: 'ParticipantAdded', occurredAt: at, actor: { kind: 'system' }, shipId: scene.planner.shipId, details: { meetingId } },
      { id: core.ids('event'), fleetId: scene.fleetId, type: 'MicGiven', occurredAt: at, actor: { kind: 'system' }, shipId: scene.planner.shipId, details: { meetingId } },
      { id: core.ids('event'), fleetId: scene.fleetId, type: 'MeetingEnded', occurredAt: at, actor: { kind: 'system' }, details: { meetingId } },
    );
    core.clock.advance(31 * DAY_MS);

    await pass();

    expect(core.state.events.filter((event) => event.details.meetingId === meetingId).map((event) => event.type)).toEqual(['MeetingEnded']);
    expect(core.state.meetings.map((held) => held.id)).toContain(meetingId);
  });
});

describe("the pruning pass, the rest of a fleet's finished history (S3)", () => {
  function eventTypes(): string[] {
    return scene.core.state.events.map((event) => event.type);
  }

  /** The scout's crew released and two starting prompts issued: its lease ended and the first secret invalidated by the second, with LeaseRevoked, StartingPromptIssued and CredentialRevoked. */
  async function releaseScout(): Promise<void> {
    unwrap(await scene.registry.releaseShip(scene.argo, { shipId: scene.scout.shipId }));
    unwrap(await scene.registry.getStartingPrompt(scene.argo, { shipId: scene.scout.shipId }));
  }

  function aConsoleSession(endedAt: Date | null): ConsoleSessionId {
    const { core } = scene;
    const id = idSchema('consoleSession').parse(core.ids('consoleSession'));
    const at = core.clock.now();
    core.state.consoleSessions.push({
      id,
      fleetId: scene.fleetId,
      shipId: scene.argo.shipId,
      leaseId: null,
      idleLimitMs: HOUR_MS,
      endsBy: null,
      device: 'Mac · Chrome',
      accountId: null,
      tokenHash: `hash-${id}`,
      createdAt: at,
      lastUsedAt: at,
      expiresAt: new Date(at.getTime() + HOUR_MS),
      endedAt,
      endReason: endedAt === null ? null : 'signedOut',
    });
    const signIn = { kind: 'agent' as const, consoleSessionId: id };
    core.state.noticeDismissals.push({ fleetId: scene.fleetId, signIn, noticeId: 'welcome', at });
    core.state.guideProgress.push({ fleetId: scene.fleetId, signIn, at, step: 1, state: 'open' });
    return id;
  }

  function aSignInTicket(name: string, input: { usedAt: Date | null; expiresAt: Date }): void {
    scene.core.state.signInTickets.push({
      fleetId: scene.fleetId,
      as: 'operator',
      accountId: null,
      tokenHash: name,
      issuedAt: scene.core.clock.now(),
      ...input,
    });
  }

  it("lets a crew's session and secret events older than the retention go, and keeps the fleet's own changes", async () => {
    retainFor(30);
    await releaseScout();
    scene.core.clock.advance(31 * DAY_MS);

    await pass();

    expect(eventTypes().filter((type) => ['StartingPromptIssued', 'LeaseRevoked', 'CredentialRevoked'].includes(type))).toEqual([]);
    expect(eventTypes()).toEqual(expect.arrayContaining(['FleetInitialised', 'ShipCommissioned']));
  });

  it("keeps a crew's session and secret events younger than the retention", async () => {
    retainFor(30);
    await releaseScout();
    scene.core.clock.advance(29 * DAY_MS);

    await pass();

    expect(eventTypes()).toEqual(expect.arrayContaining(['StartingPromptIssued', 'LeaseRevoked', 'CredentialRevoked']));
  });

  it('lets a lease that ended before the cutoff go, and keeps an open one and the ship', async () => {
    retainFor(30);
    await releaseScout();
    scene.core.clock.advance(31 * DAY_MS);

    await pass();

    expect(scene.core.state.leases.map((lease) => lease.id)).not.toContain(scene.scout.leaseId);
    expect(scene.core.state.leases.map((lease) => lease.id)).toContain(scene.planner.leaseId);
    expect(scene.core.state.ships.map((ship) => ship.id)).toContain(scene.scout.shipId);
  });

  it('keeps an ended lease a kept delivery names', async () => {
    retainFor(30);
    const question = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    scene.core.state.messages.find((message) => message.id === question)!.contentType = QUESTION_CONTENT_TYPE;
    await scene.receive(scene.scout);
    await scene.ack(scene.scout, question);
    await releaseScout();
    scene.core.clock.advance(31 * DAY_MS);

    await pass();

    expect(isKept(question)).toBe(true);
    expect(scene.core.state.leases.map((lease) => lease.id)).toContain(scene.scout.leaseId);
  });

  it('lets a secret invalidated before the cutoff go, and keeps the valid one', async () => {
    retainFor(30);
    await releaseScout();
    scene.core.clock.advance(31 * DAY_MS);

    await pass();

    expect(scene.core.state.credentials.filter((credential) => credential.shipId === scene.scout.shipId).map((credential) => credential.invalidatedAt)).toEqual([null]);
  });

  it('lets a console session that ended before the cutoff go, with its notice dismissals and guide progress, and keeps a live one', async () => {
    retainFor(30);
    const ended = aConsoleSession(scene.core.clock.now());
    const live = aConsoleSession(null);
    scene.core.clock.advance(31 * DAY_MS);

    await pass();

    const sessionOf = (row: { signIn: { kind: string } }) => ('consoleSessionId' in row.signIn ? row.signIn.consoleSessionId : undefined);
    expect(scene.core.state.consoleSessions.map((session) => session.id)).toEqual([live]);
    expect(scene.core.state.noticeDismissals.map(sessionOf)).toEqual([live]);
    expect(scene.core.state.guideProgress.map(sessionOf)).toEqual([live]);
    expect(ended).not.toBe(live);
  });

  it('lets a sign-in ticket used or expired before the cutoff go', async () => {
    retainFor(30);
    const at = scene.core.clock.now();
    aSignInTicket('used', { usedAt: at, expiresAt: new Date(at.getTime() + 2 * 60_000) });
    aSignInTicket('expired', { usedAt: null, expiresAt: new Date(at.getTime() + 2 * 60_000) });
    scene.core.clock.advance(31 * DAY_MS);
    aSignInTicket('fresh', { usedAt: null, expiresAt: new Date(scene.core.clock.now().getTime() + 2 * 60_000) });

    await pass();

    expect(scene.core.state.signInTickets.map((ticket) => ticket.tokenHash)).toEqual(['fresh']);
  });

  it('lets a reach refusal older than the retention go, and keeps a younger one', async () => {
    retainFor(30);
    const { core } = scene;
    const refusal = (at: Date): ReachRefusal => ({
      fleetId: scene.fleetId,
      id: idSchema('reachRefusal').parse(core.ids('reachRefusal')),
      at,
      sender: { kind: 'ship', id: scene.scout.shipId, name: 'scout', labels: [], owner: null },
      askedBy: null,
      recipient: { kind: 'ship', ship: { id: scene.planner.shipId, name: 'planner', labels: [], owner: null } },
      verb: 'send',
      settingsVersion: 1,
    });
    const old = refusal(core.clock.now());
    core.state.reachRefusals.push(old);
    core.clock.advance(31 * DAY_MS);
    const young = refusal(core.clock.now());
    core.state.reachRefusals.push(young);

    await pass();

    expect(core.state.reachRefusals.map((row) => row.id)).toEqual([young.id]);
  });

  it('counts each kind that went in HistoryPruned', async () => {
    retainFor(30);
    await releaseScout();
    aConsoleSession(scene.core.clock.now());
    scene.core.clock.advance(31 * DAY_MS);

    await pass();

    expect(pruned()).toEqual([
      expect.objectContaining({
        details: expect.objectContaining({ leases: 1, credentials: 1, consoleSessions: 1, noticeDismissals: 1, guideProgress: 1, signInTickets: 0, reachRefusals: 0 }),
      }),
    ]);
  });

  it('prunes the rest in batches too', async () => {
    retainFor(30);
    for (const name of ['first', 'second', 'third']) {
      aSignInTicket(name, { usedAt: scene.core.clock.now(), expiresAt: scene.core.clock.now() });
    }
    scene.core.clock.advance(31 * DAY_MS);

    await pass({ batch: 2 });

    expect(scene.core.state.signInTickets).toEqual([]);
    expect(pruned().map((event) => event.details.signInTickets)).toEqual([2, 1]);
  });
});
