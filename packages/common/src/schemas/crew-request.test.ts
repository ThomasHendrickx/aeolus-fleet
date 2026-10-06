import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  CREW_REQUEST_SETTINGS_MAX_BYTES,
  CREW_STATUSES,
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
