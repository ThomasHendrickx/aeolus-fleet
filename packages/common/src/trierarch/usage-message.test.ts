import { describe, expect, it } from 'vitest';

import { trierarchUsageMessageSchema } from './usage-message.js';

// The examples follow docs/design/usage/usage.md, "What the trierarch sends, and when".

function aShip(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    shipId: 'shp_01m473j7hp3x6gha0gzs1mnf88',
    harness: 'claude-code',
    folderMadeAt: '2026-10-27T14:02:11Z',
    login: null,
    models: [{ model: 'claude-opus-5-5', tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, estimatedCostUsd: 0 }],
    ...overrides,
  };
}

function aMessage({ hour = '2026-10-28T09:00:00Z', ship = aShip() }: { hour?: string; ship?: Record<string, unknown> } = {}): unknown {
  return {
    hours: [{ hour, ships: [ship] }],
    subscriptions: [{ harness: 'claude-code', readAt: '2026-10-28T09:31:02Z', windows: [{ windowMinutes: 300, usedPercent: 0, resetsAt: '2026-10-28T12:00:00Z' }] }],
    readAt: '2026-10-28T10:00:40Z',
  };
}

describe('trierarchUsageMessageSchema', () => {
  it('takes the documented example', () => {
    // Given the design's example payload
    const message = aMessage();

    // When it is parsed
    const parsed = trierarchUsageMessageSchema.safeParse(message);

    // Then it is taken as it is
    expect(parsed).toEqual({ success: true, data: message });
  });

  it('takes a login the trierarch names and a model it does not price', () => {
    // Given a ship on a named login, with a model the trierarch's price table does not price
    const ship = aShip({ login: 'subscription:thomas', models: [{ model: 'gpt-6', tokens: { input: 40, output: 2, cacheRead: 0, cacheWrite: 0 }, estimatedCostUsd: null }] });

    // When it is parsed
    const parsed = trierarchUsageMessageSchema.safeParse(aMessage({ ship }));

    // Then it is taken
    expect(parsed.success).toBe(true);
  });

  it('refuses an hour that does not start a UTC hour, since tokens count in the UTC hour they were used', () => {
    // Given an hour at 09:30
    const message = aMessage({ hour: '2026-10-28T09:30:00Z' });

    // When it is parsed
    const parsed = trierarchUsageMessageSchema.safeParse(message);

    // Then it is refused
    expect(parsed.success).toBe(false);
  });

  it('refuses a field it does not know', () => {
    // Given a ship entry with a field the schema does not name
    const message = aMessage({ ship: aShip({ cost: 3 }) });

    // When it is parsed
    const parsed = trierarchUsageMessageSchema.safeParse(message);

    // Then it is refused
    expect(parsed.success).toBe(false);
  });

  it('refuses a negative token count', () => {
    // Given a model with negative output tokens
    const message = aMessage({ ship: aShip({ models: [{ model: 'claude-opus-5-5', tokens: { input: 0, output: -1, cacheRead: 0, cacheWrite: 0 }, estimatedCostUsd: 0 }] }) });

    // When it is parsed
    const parsed = trierarchUsageMessageSchema.safeParse(message);

    // Then it is refused
    expect(parsed.success).toBe(false);
  });
});
