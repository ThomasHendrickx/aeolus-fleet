import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  CREW_REQUEST_SETTINGS_MAX_BYTES,
  CREW_STATUSES,
  assignCrewInputSchema,
  explainCrewRequestInputSchema,
  assignedCrewRequestsOutputSchema,
  giveBackCrewRequestInputSchema,
  giveBackCrewRequestOutputSchema,
  listedCrewRequestSchema,
  reportCrewStatusInputSchema,
  crewRequestInputSchema,
  crewRequestOutputSchema,
  crewRequestSettingsBytes,
  crewRequestSettingsSchema,
  removeCrewRequestInputSchema,
  removeCrewRequestOutputSchema,
} from './crew-request.js';

const newId = createIdGenerator();

describe('CREW_REQUEST_SETTINGS_MAX_BYTES', () => {
  it('is 16 KB', () => {
    expect(CREW_REQUEST_SETTINGS_MAX_BYTES).toBe(16 * 1024);
  });
});

describe('crewRequestSettingsBytes', () => {
  it('counts the UTF-8 bytes of the serialized JSON', () => {
    expect(crewRequestSettingsBytes({ workspace: 'é' })).toBe('{"workspace":"é"}'.length + 1);
  });
});

describe('crewRequestSettingsSchema', () => {
  it('accepts one JSON object, nested values included', () => {
    const settings = { harness: 'claude-code', workspace: { repository: 'hemma' }, options: { model: 'opus' }, firstPrompt: null };

    expect(crewRequestSettingsSchema.parse(settings)).toEqual(settings);
  });

  it.each([
    ['an array', ['claude-code']],
    ['a string', 'claude-code'],
    ['null', null],
  ])('rejects %s', (_label, settings) => {
    expect(crewRequestSettingsSchema.safeParse(settings).success).toBe(false);
  });
});

describe('crewRequestInputSchema', () => {
  it('takes the ship and its settings', () => {
    const input = { shipId: newId('ship'), settings: { harness: 'codex' } };

    expect(crewRequestInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    ['no settings', { shipId: newId('ship') }],
    ['an id of another kind', { shipId: newId('message'), settings: {} }],
  ])('rejects %s', (_label, input) => {
    expect(crewRequestInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('crewRequestOutputSchema', () => {
  it('answers the version of the settings now held', () => {
    expect(crewRequestOutputSchema.parse({ settingsVersion: 2 })).toEqual({ settingsVersion: 2 });
  });
});

describe('removeCrewRequestInputSchema', () => {
  it('takes the ship', () => {
    const input = { shipId: newId('ship') };

    expect(removeCrewRequestInputSchema.parse(input)).toEqual(input);
  });
});

describe('removeCrewRequestOutputSchema', () => {
  it('answers nothing: the OK is the answer', () => {
    expect(removeCrewRequestOutputSchema.parse({})).toEqual({});
  });
});

describe('CREW_STATUSES', () => {
  it('are crewing, running, restarting, crashed and releasing', () => {
    expect(CREW_STATUSES).toEqual(['crewing', 'running', 'restarting', 'crashed', 'releasing']);
  });
});

describe('assignCrewInputSchema', () => {
  it('takes the ship and the trierarch ship', () => {
    const input = { shipId: newId('ship'), trierarchShipId: newId('ship') };

    expect(assignCrewInputSchema.parse(input)).toEqual(input);
  });
});

describe('reportCrewStatusInputSchema', () => {
  it('takes the ship and a known status, and refuses another', () => {
    const shipId = newId('ship');

    expect(reportCrewStatusInputSchema.parse({ shipId, status: 'crashed' })).toEqual({ shipId, status: 'crashed' });
    expect(reportCrewStatusInputSchema.safeParse({ shipId, status: 'asleep' }).success).toBe(false);
  });

  it('takes the restart attempt and when the session started, with the status (#332)', () => {
    const shipId = newId('ship');
    const reported = { shipId, status: 'restarting', attempt: 2, startedAt: '2026-10-07T13:24:00.000Z' };

    expect(reportCrewStatusInputSchema.parse(reported)).toEqual(reported);
    expect(reportCrewStatusInputSchema.parse({ shipId, status: 'crewing', attempt: 0, startedAt: null })).toMatchObject({ startedAt: null });
  });

  it('refuses a negative or fractional attempt, and a start that is no time', () => {
    const shipId = newId('ship');

    expect(reportCrewStatusInputSchema.safeParse({ shipId, status: 'restarting', attempt: -1 }).success).toBe(false);
    expect(reportCrewStatusInputSchema.safeParse({ shipId, status: 'restarting', attempt: 1.5 }).success).toBe(false);
    expect(reportCrewStatusInputSchema.safeParse({ shipId, status: 'running', startedAt: 'yesterday' }).success).toBe(false);
  });
});

describe('listedCrewRequestSchema', () => {
  it('carries the restart attempt and when the session started (#332)', () => {
    const listed = { settingsVersion: 1, requestedAt: '2026-10-07T13:00:00.000Z', assignedTo: null, status: 'restarting', reason: null, crewedBy: null, attempt: 2, startedAt: '2026-10-07T13:24:00.000Z', givenBack: [] };

    expect(listedCrewRequestSchema.parse(listed)).toEqual(listed);
    expect(listedCrewRequestSchema.safeParse({ ...listed, attempt: undefined }).success).toBe(false);
  });

  it('carries each trierarch that gave it back, with the settings version, the reason and when (#382)', () => {
    const givenBack = [{ trierarch: { id: newId('ship'), name: 'mac-mini' }, settingsVersion: 1, reason: 'mac-mini: claude-code 2.1.293 refused claude-opus-5-5', givenBackAt: '2026-10-09T08:01:00.000Z' }];
    const listed = { settingsVersion: 1, requestedAt: '2026-10-09T08:00:00.000Z', assignedTo: null, status: null, reason: null, crewedBy: null, attempt: 0, startedAt: null, givenBack };

    expect(listedCrewRequestSchema.parse(listed)).toEqual(listed);
    expect(listedCrewRequestSchema.safeParse({ ...listed, givenBack: undefined }).success).toBe(false);
  });
});

describe('giveBackCrewRequestInputSchema', () => {
  it('takes the ship, the settings version given back and the reason', () => {
    const input = { shipId: newId('ship'), settingsVersion: 2, reason: 'mac-mini: nothing on screen within a minute' };

    expect(giveBackCrewRequestInputSchema.parse(input)).toEqual(input);
  });

  it('refuses no reason, and a settings version below one', () => {
    const shipId = newId('ship');

    expect(giveBackCrewRequestInputSchema.safeParse({ shipId, settingsVersion: 1, reason: '' }).success).toBe(false);
    expect(giveBackCrewRequestInputSchema.safeParse({ shipId, settingsVersion: 0, reason: 'refused' }).success).toBe(false);
  });
});

describe('giveBackCrewRequestOutputSchema', () => {
  it('answers nothing: the OK is the answer', () => {
    expect(giveBackCrewRequestOutputSchema.parse({})).toEqual({});
  });
});

describe('assignedCrewRequestsOutputSchema', () => {
  it('lists each assigned request with its settings and status', () => {
    const assigned = [{ shipId: newId('ship'), settings: { harness: 'codex' }, settingsVersion: 2, requestedAt: '2026-10-06T17:00:00.000Z', status: null }];

    expect(assignedCrewRequestsOutputSchema.parse(assigned)).toEqual(assigned);
  });
});

describe('explainCrewRequestInputSchema', () => {
  it('takes a reason, trimmed, or null to clear it', () => {
    const shipId = newId('ship');

    expect(explainCrewRequestInputSchema.parse({ shipId, reason: '  no room  ' })).toEqual({ shipId, reason: 'no room' });
    expect(explainCrewRequestInputSchema.parse({ shipId, reason: null })).toEqual({ shipId, reason: null });
  });

  it.each([
    ['a reason over 200 characters', 'x'.repeat(201)],
    ['a reason over one line', 'no room\nanywhere'],
  ])('rejects %s', (_label, reason) => {
    expect(explainCrewRequestInputSchema.safeParse({ shipId: newId('ship'), reason }).success).toBe(false);
  });
});
