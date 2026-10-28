import { createIdGenerator, type TrierarchReportDetails } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { harnessLoginOf, shipLoginOf, usd } from './api-key-logins';

// The console's parts for sessions on an API key (aeolus-fleet-trierarch's api keys design, K12), read from a trierarch's report (K8).

const newId = createIdGenerator();
const SCOUT = newId('ship');
const DOCS = newId('ship');
const SCRIBE = newId('ship');
const TOKENS = { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 };

function aReport(fields: Partial<TrierarchReportDetails>): TrierarchReportDetails {
  return {
    harnesses: [{ harness: 'claude-code', options: {}, flags: [], login: { default: 'apiKey', key: 'ready' } }],
    workspaces: { repositories: [], folders: [] },
    caps: { ships: 6, running: 4 },
    kept: [],
    orphans: [],
    version: '0.34.0',
    ...fields,
  };
}

const onKey = (key: 'ready' | 'refused' | 'outOfCredit' | 'none', at?: string) => [{ harness: 'claude-code', options: {}, flags: [], login: { default: 'apiKey' as const, key, ...(at === undefined ? {} : { keyStateAt: at }) } }];

describe("a harness's login line on the computer card (K12)", () => {
  const ships = [
    { id: SCOUT, harness: 'claude-code' },
    { id: DOCS, harness: 'claude-code' },
    { id: SCRIBE, harness: 'codex' },
  ];

  it('gives the default, how many of its ships run on the other login, and what they spent on the key', () => {
    const report = aReport({
      logins: [
        { shipId: SCOUT, login: 'subscription' },
        { shipId: DOCS, login: 'apiKey' },
        { shipId: SCRIBE, login: 'subscription' },
      ],
      usage: {
        subscriptions: [],
        ships: [
          { shipId: SCOUT, models: [{ model: 'claude-opus-5-5', login: 'subscription', tokens: TOKENS, estimatedCostUsd: 9 }] },
          {
            shipId: DOCS,
            models: [
              { model: 'claude-opus-5-5', login: 'apiKey', tokens: TOKENS, estimatedCostUsd: 40 },
              { model: 'claude-haiku-5-5', login: 'apiKey', tokens: TOKENS, estimatedCostUsd: 1.2 },
              { model: 'claude-mystery', login: 'apiKey', tokens: TOKENS, estimatedCostUsd: null },
            ],
          },
          { shipId: SCRIBE, models: [{ model: 'gpt-6', login: 'apiKey', tokens: TOKENS, estimatedCostUsd: 3.1 }] },
        ],
      },
    });

    expect(harnessLoginOf(report, { harness: 'claude-code', ships })).toEqual({ default: 'apiKey', otherCount: 1, spentOnKeyUsd: 41.2 });
  });

  it('says nothing of a trierarch that reports no login, as before 0.34.0', () => {
    const report = aReport({ harnesses: [{ harness: 'claude-code', options: {}, flags: [] }] });

    expect(harnessLoginOf(report, { harness: 'claude-code', ships })).toBeUndefined();
  });

  it('gives the key that is not ready, since when, and how many of its ships wait on it', () => {
    const report = aReport({
      harnesses: onKey('outOfCredit', '2026-10-28T14:02:00.000Z'),
      logins: [
        { shipId: SCOUT, login: 'apiKey' },
        { shipId: DOCS, login: 'subscription', next: 'apiKey' },
        { shipId: SCRIBE, login: 'apiKey' },
      ],
    });

    expect(harnessLoginOf(report, { harness: 'claude-code', ships })).toEqual({ default: 'apiKey', otherCount: 1, keyNotReady: { key: 'outOfCredit', at: '2026-10-28T14:02:00.000Z' }, waitingShips: 2 });
  });

  it('shows no key that is not ready while none of its ships needs it', () => {
    const report = aReport({ harnesses: onKey('none'), logins: [{ shipId: SCOUT, login: 'subscription' }] });

    expect(harnessLoginOf(report, { harness: 'claude-code', ships })?.keyNotReady).toBeUndefined();
  });
});

describe("a ship's login on its crew request card (K12)", () => {
  it('gives the login its session runs on, and what it spent on the key', () => {
    const report = aReport({
      logins: [{ shipId: SCOUT, login: 'apiKey' }],
      usage: {
        subscriptions: [],
        ships: [
          {
            shipId: SCOUT,
            models: [
              { model: 'claude-opus-5-5', login: 'apiKey', tokens: TOKENS, estimatedCostUsd: 12.5 },
              { model: 'claude-opus-5-5', login: 'subscription', tokens: TOKENS, estimatedCostUsd: 30 },
            ],
          },
        ],
      },
    });

    expect(shipLoginOf(report, { shipId: SCOUT, harness: 'claude-code', isRunning: true })).toEqual({ login: 'apiKey', spentOnKeyUsd: 12.5 });
  });

  it('gives the login its next start would use, when the configuration moved it (K3)', () => {
    const report = aReport({ logins: [{ shipId: SCOUT, login: 'subscription', next: 'apiKey' }] });

    expect(shipLoginOf(report, { shipId: SCOUT, harness: 'claude-code', isRunning: true })).toEqual({ login: 'subscription', next: 'apiKey' });
  });

  it('gives the key that is not ready, since when, while its session runs on it', () => {
    const report = aReport({ harnesses: onKey('outOfCredit', '2026-10-28T14:02:00.000Z'), logins: [{ shipId: SCOUT, login: 'apiKey' }] });

    expect(shipLoginOf(report, { shipId: SCOUT, harness: 'claude-code', isRunning: true })?.keyNotReady).toEqual({ key: 'outOfCredit', at: '2026-10-28T14:02:00.000Z' });
  });

  it('gives the key that is not ready to a ship whose next start waits on it, not to one whose session still runs on its subscription', () => {
    const report = aReport({ harnesses: onKey('refused', '2026-10-28T14:02:00.000Z'), logins: [{ shipId: SCOUT, login: 'subscription', next: 'apiKey' }] });

    expect(shipLoginOf(report, { shipId: SCOUT, harness: 'claude-code', isRunning: false })?.keyNotReady).toEqual({ key: 'refused', at: '2026-10-28T14:02:00.000Z' });
    expect(shipLoginOf(report, { shipId: SCOUT, harness: 'claude-code', isRunning: true })?.keyNotReady).toBeUndefined();
  });

  it('says nothing of a ship its trierarch reports no login for', () => {
    expect(shipLoginOf(aReport({}), { shipId: SCOUT, harness: 'claude-code', isRunning: true })).toBeUndefined();
  });
});

describe('usd', () => {
  it('writes dollars with cents, as the mockup does', () => {
    expect(usd(41.2)).toBe('$41.20');
    expect(usd(1234.5)).toBe('$1,234.50');
  });
});
