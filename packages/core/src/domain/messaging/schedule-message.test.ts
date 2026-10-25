import { PAYLOAD_MAX_BYTES, type FleetId, type LabelValueId, type ScheduleId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL, withInstallationSettings } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { refusedShip } from '../../../test/support/refused-sender.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import type { MessageToSchedule } from './schedule-message.js';

/**
 * Making a schedule (decision 0062): scout schedules a check-in to chief, a
 * day ahead. The clock stands at 2026-10-25T09:00Z.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let scout: ShipCaller;
let chief: ShipCaller;

const TOMORROW = '2026-10-26T09:00:00.000Z';

function aSchedule(overrides: Partial<MessageToSchedule> = {}): MessageToSchedule {
  return {
    selector: { kind: 'ship', name: 'chief' },
    payload: 'Check in: what changed in the last 6 hours?',
    model: SESSION_MODEL,
    idempotencyKey: newKey(),
    timing: { kind: 'once', at: new Date(TOMORROW) },
    ...overrides,
  };
}

async function scheduled(input: MessageToSchedule = aSchedule(), by: ShipCaller = scout): Promise<ScheduleId> {
  return unwrap(await messaging.scheduleMessage(by, input)).scheduleId;
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-25T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  chief = await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: [] });
  core.state.events.length = 0;
});

describe('making a schedule', () => {
  it("stores an active once schedule of the calling ship with its send input as given, its next send time its instant, and the defaults' strategy", async () => {
    const scheduleId = await scheduled(aSchedule({ idempotencyKey: 'check-in' }));

    expect(core.state.schedules).toEqual([
      {
        id: scheduleId,
        fleetId,
        shipId: scout.shipId,
        send: {
          selector: { kind: 'ship', name: 'chief' },
          payload: 'Check in: what changed in the last 6 hours?',
          contentType: 'text/plain',
          model: SESSION_MODEL,
          inReplyTo: null,
          isForced: false,
        },
        timing: { kind: 'once', at: new Date(TOMORROW) },
        onRefused: 'skip',
        retryWindow: 'PT1H',
        onMissed: 'each',
        grace: 'PT5M',
        idempotencyKey: 'check-in',
        requestHash: core.state.schedules[0]?.requestHash,
        state: 'active',
        nextSendTime: new Date(TOMORROW),
        nextAttemptAt: new Date(TOMORROW),
        lastOutcome: null,
        createdAt: new Date('2026-10-25T09:00:00.000Z'),
        endedAt: null,
        cancelledAt: null,
      },
    ]);
  });

  it('keeps the content type, the reply, the force, the strategy and the retry window the creator picked', async () => {
    const forcer = await shipWithScopes({ registry, argo }, { name: 'forcer', type: 'reviewer', scopes: ['messages:force'] });
    const { messageId } = unwrap(await messaging.sendMessage(chief, { selector: { kind: 'ship', name: 'forcer' }, payload: 'Remind me', model: SESSION_MODEL, idempotencyKey: newKey() }));

    await scheduled(
      aSchedule({ contentType: 'application/vnd.aeolus.check-in+json', inReplyTo: messageId, isForced: true, onRefused: 'retry', retryWindow: 'PT30M' }),
      forcer,
    );

    expect(core.state.schedules[0]).toMatchObject({
      send: { contentType: 'application/vnd.aeolus.check-in+json', inReplyTo: messageId, isForced: true },
      onRefused: 'retry',
      retryWindow: 'PT30M',
    });
  });

  it('records ScheduleCreated on its ship, caused by it, and tells the servers when it is due', async () => {
    const scheduleId = await scheduled();

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'ScheduleCreated',
        shipId: scout.shipId,
        actor: { kind: 'ship', shipId: scout.shipId },
        details: { scheduleId, timing: 'once', nextSendTime: TOMORROW },
      }),
    ]);
    expect(core.state.scheduleNotices).toEqual([{ fleetId, scheduleId, attemptAt: new Date(TOMORROW) }]);
  });

  it('sends nothing at creation', async () => {
    await scheduled();

    expect([core.state.messages, core.state.deliveries, core.state.notices]).toEqual([[], [], []]);
  });

  it('answers the same schedule for the same request under the same key, storing nothing more', async () => {
    const input = aSchedule();
    const first = await scheduled(input);

    await expect(messaging.scheduleMessage(scout, input)).resolves.toEqual({ isOk: true, value: { scheduleId: first } });
    expect(core.state.schedules).toHaveLength(1);
    expect(core.state.events).toHaveLength(1);
  });

  it('refuses another request under a used key', async () => {
    const input = aSchedule();
    await scheduled(input);

    expect(refusalOf(await messaging.scheduleMessage(scout, { ...input, payload: 'Another check-in' })).kind).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it("keeps each ship's keys apart", async () => {
    const input = aSchedule({ selector: { kind: 'type', type: 'reviewer' } });
    await scheduled(input);
    await scheduled(input, chief);

    expect(core.state.schedules).toHaveLength(2);
  });

  it('takes a payload of exactly 64 KB and refuses one byte more, storing nothing', async () => {
    await scheduled(aSchedule({ payload: 'a'.repeat(PAYLOAD_MAX_BYTES) }));

    expect(refusalOf(await messaging.scheduleMessage(scout, aSchedule({ payload: 'a'.repeat(PAYLOAD_MAX_BYTES + 1) }))).kind).toBe('PAYLOAD_TOO_LARGE');
    expect(core.state.schedules).toHaveLength(1);
  });

  it('refuses a once schedule at or before now, storing nothing', async () => {
    const now = await messaging.scheduleMessage(scout, aSchedule({ timing: { kind: 'once', at: new Date('2026-10-25T09:00:00.000Z') } }));
    const past = await messaging.scheduleMessage(scout, aSchedule({ timing: { kind: 'once', at: new Date('2026-10-25T08:59:59.999Z') } }));

    expect([refusalOf(now).kind, refusalOf(past).kind]).toEqual(['INVALID_TIMING', 'INVALID_TIMING']);
    expect(core.state.schedules).toEqual([]);
  });

  it('takes a once schedule a millisecond ahead', async () => {
    await scheduled(aSchedule({ timing: { kind: 'once', at: new Date('2026-10-25T09:00:00.001Z') } }));

    expect(core.state.schedules).toHaveLength(1);
  });

  it('refuses a retry window that is no duration of a fixed length', async () => {
    expect(refusalOf(await messaging.scheduleMessage(scout, aSchedule({ onRefused: 'retry', retryWindow: 'P1M' }))).kind).toBe('INVALID_RETRY_WINDOW');
  });

  it('refuses a forced schedule without messages:force, storing nothing', async () => {
    expect(refusalOf(await messaging.scheduleMessage(scout, aSchedule({ isForced: true }))).kind).toBe('FORCE_NOT_ALLOWED');
    expect(core.state.schedules).toEqual([]);
  });

  it('refuses an agent that states no model, as a send does', async () => {
    expect(refusalOf(await messaging.scheduleMessage(scout, aSchedule({ model: undefined }))).kind).toBe('MODEL_REQUIRED');
  });

  it('refuses the ping content type, reserved for pings', async () => {
    expect(refusalOf(await messaging.scheduleMessage(scout, aSchedule({ contentType: 'application/vnd.aeolus.ping' }))).kind).toBe('RESERVED_CONTENT_TYPE');
  });

  it('refuses a ship that does not exist and a reply to no message of the fleet', async () => {
    const nobody = await messaging.scheduleMessage(scout, aSchedule({ selector: { kind: 'ship', name: 'nobody' } }));
    const noMessage = await messaging.scheduleMessage(scout, aSchedule({ inReplyTo: core.ids('message') }));

    expect([refusalOf(nobody).kind, refusalOf(noMessage).kind]).toEqual(['UNRESOLVABLE_SELECTOR', 'IN_REPLY_TO_NOT_FOUND']);
    expect(core.state.schedules).toEqual([]);
  });

  it('refuses a selector the creator does not reach by send now, storing only the refusal record', async () => {
    const networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
    unwrap(await registry.defineLabel(argo, { key: 'role', values: ['chief'] }));
    unwrap(await registry.assignLabel(argo, { shipId: chief.shipId, valueId: valueIdOf(core, { key: 'role', value: 'chief' }) }));
    await applyNetworkRules(registry, { by: networking, rules: [{ verb: 'send', from: [valueIdOf(core, { key: 'role', value: 'chief' })], to: [] }] });
    core.state.events.length = 0;

    const refused = await messaging.scheduleMessage(scout, aSchedule());

    expect(refusalOf(refused).kind).toBe('NOT_REACHABLE');
    expect(core.state.reachRefusals.map((refusal) => refusedShip(refusal.sender).id)).toEqual([scout.shipId]);
    expect([core.state.schedules, core.state.scheduleNotices, core.state.events]).toEqual([[], [], []]);
  });
});

describe('making a schedule to a label (decision 0065)', () => {
  let teamA: LabelValueId;

  beforeEach(async () => {
    unwrap(await registry.defineLabel(argo, { key: 'team', values: ['a', 'b'] }));
    teamA = valueIdOf(core, { key: 'team', value: 'a' });
    for (const ship of [scout, chief]) {
      unwrap(await registry.assignLabel(argo, { shipId: ship.shipId, valueId: teamA }));
    }
    core.state.events.length = 0;
  });

  it('stores the label selection as given, resolving nothing into the schedule', async () => {
    await scheduled(aSchedule({ selector: { kind: 'label', valueIds: [teamA] } }));

    expect(core.state.schedules[0]?.send.selector).toEqual({ kind: 'label', valueIds: [teamA] });
  });

  it('refuses a selection no ship but the creator carries now, storing nothing', async () => {
    const onlyScout = await messaging.scheduleMessage(chief, aSchedule({ selector: { kind: 'label', valueIds: [valueIdOf(core, { key: 'team', value: 'b' })] } }));

    expect(refusalOf(onlyScout).kind).toBe('UNRESOLVABLE_SELECTOR');
    expect([core.state.schedules, core.state.events]).toEqual([[], []]);
  });

  it('refuses the whole schedule when the creator does not reach one ship of the selection by send now, storing only the refusal record', async () => {
    const networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
    const lead = await shipWithScopes({ registry, argo }, { name: 'lead', type: 'lead', scopes: [] });
    unwrap(await registry.defineLabel(argo, { key: 'reach', values: ['lead', 'open'] }));
    const reachLead = valueIdOf(core, { key: 'reach', value: 'lead' });
    const reachOpen = valueIdOf(core, { key: 'reach', value: 'open' });
    unwrap(await registry.assignLabel(argo, { shipId: lead.shipId, valueId: reachLead }));
    unwrap(await registry.assignLabel(argo, { shipId: scout.shipId, valueId: reachOpen }));
    await applyNetworkRules(registry, { by: networking, rules: [{ verb: 'send', from: [reachLead], to: [reachOpen] }] });
    core.state.events.length = 0;

    const refused = await messaging.scheduleMessage(lead, aSchedule({ selector: { kind: 'label', valueIds: [teamA] } }));

    expect(refusalOf(refused).kind).toBe('NOT_REACHABLE');
    expect(core.state.reachRefusals.map((refusal) => refusedShip(refusal.sender).id)).toEqual([lead.shipId]);
    expect([core.state.schedules, core.state.scheduleNotices, core.state.events]).toEqual([[], [], []]);
  });
});

describe('making a repeating schedule', () => {
  it('sends an every schedule first one interval after its creation, catching up every missed send time within 5 minutes unless the creator says', async () => {
    const scheduleId = await scheduled(aSchedule({ timing: { kind: 'every', every: 'PT6H' } }));

    expect(core.state.schedules[0]).toMatchObject({
      timing: { kind: 'every', every: 'PT6H', start: null, end: null, count: null },
      onMissed: 'each',
      grace: 'PT5M',
      nextSendTime: new Date('2026-10-25T15:00:00.000Z'),
      nextAttemptAt: new Date('2026-10-25T15:00:00.000Z'),
    });
    expect(core.state.events).toEqual([expect.objectContaining({ type: 'ScheduleCreated', details: { scheduleId, timing: 'every', nextSendTime: '2026-10-25T15:00:00.000Z' } })]);
    expect(core.state.scheduleNotices).toEqual([{ fleetId, scheduleId, attemptAt: new Date('2026-10-25T15:00:00.000Z') }]);
  });

  it('sends an every schedule first at its start when the start is ahead', async () => {
    await scheduled(aSchedule({ timing: { kind: 'every', every: 'PT6H', start: new Date('2026-10-26T06:00:00.000Z') } }));

    expect(core.state.schedules[0]?.nextSendTime).toEqual(new Date('2026-10-26T06:00:00.000Z'));
  });

  it('keeps an every schedule on the beat of a start already passed', async () => {
    await scheduled(aSchedule({ timing: { kind: 'every', every: 'PT1H', start: new Date('2026-10-25T07:30:00.000Z') } }));

    expect(core.state.schedules[0]?.nextSendTime).toEqual(new Date('2026-10-25T09:30:00.000Z'));
  });

  it('sends a cron schedule first at its next wall time in its zone, UTC unless the creator says', async () => {
    await scheduled(aSchedule({ timing: { kind: 'cron', cron: '0 9 * * *', timeZone: 'Asia/Tokyo' } }));
    await scheduled(aSchedule({ timing: { kind: 'cron', cron: '0 9 * * *' } }));

    expect(core.state.schedules.map((schedule) => [schedule.timing, schedule.nextSendTime])).toEqual([
      [{ kind: 'cron', cron: '0 9 * * *', timeZone: 'Asia/Tokyo', start: null, end: null, count: null }, new Date('2026-10-26T00:00:00.000Z')],
      [{ kind: 'cron', cron: '0 9 * * *', timeZone: 'UTC', start: null, end: null, count: null }, new Date('2026-10-26T09:00:00.000Z')],
    ]);
  });

  it('keeps the missed strategy, the grace, the end and the count the creator picked', async () => {
    const timing = { kind: 'cron', cron: '0 */6 * * *', timeZone: 'UTC', start: new Date('2026-10-26T00:00:00.000Z'), end: new Date('2026-11-01T00:00:00.000Z'), count: 3 } as const;

    await scheduled(aSchedule({ timing, onMissed: 'skip', grace: 'PT1M' }));

    expect(core.state.schedules[0]).toMatchObject({ timing, onMissed: 'skip', grace: 'PT1M', nextSendTime: new Date('2026-10-26T00:00:00.000Z') });
  });

  it.each([
    { label: 'an interval of no fixed length', timing: { kind: 'every', every: 'P1M' } },
    { label: 'a cron of four fields', timing: { kind: 'cron', cron: '0 9 * *' } },
    { label: 'a zone the server does not know', timing: { kind: 'cron', cron: '0 9 * * *', timeZone: 'Mars/Olympus' } },
    { label: 'a cron that never sends', timing: { kind: 'cron', cron: '0 0 30 2 *' } },
    { label: 'a count of none', timing: { kind: 'every', every: 'PT1H', count: 0 } },
    { label: 'an end at its start', timing: { kind: 'every', every: 'PT1H', start: new Date('2026-10-26T00:00:00.000Z'), end: new Date('2026-10-26T00:00:00.000Z') } },
    { label: 'an end before its first send time', timing: { kind: 'every', every: 'PT1H', end: new Date('2026-10-25T09:59:59.999Z') } },
  ] as const)('refuses $label, storing nothing', async ({ timing }) => {
    expect(refusalOf(await messaging.scheduleMessage(scout, aSchedule({ timing }))).kind).toBe('INVALID_TIMING');
    expect(core.state.schedules).toEqual([]);
  });

  it('takes an end at its first send time', async () => {
    await scheduled(aSchedule({ timing: { kind: 'every', every: 'PT1H', end: new Date('2026-10-25T10:00:00.000Z') } }));

    expect(core.state.schedules[0]?.nextSendTime).toEqual(new Date('2026-10-25T10:00:00.000Z'));
  });

  it('refuses a grace that is no duration of a fixed length', async () => {
    expect(refusalOf(await messaging.scheduleMessage(scout, aSchedule({ timing: { kind: 'every', every: 'PT1H' }, grace: 'P1Y' }))).kind).toBe('INVALID_GRACE');
  });
});

describe("the fleet's schedules per ship limit", () => {
  beforeEach(() => {
    withInstallationSettings(core, { defaultSchedulesPerShipLimit: 2 });
  });

  it('takes a ship\'s schedules up to the limit and refuses one more, naming the limit, storing nothing', async () => {
    await scheduled();
    await scheduled();

    const refused = refusalOf(await messaging.scheduleMessage(scout, aSchedule()));

    expect(refused).toEqual({ kind: 'SCHEDULE_LIMIT_REACHED', message: "The ship holds its fleet's limit of 2 schedules, active or paused: cancel one to make another" });
    expect(core.state.schedules).toHaveLength(2);
  });

  it('counts paused schedules, not cancelled or ended ones', async () => {
    const paused = await scheduled();
    unwrap(await messaging.pauseSchedule(scout, { scheduleId: paused }));
    const cancelled = await scheduled();
    unwrap(await messaging.cancelSchedule(scout, { scheduleId: cancelled }));
    const ended = await scheduled();
    core.state.schedules = core.state.schedules.map((schedule) => (schedule.id === ended ? { ...schedule, state: 'ended', nextSendTime: null, nextAttemptAt: null } : schedule));

    await scheduled();

    expect(refusalOf(await messaging.scheduleMessage(scout, aSchedule())).kind).toBe('SCHEDULE_LIMIT_REACHED');
  });

  it("counts each ship's own schedules", async () => {
    await scheduled();
    await scheduled();

    await expect(messaging.scheduleMessage(chief, aSchedule({ selector: { kind: 'ship', name: 'scout' } }))).resolves.toMatchObject({ isOk: true });
  });

  it('answers the same schedule for a repeat of its key at the limit', async () => {
    const first = aSchedule();
    const scheduleId = await scheduled(first);
    await scheduled();

    await expect(messaging.scheduleMessage(scout, first)).resolves.toEqual({ isOk: true, value: { scheduleId } });
  });

  it("follows the fleet's own limit over the default, and no limit sets none", async () => {
    core.state.fleetLimitSettings.push({
      fleetId,
      ships: { kind: 'default' },
      dailyMessages: { kind: 'default' },
      schedulesPerShip: { kind: 'fleet', limit: null },
      minimumScheduleInterval: { kind: 'default' },
      retention: { kind: 'default' },
    });

    await scheduled();
    await scheduled();

    await expect(messaging.scheduleMessage(scout, aSchedule())).resolves.toMatchObject({ isOk: true });
  });

  it('refuses every schedule under a limit of 0', async () => {
    withInstallationSettings(core, { defaultSchedulesPerShipLimit: 0 });

    expect(refusalOf(await messaging.scheduleMessage(scout, aSchedule())).kind).toBe('SCHEDULE_LIMIT_REACHED');
  });
});

describe("the fleet's minimum schedule interval", () => {
  const HOUR_SECONDS = 3600;

  beforeEach(() => {
    withInstallationSettings(core, { defaultMinimumScheduleInterval: HOUR_SECONDS });
  });

  it('takes an every of exactly the minimum and refuses one a second shorter, naming the minimum, storing nothing', async () => {
    await scheduled(aSchedule({ timing: { kind: 'every', every: 'PT1H' } }));

    const refused = refusalOf(await messaging.scheduleMessage(scout, aSchedule({ timing: { kind: 'every', every: 'PT59M59S' } })));

    expect(refused).toEqual({
      kind: 'SCHEDULE_INTERVAL_TOO_SHORT',
      message: "The fleet's send times of a repeating schedule are at least 3600 seconds apart: every PT59M59S is 3599 seconds",
    });
    expect(core.state.schedules).toHaveLength(1);
  });

  it('takes a cron whose send times are the minimum apart and refuses one closer, naming the minimum', async () => {
    await scheduled(aSchedule({ timing: { kind: 'cron', cron: '0 * * * *' } }));

    expect(refusalOf(await messaging.scheduleMessage(scout, aSchedule({ timing: { kind: 'cron', cron: '*/30 * * * *' } })))).toEqual({
      kind: 'SCHEDULE_INTERVAL_TOO_SHORT',
      message: "The fleet's send times of a repeating schedule are at least 3600 seconds apart: cron */30 * * * * sends 1800 seconds apart, at 2026-10-25T09:30:00.000Z and 2026-10-25T10:00:00.000Z",
    });
  });

  it('refuses a cron whose shortest gap is across midnight', async () => {
    withInstallationSettings(core, { defaultMinimumScheduleInterval: 2 * HOUR_SECONDS });

    expect(refusalOf(await messaging.scheduleMessage(scout, aSchedule({ timing: { kind: 'cron', cron: '0 0,23 * * *' } }))).kind).toBe('SCHEDULE_INTERVAL_TOO_SHORT');
  });

  it('takes a weekly cron under a two day minimum, its days counted', async () => {
    withInstallationSettings(core, { defaultMinimumScheduleInterval: 2 * 24 * HOUR_SECONDS });

    await expect(messaging.scheduleMessage(scout, aSchedule({ timing: { kind: 'cron', cron: '0 9 * * MON' } }))).resolves.toMatchObject({ isOk: true });
  });

  it('measures a cron in UTC: a daily cron in a zone with summer time is a day apart', async () => {
    withInstallationSettings(core, { defaultMinimumScheduleInterval: 24 * HOUR_SECONDS });

    await expect(messaging.scheduleMessage(scout, aSchedule({ timing: { kind: 'cron', cron: '30 2 * * *', timeZone: 'Europe/Brussels' } }))).resolves.toMatchObject({ isOk: true });
  });

  it('never checks a once schedule', async () => {
    withInstallationSettings(core, { defaultMinimumScheduleInterval: 7 * 24 * HOUR_SECONDS });

    await expect(messaging.scheduleMessage(scout, aSchedule({ timing: { kind: 'once', at: new Date('2026-10-25T09:01:00.000Z') } }))).resolves.toMatchObject({ isOk: true });
  });

  it('refuses a short interval before the schedules per ship limit', async () => {
    withInstallationSettings(core, { defaultMinimumScheduleInterval: HOUR_SECONDS, defaultSchedulesPerShipLimit: 0 });

    expect(refusalOf(await messaging.scheduleMessage(scout, aSchedule({ timing: { kind: 'every', every: 'PT1M' } }))).kind).toBe('SCHEDULE_INTERVAL_TOO_SHORT');
  });
});
