import type { AlertOutput, AlertSignalFacts } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { alertOverviewLine, alertShipPanel, signalWords } from './alert';

// Open alerts on the overview and the ship page (docs/design/monitoring,
// 4.8; mockups: "Open alerts: listed on top" and "Open alert, activity
// unknown"): the ship, what parted, since when, and that it clears by itself.

// Local times, as the console shows the browser's clock.
const NOW = new Date(2026, 9, 31, 15, 15);

const SHIP: AlertOutput['ship'] = { id: 'shp_01m66p4k2v9qz8f7x3n5c14ftc', name: 'merger-1' };

function anAlert({ since, ...signalFacts }: AlertSignalFacts & { since: Date }): AlertOutput {
  return {
    id: 'alt_01m66p4k2v9qz8f7x3n5c1b0td',
    ship: SHIP,
    occurrenceKey: 'merger-1',
    ownerShipId: 'shp_01m66p4k2v9qz8f7x3n5c1r1x0',
    raisedAt: NOW.toISOString(),
    cleared: null,
    since: since.toISOString(),
    ...signalFacts,
  };
}

const UNACKNOWLEDGED = anAlert({
  signal: 'delivery-unacknowledged',
  since: new Date(2026, 9, 31, 14, 53),
  facts: { deliveryId: 'dlv_01m66p4k2v9qz8f7x3n5c1d1v1', messageId: 'msg_01m66p4k2v9qz8f7x3n5c1msg1', state: 'pending', awaitingCrew: true, minutes: 15 },
});

const REPORT_UNCHANGED = anAlert({
  signal: 'report-unchanged',
  since: new Date(2026, 9, 31, 12, 5),
  facts: { reportChangedAt: new Date(2026, 9, 31, 12, 5).toISOString(), state: 'working', minutes: 60, setBy: 'shp_01m66p4k2v9qz8f7x3n5c1r1x0' },
});

describe("the overview's Open alerts line", () => {
  it('says what parted and for how long, awaiting crew, since when, and that it clears by itself', () => {
    expect(alertOverviewLine(UNACKNOWLEDGED, NOW)).toEqual({ ship: 'merger-1', text: 'Delivery unacknowledged 22 min, awaiting crew', caption: 'since 14:53 · clears by itself' });
  });

  it('says the report is unchanged, for how long and within what it was expected', () => {
    expect(alertOverviewLine(REPORT_UNCHANGED, NOW)).toEqual({ ship: 'merger-1', text: 'Report unchanged 3 h, expected within 60 min', caption: 'since 12:05 · clears by itself' });
  });

  it("names the assigner's reason for a crew request no trierarch took (design 4.4)", () => {
    const unassigned = anAlert({ signal: 'crew-request-unassigned', since: new Date(2026, 9, 31, 14, 55), facts: { settingsVersion: 2, minutes: 15, reason: 'model disabled: claude-fable-5-1' } });

    expect(alertOverviewLine(unassigned, NOW).text).toBe('Crew request unassigned 20 min, model disabled: claude-fable-5-1');
  });
});

describe("the ship page's open alert", () => {
  it('heads with what parted and for how long, then within what it was expected, since when, the owner told and that it clears by itself', () => {
    expect(alertShipPanel(REPORT_UNCHANGED, NOW)).toEqual({ headline: 'Report unchanged 3 h 10 min', detail: 'Expected within 60 min', caption: 'since 12:05 · owner told · clears by itself' });
  });

  it('has no detail where the signal carries none', () => {
    const ping = anAlert({ signal: 'ping-unanswered', since: new Date(2026, 9, 31, 15, 1), facts: { deliveryId: 'dlv_01m66p4k2v9qz8f7x3n5c1d1v1', messageId: 'msg_01m66p4k2v9qz8f7x3n5c1msg1', minutes: 10 } });

    expect(alertShipPanel(ping, NOW)).toEqual({ headline: 'Ping unanswered 14 min', detail: null, caption: 'since 15:01 · owner told · clears by itself' });
  });
});

describe('a signal in a sentence', () => {
  it('is its words in lower case, and a signal the console does not know its own name', () => {
    expect([signalWords('delivery-overdue'), signalWords('disk-full')]).toEqual(['delivery overdue', 'disk-full']);
  });
});
